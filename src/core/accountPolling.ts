import { API_BASE_URL, API_ENDPOINTS, buildApiUrl, buildNodeUrl } from './api';
import { parseBigIntJson } from './bigIntJson';
import {
    getAccount,
    getActiveAccountId,
    saveAccount,
    saveTransaction,
    getTransactionHistory,
    updateTransactionStatus,
    type AddressInfo,
    type TransactionRecord,
    type UserAccount,
} from './storage';
import { COIN_NAMES } from './types';
import type { TxCertificate, UTXOData } from './blockchain';
import { cacheTXCerUpdate, shouldBlockTXCerUpdate, unlockTXCers } from './txCerLockManager';

type TxStatusPayload = {
    tx_id: string;
    status: string;
    error_reason?: string;
    block_height?: number;
};

interface InUTXO {
    UTXOData: UTXOData;
    IsTXCerUTXO: boolean;
}

interface InfoChangeData {
    In: Record<string, InUTXO[]>;
    Out: string[];
}

interface TXCerChangeToUser {
    TXCerID: string;
    Status: number;
    UTXO: string;
    Sig?: { R: string; S: string };
}

interface TXCerToUser {
    ToAddress: string;
    TXCer: TxCertificate;
}

interface UsedTXCerChangeData {
    TXCerID: string;
    UTXO: UTXOData;
    ToAddress: string;
    ToInterest: number;
}

interface AccountUpdateInfo {
    UserID: string;
    WalletChangeData: InfoChangeData;
    AddressInterest?: Record<string, number>;
    TXCerChangeData: TXCerChangeToUser[];
    UsedTXCerChangeData: UsedTXCerChangeData[];
    Timestamp: number;
    BlockHeight: number;
    ConfirmedTxIDs?: string[];
    IsNoWalletChange: boolean;
}

interface AccountUpdateResponse {
    success: boolean;
    count: number;
    updates: AccountUpdateInfo[];
}

interface TXCerChangeResponse {
    success: boolean;
    count: number;
    changes: TXCerChangeToUser[];
}

interface CrossOrgTXCerResponse {
    success: boolean;
    count: number;
    txcers: TXCerToUser[];
}

const POLLING_INTERVAL = 3000;
const TXCER_POLLING_INTERVAL = 4000;
const CROSS_ORG_POLLING_INTERVAL = 5000;
const MAX_CONSECUTIVE_FAILURES = 5;

let eventSource: EventSource | null = null;
let eventSourceUserId: string | null = null;
let eventSourceGroupId: string | null = null;
let pollingTimer: ReturnType<typeof setInterval> | null = null;
let txCerPollingTimer: ReturnType<typeof setInterval> | null = null;
let crossOrgPollingTimer: ReturnType<typeof setInterval> | null = null;
let activeAccountId: string | null = null;
let activeGroupId: string | null = null;
let activeAssignUrl: string | null = null;
let isPolling = false;
let isPollingTXCer = false;
let isPollingCrossOrg = false;
let consecutiveFailures = 0;
let txCerFailures = 0;
let crossOrgFailures = 0;
let hasShownAssignNodeConnectedToast = false;
let hasShownAssignNodeDisconnectedToast = false;

type ToastType = 'success' | 'error' | 'info' | 'warning';

function getToastHandler():
    | ((message: string, type?: ToastType, title?: string, duration?: number) => void)
    | null {
    if (typeof window === 'undefined') return null;
    const anyWindow = window as any;
    if (anyWindow?.PanguPay?.ui?.showToast) return anyWindow.PanguPay.ui.showToast;
    if (anyWindow?.showToast) return anyWindow.showToast;
    return null;
}

function notifyToast(message: string, type: ToastType): void {
    const handler = getToastHandler();
    if (!handler) return;
    handler(message, type);
}

function normalizeAddress(address: string): string {
    return String(address || '').trim().replace(/^0x/i, '').toLowerCase();
}

function generateUtxoId(utxo: UTXOData): string {
    const txid = utxo.UTXO?.TXID || utxo.TXID || '';
    const indexZ = utxo.Position?.IndexZ ?? 0;
    return `${txid}_${indexZ}`;
}

function normalizeUtxoId(utxoId: string): string {
    if (utxoId.includes(' + ')) {
        return utxoId.replace(' + ', '_');
    }
    return utxoId;
}

