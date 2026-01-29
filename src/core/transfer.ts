import {
    API_BASE_URL,
    API_ENDPOINTS,
    DEFAULT_RETRY_COUNT,
    DEFAULT_TIMEOUT,
    RETRY_DELAY,
    apiClient,
    buildApiUrl,
    buildAggrNodeUrl,
    buildAssignNodeUrl,
    clearComNodeCache,
    getComNodeEndpoint,
    getGroupInfo,
    getErrorMessage,
    isApiError,
} from './api';
import {
    buildNormalTransaction,
    buildTransaction,
    serializeAggregateGTX,
    submitTransaction,
    type UserNewTX,
} from './txBuilder';
import { buildTxUserFromAccount, syncAccountAddresses } from './walletSync';
import {
    getOrganization,
    saveOrganization,
    saveTransaction,
    type OrganizationChoice,
    type TransactionRecord,
    type UserAccount,
} from './storage';
import { lockUTXOs } from './utxoLock';
import { lockTXCers, markTXCersSubmitted, unlockTXCers } from './txCerLockManager';
import { COIN_NAMES } from './types';

export type TransferMode = 'quick' | 'cross';

export interface TransferRecipient {
    address: string;
    amount: number;
    coinType: number;
    publicKey?: string;
    orgId?: string;
    transferGas?: number;
}

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
    recipients?: TransferRecipient[];
    gas: number;
    extraGas: number;
    changeAddresses: Record<number, string>;
}

export interface TransferResult {
    success: boolean;
    txId?: string;
    error?: string;
    usedAddresses?: string[];
}

function normalizeAddress(address: string): string {
    return address.replace(/^0x/i, '').toLowerCase();
}

async function ensureOrgEndpoints(
    accountId: string,
    org: OrganizationChoice | null
): Promise<OrganizationChoice | null> {
    if (!org?.groupId) return org;
    if (org.assignNodeUrl && org.aggrNodeUrl) return org;

    try {
        const info = await getGroupInfo(org.groupId);
        if (!info.success || !info.data) return org;
        const data = info.data as {
            assign_api_endpoint?: string;
            aggr_api_endpoint?: string;
            pledge_address?: string;
            group_name?: string;
        };
        const assignAPIEndpoint = org.assignAPIEndpoint || data.assign_api_endpoint || '';
        const aggrAPIEndpoint = org.aggrAPIEndpoint || data.aggr_api_endpoint || '';
        const updated = {
            ...org,
            groupName: org.groupName || data.group_name || org.groupId,
            assignAPIEndpoint,
            aggrAPIEndpoint,
            assignNodeUrl:
                org.assignNodeUrl || (assignAPIEndpoint ? buildAssignNodeUrl(assignAPIEndpoint) : ''),
            aggrNodeUrl:
                org.aggrNodeUrl || (aggrAPIEndpoint ? buildAggrNodeUrl(aggrAPIEndpoint) : ''),
            pledgeAddress: org.pledgeAddress || data.pledge_address || '',
        };
        await saveOrganization(accountId, updated);
        return updated;
    } catch {
        return org;
    }
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

async function postWithRetry(
    url: string,
    body: string,
    options: { timeout?: number; retries?: number } = {}
): Promise<{ ok: boolean; data: any; status: number }> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const retries = options.retries ?? DEFAULT_RETRY_COUNT;

    try {
        const response = await apiClient.request<any>(url, {
            method: 'POST',
            body,
            timeout,
            retries,
        });
        return { ok: response.ok, data: response.data, status: response.status };
    } catch (error) {
        const status = isApiError(error) ? error.status || 0 : 0;
        const message = isApiError(error) ? error.message : getErrorMessage(error);
        return { ok: false, data: { error: message || '网络错误' }, status };
    }
}

