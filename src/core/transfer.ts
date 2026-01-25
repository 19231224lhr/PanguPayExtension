import {
    API_BASE_URL,
    API_ENDPOINTS,
    DEFAULT_RETRY_COUNT,
    DEFAULT_TIMEOUT,
    RETRY_DELAY,
    buildApiUrl,
    buildNodeUrl,
    getComNodeEndpoint,
} from './api';
import { buildNormalTransaction, buildTransaction, serializeAggregateGTX, serializeUserNewTX, type UserNewTX } from './txBuilder';
import { buildTxUserFromAccount, syncAccountAddresses } from './walletSync';
import { getOrganization, saveTransaction, type TransactionRecord, type UserAccount } from './storage';
import { lockUTXOs } from './utxoLock';
import { lockTXCers, markTXCersSubmitted, unlockTXCers } from './txCerLockManager';

export type TransferMode = 'quick' | 'cross';

export interface TransferRequest {
    account: UserAccount;
    fromAddresses: string[];
    toAddress: string;
    amount: number;
    coinType: number;
    transferMode: TransferMode;
    transferGas?: number;
    recipientPublicKey?: string;
    recipientOrgId?: string;
    gas: number;
    extraGas: number;
    changeAddresses: Record<number, string>;
}

export interface TransferResult {
    success: boolean;
    txId?: string;
    error?: string;
}

function normalizeAddress(address: string): string {
    return address.replace(/^0x/i, '').toLowerCase();
}

function parseRecipientPubKey(input?: string): { xHex: string; yHex: string } {
    if (!input) return { xHex: '', yHex: '' };
    const trimmed = input.trim().replace(/^0x/i, '');
    if (!trimmed) return { xHex: '', yHex: '' };

    if (trimmed.startsWith('04') && trimmed.length >= 130) {
        const body = trimmed.slice(2);
        return {
            xHex: body.slice(0, 64),
            yHex: body.slice(64, 128),
        };
    }

    if (trimmed.includes(',') || trimmed.includes(' ')) {
        const parts = trimmed.split(/[\s,]+/).filter(Boolean);
        if (parts.length >= 2) {
            return { xHex: parts[0], yHex: parts[1] };
        }
    }

    return { xHex: '', yHex: '' };
}

function collectUsedTxCerIds(userTx: UserNewTX): string[] {
    const used: string[] = [];
    const inputs = userTx?.TX?.TXInputsCertificate || [];
    for (const item of inputs as Array<{ TXCerID?: string }>) {
        if (item?.TXCerID) {
            used.push(String(item.TXCerID));
        }
    }
    return used;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeout: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function postWithRetry(
    url: string,
    body: string,
    options: { timeout?: number; retries?: number } = {}
): Promise<{ ok: boolean; data: any; status: number }> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const retries = options.retries ?? DEFAULT_RETRY_COUNT;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const response = await fetchWithTimeout(
                url,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                },
                timeout
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok && response.status >= 500 && attempt < retries) {
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * (attempt + 1)));
                continue;
            }
            return { ok: response.ok, data, status: response.status };
        } catch (error) {
            lastError = error instanceof Error ? error : new Error('网络错误');
            if (attempt < retries) {
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * (attempt + 1)));
                continue;
            }
        }
    }

    return { ok: false, data: { error: lastError?.message || '网络错误' }, status: 0 };
}