function dispatchAccountUpdate(accountId: string): void {
    if (typeof window === 'undefined') return;
    const event = new CustomEvent('pangu_account_updated', {
        detail: { accountId },
    });
    window.dispatchEvent(event);
}

function recalcAddressBalance(info: AddressInfo): void {
    const utxos = info.utxos || {};
    const txCerValue = Object.values(info.txCers || {}).reduce((sum, value) => sum + (value || 0), 0);
    const utxoValue = Object.values(utxos).reduce((sum, utxo) => sum + (utxo?.Value || 0), 0);
    info.balance = utxoValue;
    info.utxoCount = Object.keys(utxos).length;
    info.txCerCount = Object.keys(info.txCers || {}).length;
    info.value = {
        totalValue: utxoValue + txCerValue,
        utxoValue,
        txCerValue,
    };
}

function recalcTotals(account: UserAccount): void {
    const totals: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    for (const info of Object.values(account.addresses || {})) {
        totals[info.type || 0] = (totals[info.type || 0] || 0) + (info.balance || 0);
    }
    account.totalBalance = totals;
    account.lastLogin = Date.now();
}

async function maybeAddReceiveRecord(accountId: string, address: string, utxo: UTXOData): Promise<void> {
    const txHash = utxo.UTXO?.TXID || utxo.TXID || '';
    if (!txHash) return;

    const history = await getTransactionHistory(accountId);
    if (history.some((item) => item.txHash === txHash && item.type === 'receive')) {
        return;
    }

    const fromAddress = utxo.UTXO?.TXInputsNormal?.[0]?.FromAddress || '';
    const record: TransactionRecord = {
        id: `in_${txHash}`,
        type: 'receive',
        status: 'success',
        transferMode: 'incoming',
        amount: utxo.Value || 0,
        coinType: utxo.Type || 0,
        currency: COIN_NAMES[utxo.Type as keyof typeof COIN_NAMES] || 'PGC',
        from: fromAddress,
        to: address,
        timestamp: utxo.Time || Date.now(),
        txHash,
        gas: 0,
        blockNumber: utxo.Position?.Blocknum || 0,
    };

    await saveTransaction(accountId, record);
    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('pangu_tx_history_updated', {
                detail: { accountId, txHash, status: 'success' },
            })
        );
    }
}

async function applyConfirmedTxIds(accountId: string, update: AccountUpdateInfo): Promise<void> {
    const confirmed = update.ConfirmedTxIDs;
    if (!Array.isArray(confirmed) || confirmed.length === 0) return;

    for (const txId of confirmed) {
        if (!txId) continue;
        await updateTransactionStatus(accountId, txId, 'success', {
            blockNumber: update.BlockHeight || 0,
        });
    }
}

function applyAddressInterest(account: UserAccount, update: AccountUpdateInfo): void {
    if (!update.AddressInterest) return;
    for (const [address, interest] of Object.entries(update.AddressInterest)) {
        const normalized = normalizeAddress(address);
        const info = account.addresses[normalized];
        if (!info) continue;
        info.estInterest = Number(interest) || 0;
    }
}

function applyUsedTxCerInterest(account: UserAccount, update: AccountUpdateInfo): void {
    if (!Array.isArray(update.UsedTXCerChangeData)) return;
    for (const used of update.UsedTXCerChangeData) {
        const normalized = normalizeAddress(used.ToAddress);
        const info = account.addresses[normalized];
        if (!info) continue;
        info.estInterest = (info.estInterest || 0) + (used.ToInterest || 0);
    }
}

function removeTxCer(account: UserAccount, txCerId: string): void {
    const store = account.txCerStore || {};
    delete store[txCerId];
    account.txCerStore = store;

    for (const info of Object.values(account.addresses || {})) {
        if (info.txCers && info.txCers[txCerId] !== undefined) {
            delete info.txCers[txCerId];
            recalcAddressBalance(info);
            return;
        }
    }
}

function processTxCerChange(account: UserAccount, change: TXCerChangeToUser): void {
    const txCerId = change.TXCerID;
    if (!txCerId) return;

    if (shouldBlockTXCerUpdate(txCerId, change.Status)) {
        cacheTXCerUpdate(txCerId, change.Status, change.UTXO);
        return;
    }

    if (change.Status === 0 || change.Status === 1) {
        removeTxCer(account, txCerId);
        unlockTXCers([txCerId], false);
        return;
    }
}