function mapTransferErrorMessage(raw: string, errorCode?: string): string {
    const message = raw || '提交失败';
    const lower = message.toLowerCase();

    if (errorCode === 'USER_NOT_IN_ORG') {
        return (
            '您的账户未在后端担保组织中注册。这可能是因为：\n' +
            '1. 您导入的地址已属于其他组织\n' +
            '2. 加入组织时发生了错误\n' +
            '请尝试退出当前组织并重新加入。'
        );
    }
    if (errorCode === 'ADDRESS_REVOKED') {
        return '使用的地址已被解绑，请选择其他地址';
    }
    if (errorCode === 'SIGNATURE_FAILED') {
        return '签名验证失败，请检查私钥是否正确';
    }
    if (errorCode === 'UTXO_SPENT') {
        return 'UTXO 已被使用，请刷新页面后重试';
    }

    if (lower.includes('user is not in the guarantor') || lower.includes('not in the guarantor organization')) {
        return '用户不在担保组织内，请退出后重新加入';
    }
    if (
        lower.includes('address already revoked') ||
        lower.includes('address not found') ||
        lower.includes('already revoked')
    ) {
        return '地址已解绑，请选择其他地址';
    }
    if (lower.includes('signature') && (lower.includes('fail') || lower.includes('error'))) {
        return '签名验证失败，请检查私钥是否正确';
    }
    if (lower.includes('utxo') && (lower.includes('spent') || lower.includes('used'))) {
        return 'UTXO 已被使用，请刷新页面后重试';
    }
    if (lower.includes('no alternative guarantor available') || lower.includes('failed to reassign user')) {
        return '担保组织无法正确分配处理交易的担保人，请稍后重试';
    }
    if (lower.includes('leader') && lower.includes('unavailable')) {
        return 'Leader 节点暂时不可用，请稍后重试';
    }

    return message;
}