export async function buildAndSubmitTransfer(request: TransferRequest): Promise<TransferResult> {
    const normalizedFrom = request.fromAddresses.map(normalizeAddress);
    const normalizedTo = normalizeAddress(request.toAddress);

    const changeAddresses = request.changeAddresses || {};
    const addressesToSync = new Set<string>(normalizedFrom);
    for (const addr of Object.values(changeAddresses)) {
        if (addr) addressesToSync.add(normalizeAddress(addr));
    }

    const account = await syncAccountAddresses(request.account, Array.from(addressesToSync));
    const org = await getOrganization(account.accountId);

    const user = buildTxUserFromAccount(account);
    if (org?.groupId) {
        user.orgNumber = org.groupId;
        user.guarGroup = {
            groupID: org.groupId,
            assignAPIEndpoint: org.assignNodeUrl || '',
            aggrAPIEndpoint: org.aggrNodeUrl || '',
            pledgeAddress: org.pledgeAddress || '',
        };
    }

    const pubKey = parseRecipientPubKey(request.recipientPublicKey);
    const preferTXCer = request.transferMode === 'quick';

    const lockedTXCerIds: string[] = [];
    try {
        for (const addr of normalizedFrom) {
            const info = account.addresses?.[addr];
            const txCers = info?.txCers ? Object.keys(info.txCers) : [];
            if (txCers.length > 0) {
                const lockedIds = lockTXCers(txCers, `构造交易 - 地址 ${addr.slice(0, 8)}...`);
                lockedTXCerIds.push(...lockedIds);
            }
        }
    } catch (error) {
        console.warn('[Transfer] Failed to lock TXCers:', error);
    }

    const params = {
        fromAddresses: normalizedFrom,
        recipients: [
            {
                address: normalizedTo,
                amount: request.amount,
                coinType: request.coinType,
                publicKeyX: request.transferMode === 'cross' ? '' : pubKey.xHex,
                publicKeyY: request.transferMode === 'cross' ? '' : pubKey.yHex,
                guarGroupID: request.transferMode === 'cross' ? '' : request.recipientOrgId || '',
                interest: request.transferMode === 'cross' ? 0 : request.transferGas || 0,
            },
        ],
        changeAddresses,
        gas: request.gas,
        isCrossChain: request.transferMode === 'cross',
        howMuchPayForGas: request.extraGas || 0,
        preferTXCer,
    };

    const txRecord: TransactionRecord = {
        id: Date.now().toString(),
        type: 'send',
        status: 'pending',
        amount: request.amount,
        coinType: request.coinType,
        from: normalizedFrom[0] || account.mainAddress,
        to: normalizedTo,
        timestamp: Date.now(),
    };

    let userTx: UserNewTX | null = null;
    let aggregate: Awaited<ReturnType<typeof buildNormalTransaction>> | null = null;

    try {
        if (!org?.groupId) {
            aggregate = await buildNormalTransaction(params, user);
        } else {
            userTx = await buildTransaction(params, user);
        }
    } catch (error) {
        if (lockedTXCerIds.length > 0) {
            unlockTXCers(lockedTXCerIds, false);
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : '交易构造失败',
        };
    }

    if (!org?.groupId && aggregate) {
        const comNodeUrl = await getComNodeEndpoint();
        const url = buildApiUrl(comNodeUrl, API_ENDPOINTS.COM_SUBMIT_NOGUARGROUP_TX);
        const body = serializeAggregateGTX(aggregate as any);

        const response = await postWithRetry(url, body);
        if (response.ok && response.data?.success) {
            txRecord.txHash = response.data.tx_hash || aggregate.TXHash;
            await saveTransaction(account.accountId, txRecord);
            return { success: true, txId: txRecord.txHash };
        }

        if (lockedTXCerIds.length > 0) {
            unlockTXCers(lockedTXCerIds, false);
        }
        return {
            success: false,
            error: response.data?.error || response.data?.message || '提交失败',
        };
    }

    if (!userTx || !org?.groupId) {
        if (lockedTXCerIds.length > 0) {
            unlockTXCers(lockedTXCerIds, false);
        }
        return { success: false, error: '交易数据不完整' };
    }

    const assignUrl = org.assignNodeUrl ? buildNodeUrl(org.assignNodeUrl) : API_BASE_URL;
    const submitUrl = buildApiUrl(assignUrl, API_ENDPOINTS.ASSIGN_SUBMIT_TX(org.groupId));
    const body = serializeUserNewTX(userTx);

    const response = await postWithRetry(submitUrl, body);
    if (response.ok && response.data?.success) {
        txRecord.txHash = response.data.tx_id || userTx.TX.TXID;
        await saveTransaction(account.accountId, txRecord);
        if (lockedTXCerIds.length > 0) {
            const usedTxCerIds = collectUsedTxCerIds(userTx);
            const unusedTxCerIds = lockedTXCerIds.filter((id) => !usedTxCerIds.includes(id));
            if (unusedTxCerIds.length > 0) {
                unlockTXCers(unusedTxCerIds, false);
            }
            if (usedTxCerIds.length > 0) {
                markTXCersSubmitted(usedTxCerIds, txRecord.txHash || userTx.TX.TXID);
            }
        }

        try {
            const utxosToLock: Array<{ utxoId: string; address: string; value: number; type: number }> = [];
            const inputs = userTx.TX.TXInputsNormal || [];
            for (const input of inputs) {
                const fromTxId = input.FromTXID || '';
                const indexZ = input.FromTxPosition?.IndexZ ?? 0;
                if (!fromTxId) continue;

                const utxoId = `${fromTxId}_${indexZ}`;
                const backendKey = `${fromTxId} + ${indexZ}`;
                const addressHint = normalizeAddress(input.FromAddress || '');
                let resolvedAddr = addressHint;
                let utxoData =
                    account.addresses?.[resolvedAddr]?.utxos?.[utxoId] ||
                    account.addresses?.[resolvedAddr]?.utxos?.[backendKey];

                if (!utxoData) {
                    for (const [addrKey, addrData] of Object.entries(account.addresses || {})) {
                        const candidate = addrData?.utxos?.[utxoId] || addrData?.utxos?.[backendKey];
                        if (candidate) {
                            resolvedAddr = addrKey;
                            utxoData = candidate;
                            break;
                        }
                    }
                }

                const value = Number(utxoData?.Value ?? 0) || 0;
                const type = Number(utxoData?.Type ?? account.addresses?.[resolvedAddr]?.type ?? 0) || 0;
                utxosToLock.push({ utxoId, address: resolvedAddr || addressHint, value, type });
            }

            if (utxosToLock.length > 0 && txRecord.txHash) {
                await lockUTXOs(utxosToLock, txRecord.txHash);
            }
        } catch (error) {
            console.warn('[Transfer] Failed to lock UTXOs:', error);
        }
        return { success: true, txId: txRecord.txHash };
    }

    if (lockedTXCerIds.length > 0) {
        unlockTXCers(lockedTXCerIds, false);
    }
    return {
        success: false,
        error: response.data?.error || response.data?.message || '提交失败',
    };
}