export async function processTxCerChangeDirectly(change: TXCerChangeToUser): Promise<void> {
    if (!change?.TXCerID) return;
    const accountId = activeAccountId || (await getActiveAccountId());
    if (!accountId) return;
    const account = await getAccount(accountId);
    if (!account) return;
    processTxCerChange(account, change);
    recalcTotals(account);
    await saveAccount(account);
    dispatchAccountUpdate(account.accountId);
}

function processTxCerToUser(account: UserAccount, item: TXCerToUser): void {
    const normalized = normalizeAddress(item.ToAddress);
    const info = account.addresses[normalized];
    if (!info) return;
    if (info.type !== 0) return;

    if (!info.txCers) info.txCers = {};
    if (info.txCers[item.TXCer.TXCerID] !== undefined) return;

    info.txCers[item.TXCer.TXCerID] = item.TXCer.Value;

    const store = account.txCerStore || {};
    store[item.TXCer.TXCerID] = item.TXCer;
    account.txCerStore = store;

    recalcAddressBalance(info);
}

async function processAccountUpdate(account: UserAccount, update: AccountUpdateInfo): Promise<void> {
    await applyConfirmedTxIds(account.accountId, update);

    if (update.IsNoWalletChange) {
        applyAddressInterest(account, update);
        recalcTotals(account);
        return;
    }

    if (update.WalletChangeData?.In) {
        for (const [address, inUtxos] of Object.entries(update.WalletChangeData.In)) {
            const normalized = normalizeAddress(address);
            const info = account.addresses[normalized];
            if (!info) continue;
            if (!info.utxos) info.utxos = {};

            for (const entry of inUtxos || []) {
                const utxo = entry.UTXOData;
                const utxoId = generateUtxoId(utxo);
                const backendId = `${utxo.UTXO?.TXID || utxo.TXID || ''} + ${utxo.Position?.IndexZ ?? 0}`;
                if (info.utxos[backendId]) delete info.utxos[backendId];
                if (info.utxos[utxoId]) continue;
                info.utxos[utxoId] = utxo;
                void maybeAddReceiveRecord(account.accountId, normalized, utxo);
            }

            recalcAddressBalance(info);
        }
    }

    if (Array.isArray(update.WalletChangeData?.Out) && update.WalletChangeData.Out.length > 0) {
        const outIds = update.WalletChangeData.Out;
        const normalizedIds = outIds.map(normalizeUtxoId);

        for (const info of Object.values(account.addresses || {})) {
            if (!info.utxos) continue;
            for (let i = 0; i < outIds.length; i += 1) {
                delete info.utxos[outIds[i]];
                delete info.utxos[normalizedIds[i]];
            }
            recalcAddressBalance(info);
        }
    }

    applyUsedTxCerInterest(account, update);
    applyAddressInterest(account, update);
    recalcTotals(account);
}

async function pollAccountUpdates(force = false): Promise<void> {
    if (isPolling) return;
    if (!force && isAccountPollingActive()) return;
    if (!activeAccountId || !activeGroupId) return;

    isPolling = true;
    try {
        const baseUrl = activeAssignUrl || API_BASE_URL;
        const endpoint = buildApiUrl(baseUrl, API_ENDPOINTS.ASSIGN_ACCOUNT_UPDATE(activeGroupId));
        const url = `${endpoint}?userID=${activeAccountId}&consume=true`;
        const response = await fetch(url, { method: 'GET' });
        if (!response.ok) {
            consecutiveFailures += 1;
            return;
        }

        consecutiveFailures = 0;
        const data = parseBigIntJson<AccountUpdateResponse>(await response.text());
        if (!data.success || !data.updates?.length) return;

        const account = await getAccount(activeAccountId);
        if (!account) return;

        for (const update of data.updates) {
            await processAccountUpdate(account, update);
        }

        await saveAccount(account);
        dispatchAccountUpdate(account.accountId);
    } catch (error) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            stopAccountPolling();
        }
    } finally {
        isPolling = false;
    }
}