export async function buildAndSubmitTransfer(request: TransferRequest): Promise<TransferResult> {
    const normalizedFrom = request.fromAddresses.map(normalizeAddress);
    const rawRecipients = request.recipients?.length
        ? request.recipients
        : [
              {
                  address: request.toAddress,
                  amount: request.amount,
                  coinType: request.coinType,
                  publicKey: request.recipientPublicKey,
                  orgId: request.recipientOrgId,
                  transferGas: request.transferGas,
              },
          ];

    const changeAddresses = request.changeAddresses || {};
    const addressesToSync = new Set<string>(normalizedFrom);
    for (const addr of Object.values(changeAddresses)) {
        if (addr) addressesToSync.add(normalizeAddress(addr));
    }

    const account = await syncAccountAddresses(request.account, Array.from(addressesToSync));
    let org = await getOrganization(account.accountId);
    org = await ensureOrgEndpoints(account.accountId, org);
    const hasOrg = !!org?.groupId;
    if (!hasOrg && request.transferMode === 'cross') {
        return {
            success: false,
            error: '未加入担保组织，无法发起跨链转账',
        };
    }

    const user = buildTxUserFromAccount(account);
    if (hasOrg) {
        user.orgNumber = org.groupId;
        user.guarGroup = {
            groupID: org.groupId,
            assignAPIEndpoint: org.assignAPIEndpoint || org.assignNodeUrl || '',
            aggrAPIEndpoint: org.aggrAPIEndpoint || org.aggrNodeUrl || '',
            pledgeAddress: org.pledgeAddress || '',
        };
    }

    const isCrossChain = hasOrg && request.transferMode === 'cross';
    const preferTXCer = hasOrg && request.transferMode === 'quick';

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

    const recipients = rawRecipients.map((recipient) => {
        const pubKey = parseRecipientPubKey(recipient.publicKey || request.recipientPublicKey);
        return {
            address: normalizeAddress(recipient.address),
            amount: recipient.amount,
            coinType: recipient.coinType,
            publicKeyX: isCrossChain ? '' : pubKey.xHex,
            publicKeyY: isCrossChain ? '' : pubKey.yHex,
            guarGroupID:
                isCrossChain
                    ? ''
                    : recipient.orgId || request.recipientOrgId || '',
            interest: isCrossChain ? 0 : recipient.transferGas ?? request.transferGas ?? 0,
        };
    });

    const params = {
        fromAddresses: normalizedFrom,
        recipients,
        changeAddresses,
        gas: request.gas,
        isCrossChain,
        howMuchPayForGas: request.extraGas || 0,
        preferTXCer,
    };

    const baseId = Date.now().toString();
    const historyMode: TransactionRecord['transferMode'] =
        hasOrg ? (isCrossChain ? 'cross' : 'quick') : 'normal';
    const txRecords: TransactionRecord[] = recipients.map((recipient, index) => ({
        id: `${baseId}_${index}`,
        type: 'send',
        status: 'pending',
        transferMode: historyMode,
        amount: recipient.amount,
        coinType: recipient.coinType,
        currency: COIN_NAMES[recipient.coinType as keyof typeof COIN_NAMES] || 'PGC',
        from: normalizedFrom[0] || account.mainAddress,
        to: recipient.address,
        timestamp: Date.now(),
        gas: request.gas || 0,
        guarantorOrg: hasOrg ? org?.groupId || '' : '',
    }));

    let userTx: UserNewTX | null = null;
    let aggregate: Awaited<ReturnType<typeof buildNormalTransaction>> | null = null;

    try {
        if (!hasOrg) {
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

    if (!hasOrg && aggregate) {
        const comNodeUrl = await getComNodeEndpoint();
        const url = buildApiUrl(comNodeUrl, API_ENDPOINTS.COM_SUBMIT_NOGUARGROUP_TX);
        const body = serializeAggregateGTX(aggregate as any);

        const response = await postWithRetry(url, body);
        if (response.status === 503) {
            clearComNodeCache();
        }
        if (response.ok && response.data?.success) {
            const txHash = response.data.tx_hash || aggregate.TXHash;
            for (const record of txRecords) {
                record.txHash = txHash;
                await saveTransaction(account.accountId, record);
            }
            return { success: true, txId: txHash };
        }

        if (lockedTXCerIds.length > 0) {
            unlockTXCers(lockedTXCerIds, false);
        }
        const failureReason = mapTransferErrorMessage(
            response.data?.error || response.data?.message || '提交失败'
        );
        for (const record of txRecords) {
            record.status = 'failed';
            record.failureReason = failureReason;
            record.txHash = aggregate?.TXHash;
            await saveTransaction(account.accountId, record);
        }
        return { success: false, error: failureReason };
    }

    if (!userTx || !hasOrg) {
        if (lockedTXCerIds.length > 0) {
            unlockTXCers(lockedTXCerIds, false);
        }
        return { success: false, error: '交易数据不完整' };
    }

    const assignEndpoint = org.assignAPIEndpoint || org.assignNodeUrl || '';
    const assignUrl = assignEndpoint ? buildAssignNodeUrl(assignEndpoint) : API_BASE_URL;
    let response: Awaited<ReturnType<typeof submitTransaction>> | null = null;
    try {
        response = await submitTransaction(userTx, org.groupId, assignUrl);
    } catch (error) {
        if (lockedTXCerIds.length > 0) {
            unlockTXCers(lockedTXCerIds, false);
        }
        const failureReason = mapTransferErrorMessage((error as Error).message || '提交失败');
        for (const record of txRecords) {
            record.status = 'failed';
            record.failureReason = failureReason;
            record.txHash = userTx.TX.TXID;
            await saveTransaction(account.accountId, record);
        }
        return { success: false, error: failureReason };
    }

    if (response?.success) {
        const txHash = response.tx_id || userTx.TX.TXID;
        for (const record of txRecords) {
            record.txHash = txHash;
            await saveTransaction(account.accountId, record);
        }
        if (lockedTXCerIds.length > 0) {
            const usedTxCerIds = collectUsedTxCerIds(userTx);
            const unusedTxCerIds = lockedTXCerIds.filter((id) => !usedTxCerIds.includes(id));
            if (unusedTxCerIds.length > 0) {
                unlockTXCers(unusedTxCerIds, false);
            }
            if (usedTxCerIds.length > 0) {
                markTXCersSubmitted(usedTxCerIds, txHash || userTx.TX.TXID);
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

            if (utxosToLock.length > 0 && txHash) {
                await lockUTXOs(utxosToLock, txHash);
            }
        } catch (error) {
            console.warn('[Transfer] Failed to lock UTXOs:', error);
        }
        return { success: true, txId: txHash };
    }

    if (lockedTXCerIds.length > 0) {
        unlockTXCers(lockedTXCerIds, false);
    }
    const failureReason = mapTransferErrorMessage(response?.error || '提交失败', (response as any)?.errorCode);
    for (const record of txRecords) {
        record.status = 'failed';
        record.failureReason = failureReason;
        record.txHash = userTx.TX.TXID;
        await saveTransaction(account.accountId, record);
    }
    return {
        success: false,
        error: failureReason,
    };
}