async function pollTXCerChanges(force = false): Promise<void> {
    if (isPollingTXCer) return;
    if (!force && isAccountPollingActive()) return;
    if (!activeAccountId || !activeGroupId) return;

    isPollingTXCer = true;
    try {
        const baseUrl = activeAssignUrl || API_BASE_URL;
        const endpoint = buildApiUrl(baseUrl, API_ENDPOINTS.ASSIGN_TXCER_CHANGE(activeGroupId));
        const url = `${endpoint}?userID=${activeAccountId}&limit=10&consume=true`;
        const response = await fetch(url, { method: 'GET' });
        if (!response.ok) {
            txCerFailures += 1;
            return;
        }

        txCerFailures = 0;
        const data = parseBigIntJson<TXCerChangeResponse>(await response.text());
        if (!data.success || !data.changes?.length) return;

        const account = await getAccount(activeAccountId);
        if (!account) return;

        for (const change of data.changes) {
            processTxCerChange(account, change);
        }

        recalcTotals(account);
        await saveAccount(account);
        dispatchAccountUpdate(account.accountId);
    } catch (error) {
        txCerFailures += 1;
        if (txCerFailures >= MAX_CONSECUTIVE_FAILURES) {
            stopTXCerChangePolling();
        }
    } finally {
        isPollingTXCer = false;
    }
}

async function pollCrossOrgTXCers(force = false): Promise<void> {
    if (isPollingCrossOrg) return;
    if (!force && isAccountPollingActive()) return;
    if (!activeAccountId || !activeGroupId) return;

    isPollingCrossOrg = true;
    try {
        const baseUrl = activeAssignUrl || API_BASE_URL;
        const endpoint = buildApiUrl(baseUrl, API_ENDPOINTS.ASSIGN_CROSS_ORG_TXCER(activeGroupId));
        const url = `${endpoint}?userID=${activeAccountId}&limit=10&consume=true`;
        const response = await fetch(url, { method: 'GET' });
        if (!response.ok) {
            crossOrgFailures += 1;
            return;
        }

        crossOrgFailures = 0;
        const data = parseBigIntJson<CrossOrgTXCerResponse>(await response.text());
        if (!data.success || !data.txcers?.length) return;

        const account = await getAccount(activeAccountId);
        if (!account) return;

        for (const item of data.txcers) {
            processTxCerToUser(account, item);
        }

        recalcTotals(account);
        await saveAccount(account);
        dispatchAccountUpdate(account.accountId);
    } catch (error) {
        crossOrgFailures += 1;
        if (crossOrgFailures >= MAX_CONSECUTIVE_FAILURES) {
            stopCrossOrgTXCerPolling();
        }
    } finally {
        isPollingCrossOrg = false;
    }
}

function startTXCerChangePolling(): void {
    if (txCerPollingTimer || !activeAccountId || !activeGroupId) return;
    txCerFailures = 0;
    void pollTXCerChanges(true);
    txCerPollingTimer = setInterval(pollTXCerChanges, TXCER_POLLING_INTERVAL);
}

function stopTXCerChangePolling(): void {
    if (txCerPollingTimer) {
        clearInterval(txCerPollingTimer);
        txCerPollingTimer = null;
    }
}

function startCrossOrgTXCerPolling(): void {
    if (crossOrgPollingTimer || !activeAccountId || !activeGroupId) return;
    crossOrgFailures = 0;
    void pollCrossOrgTXCers(true);
    crossOrgPollingTimer = setInterval(pollCrossOrgTXCers, CROSS_ORG_POLLING_INTERVAL);
}

function stopCrossOrgTXCerPolling(): void {
    if (crossOrgPollingTimer) {
        clearInterval(crossOrgPollingTimer);
        crossOrgPollingTimer = null;
    }
}

function startSSESync(): void {
    if (!activeAccountId || !activeGroupId) return;
    if (typeof EventSource === 'undefined') {
        console.warn('[AccountSSE] EventSource not supported');
        notifyToast('浏览器不支持 SSE，同步可能不完整', 'warning');
        return;
    }

    if (
        eventSource &&
        eventSourceUserId === activeAccountId &&
        eventSourceGroupId === activeGroupId &&
        eventSource.readyState !== EventSource.CLOSED
    ) {
        return;
    }

    if (eventSource) {
        stopSSESync();
    }

    eventSourceUserId = activeAccountId;
    eventSourceGroupId = activeGroupId;

    const baseUrl = activeAssignUrl || API_BASE_URL;
    const url = `${baseUrl}/api/v1/${activeGroupId}/assign/account-update-stream?userID=${activeAccountId}`;

    try {
        eventSource = new EventSource(url);

        eventSource.onopen = () => {
            console.info('[AccountSSE] Connected');
            if (!hasShownAssignNodeConnectedToast) {
                hasShownAssignNodeConnectedToast = true;
                hasShownAssignNodeDisconnectedToast = false;
                notifyToast('已连接到担保组织节点', 'success');
            }
        };

        eventSource.onerror = (err) => {
            console.error('[AccountSSE] Connection error:', err);
            if (!hasShownAssignNodeDisconnectedToast) {
                hasShownAssignNodeDisconnectedToast = true;
                notifyToast('无法连接担保组织节点', 'warning');
            }
        };

        eventSource.addEventListener('account_update', (event) => {
            void (async () => {
                try {
                    const data = parseBigIntJson<AccountUpdateInfo>((event as MessageEvent).data);
                    const account = await getAccount(activeAccountId as string);
                    if (!account) return;
                    await processAccountUpdate(account, data);
                    await saveAccount(account);
                    dispatchAccountUpdate(account.accountId);
                } catch (error) {
                    console.error('[AccountSSE] Failed to parse account_update:', error);
                }
            })();
        });

        eventSource.addEventListener('txcer_change', (event) => {
            void (async () => {
                try {
                    const data = parseBigIntJson<TXCerChangeToUser>((event as MessageEvent).data);
                    const account = await getAccount(activeAccountId as string);
                    if (!account) return;
                    processTxCerChange(account, data);
                    recalcTotals(account);
                    await saveAccount(account);
                    dispatchAccountUpdate(account.accountId);
                } catch (error) {
                    console.error('[AccountSSE] Failed to parse txcer_change:', error);
                }
            })();
        });

        eventSource.addEventListener('cross_org_txcer', (event) => {
            void (async () => {
                try {
                    const data = parseBigIntJson<TXCerToUser | CrossOrgTXCerResponse>((event as MessageEvent).data);
                    const account = await getAccount(activeAccountId as string);
                    if (!account) return;
                    if ((data as CrossOrgTXCerResponse).txcers) {
                        for (const item of (data as CrossOrgTXCerResponse).txcers) {
                            processTxCerToUser(account, item);
                        }
                    } else {
                        processTxCerToUser(account, data as TXCerToUser);
                    }
                    recalcTotals(account);
                    await saveAccount(account);
                    dispatchAccountUpdate(account.accountId);
                } catch (error) {
                    console.error('[AccountSSE] Failed to parse cross_org_txcer:', error);
                }
            })();
        });

        eventSource.addEventListener('tx_status_change', (event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data) as TxStatusPayload;
                const customEvent = new CustomEvent('pangu_tx_status', {
                    detail: data,
                });
                window.dispatchEvent(customEvent);
            } catch (error) {
                console.error('[AccountSSE] Failed to parse tx_status_change:', error);
            }
        });
    } catch (error) {
        console.error('[AccountSSE] Failed to create EventSource:', error);
        stopSSESync();
    }
}

function stopSSESync(): void {
    if (!eventSource) return;
    eventSource.close();
    eventSource = null;
    eventSourceUserId = null;
    eventSourceGroupId = null;
    hasShownAssignNodeDisconnectedToast = false;
}

export function startAccountPolling(
    accountId: string,
    groupId: string,
    assignNodeUrl?: string
): void {
    if (!accountId || !groupId) return;
    activeAccountId = accountId;
    activeGroupId = groupId;
    activeAssignUrl = assignNodeUrl ? buildNodeUrl(assignNodeUrl) : API_BASE_URL;
    consecutiveFailures = 0;
    hasShownAssignNodeConnectedToast = false;
    hasShownAssignNodeDisconnectedToast = false;

    if (!pollingTimer) {
        void pollAccountUpdates(true);
        pollingTimer = setInterval(pollAccountUpdates, POLLING_INTERVAL);
    }

    startTXCerChangePolling();
    startCrossOrgTXCerPolling();
    startSSESync();
}

export function stopAccountPolling(): void {
    stopSSESync();
    if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
    }
    stopTXCerChangePolling();
    stopCrossOrgTXCerPolling();
    activeAccountId = null;
    activeGroupId = null;
    activeAssignUrl = null;
}

export function isAccountPollingActive(): boolean {
    return eventSource !== null && eventSource.readyState === EventSource.OPEN;
}
