import {
    API_BASE_URL,
    API_ENDPOINTS,
    apiClient,
    buildAggrNodeUrl,
    buildApiUrl,
    buildAssignNodeUrl,
    isNetworkError,
    isTimeoutError,
} from './api';
import { parseBigIntJson } from './bigIntJson';
import {
    getAccount,
    getActiveAccountId,
    getOrganization,
    mutateAccount,
    saveTransaction,
    getTransactionHistory,
    updateTransactionStatus,
    type AddressInfo,
    type TransactionRecord,
    type UserAccount,
} from './storage';
import { COIN_NAMES } from './types';
import type { TxCertificate, TXCerIssueProof, TXCerIssuanceDetailView, TXCerIssuanceMetadata, TXCerStatusView, UTXOData } from './blockchain';
import type { FastLiabilityReceiptV2 } from '../protocol-v2/types';
import { cacheTXCerUpdate, shouldBlockTXCerUpdate, unlockTXCers } from './txCerLockManager';
import { applyTXCerStatus, getTXCerStatus, markTXCerActive } from './txCerStatus';
import { buildTXCerIssuanceMetadata, refreshTXCerIssuanceMetadata } from './txCerIssuance';
import { mergeTXCerEvidenceMetadata } from '../protocol-v2/security';
import { unlockUTXOs } from './utxoLock';
import { notifyDappTxStatus } from './dappTxStatus';
import { formatAmount, normalizeStoredAmount, parseAmount } from './amount';

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
    IssuanceRecordID?: string;
    IssuanceStatus?: string;
    IssuanceProof?: TXCerIssueProof;
    IssuanceRecord?: TXCerIssuanceDetailView;
    LiabilityReceipt?: FastLiabilityReceiptV2;
    IssueBatchID?: string;
    DeliveredAt?: number;
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

interface TXCerStatusResponse {
    success: boolean;
    count: number;
    statuses: TXCerStatusView[];
}

interface TXCerStatusChangeResponse {
    success: boolean;
    count: number;
    changes: TXCerStatusView[];
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
const txCerEvidenceRefreshes = new Map<string, Promise<void>>();

function scheduleTXCerEvidenceRefresh(accountID: string, txCerID: string): void {
    const key = `${accountID}:${txCerID}`;
    if (txCerEvidenceRefreshes.has(key)) return;
    const task = Promise.resolve().then(async () => {
        const account = await getAccount(accountID);
        const organization = await getOrganization(accountID);
        const metadata = account?.txCerIssuanceRecords?.[txCerID];
        if (!account || !metadata) return;
        const authorityBaseUrl = organization?.aggrNodeUrl
            || buildAggrNodeUrl(organization?.aggrAPIEndpoint || '')
            || organization?.assignNodeUrl
            || buildAssignNodeUrl(organization?.assignAPIEndpoint || '');
        const refreshed = await refreshTXCerIssuanceMetadata(
            metadata,
            accountID,
            getTXCerStatus(account, txCerID),
            authorityBaseUrl,
        );
        await mutateAccount(accountID, (latest) => {
            latest.txCerIssuanceRecords = latest.txCerIssuanceRecords || {};
            latest.txCerIssuanceRecords[txCerID] = mergeTXCerEvidenceMetadata(
                latest.txCerIssuanceRecords[txCerID],
                refreshed,
            ) as TXCerIssuanceMetadata;
            return latest;
        });
        dispatchAccountUpdate(accountID);
    }).catch((error) => {
        console.warn(`[TXCerEvidence] Refresh failed for ${txCerID}:`, error);
    }).finally(() => {
        txCerEvidenceRefreshes.delete(key);
    });
    txCerEvidenceRefreshes.set(key, task);
}

async function schedulePendingTXCerEvidenceRefreshes(): Promise<void> {
    if (!activeAccountId) return;
    const account = await getAccount(activeAccountId);
    if (!account) return;
    for (const [txCerID, metadata] of Object.entries(account.txCerIssuanceRecords || {})) {
        const fastStatus = metadata.security?.fastEvidenceStatus;
        const auditStatus = metadata.security?.cfaaAuditStatus;
        if (!metadata.security || fastStatus === 'Pending' || auditStatus === 'Pending' || auditStatus === 'Unavailable') {
            scheduleTXCerEvidenceRefresh(account.accountId, txCerID);
        }
    }
}

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

function dispatchHistoryUpdate(accountId: string, txHash: string, status: string): void {
    if (typeof window === 'undefined') return;
    const event = new CustomEvent('pangu_tx_history_updated', {
        detail: { accountId, txHash, status },
    });
    window.dispatchEvent(event);
}

function recalcAddressBalance(info: AddressInfo): void {
    const utxos = info.utxos || {};
    const txCerUnits = Object.values(info.txCers || {}).reduce<bigint>((sum, value) => sum + parseAmount(value || '0'), 0n);
    const utxoUnits = Object.values(utxos).reduce<bigint>((sum, utxo) => sum + parseAmount(utxo?.Value || '0'), 0n);
    info.balance = formatAmount(utxoUnits);
    info.utxoCount = Object.keys(utxos).length;
    info.txCerCount = Object.keys(info.txCers || {}).length;
    info.value = {
        totalValue: formatAmount(utxoUnits + txCerUnits),
        utxoValue: formatAmount(utxoUnits),
        txCerValue: formatAmount(txCerUnits),
    };
}

function recalcTotals(account: UserAccount): void {
    const totalUnits: Record<number, bigint> = { 0: 0n, 1: 0n, 2: 0n };
    const mainAddress = account.mainAddress?.toLowerCase() || '';
    for (const [addr, info] of Object.entries(account.addresses || {})) {
        if (mainAddress && addr.toLowerCase() === mainAddress) continue;
        const utxoUnits = parseAmount(info.value?.utxoValue ?? info.balance ?? '0');
        const txCerUnits = info.value?.txCerValue != null
            ? parseAmount(info.value.txCerValue)
            : Object.values(info.txCers || {}).reduce<bigint>((sum, value) => sum + parseAmount(value || '0'), 0n);
        const combinedUnits = info.value?.totalValue != null
            ? parseAmount(info.value.totalValue)
            : utxoUnits + txCerUnits;
        const type = info.type || 0;
        totalUnits[type] = (totalUnits[type] || 0n) + combinedUnits;
    }
    account.totalBalance = Object.fromEntries(
        Object.entries(totalUnits).map(([type, units]) => [Number(type), formatAmount(units)])
    );
    account.lastLogin = Date.now();
}

async function maybeAddReceiveRecord(
    accountId: string,
    address: string,
    utxo: UTXOData,
    utxoId?: string,
    transferMode?: TransactionRecord['transferMode']
): Promise<boolean> {
    const txHash = utxo.UTXO?.TXID || utxo.TXID || '';
    if (!txHash) return false;

    const history = await getTransactionHistory(accountId);
    const outgoing = history.filter((item) => item.txHash === txHash && item.type === 'send');
    if (outgoing.length > 0) {
        const normalizedAddr = normalizeAddress(address);
        const amount = parseAmount(utxo.Value || '0');
        const matchesRecipient = outgoing.some((item) => {
            const toAddr = normalizeAddress(item.to || '');
            const candidateAmount = parseAmount(item.amount || '0');
            return toAddr === normalizedAddr && candidateAmount === amount;
        });
        if (!matchesRecipient) {
            return false;
        }
    }

    const recordId = utxoId ? `in_${utxoId}` : `in_${txHash}`;
    if (history.some((item) => item.id === recordId)) {
        return false;
    }

    const fromAddress = utxo.UTXO?.TXInputsNormal?.[0]?.FromAddress || '';
    const record: TransactionRecord = {
        id: recordId,
        type: 'receive',
        status: 'success',
        transferMode: transferMode || 'incoming',
        amount: normalizeStoredAmount(utxo.Value || '0'),
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
    return true;
}

async function applyConfirmedTxIds(accountId: string, update: AccountUpdateInfo): Promise<void> {
    const confirmed = update.ConfirmedTxIDs;
    if (!Array.isArray(confirmed) || confirmed.length === 0) return;

    for (const txId of confirmed) {
        if (!txId) continue;
        const changed = await updateTransactionStatus(accountId, txId, 'success', {
            blockNumber: update.BlockHeight || 0,
        });
        if (changed) {
            dispatchHistoryUpdate(accountId, txId, 'success');
        }
        await notifyDappTxStatus(accountId, txId, 'success');
    }
}

function applyAddressInterest(account: UserAccount, update: AccountUpdateInfo): void {
    if (!update.AddressInterest) return;
    for (const [address, interest] of Object.entries(update.AddressInterest)) {
        const normalized = normalizeAddress(address);
        const info = account.addresses[normalized];
        if (!info) continue;
        const next = Number(interest) || 0;
        info.estInterest = next;
        (info as any).EstInterest = next;
        (info as any).gas = next;
    }
}

function applyUsedTxCerInterest(account: UserAccount, update: AccountUpdateInfo): void {
    if (!Array.isArray(update.UsedTXCerChangeData)) return;
    for (const used of update.UsedTXCerChangeData) {
        const normalized = normalizeAddress(used.ToAddress);
        const info = account.addresses[normalized];
        if (!info) continue;
        const base =
            Number((info as any).EstInterest ?? info.estInterest ?? (info as any).gas ?? 0) || 0;
        const next = base + (used.ToInterest || 0);
        info.estInterest = next;
        (info as any).EstInterest = next;
        (info as any).gas = next;
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

function formatTxCerId(txCerId: string): string {
    if (!txCerId) return '';
    return txCerId.length > 8 ? `${txCerId.slice(0, 8)}...` : txCerId;
}

function processTxCerChange(account: UserAccount, change: TXCerChangeToUser): void {
    const txCerId = change.TXCerID;
    if (!txCerId) return;

    if (shouldBlockTXCerUpdate(txCerId, change.Status)) {
        cacheTXCerUpdate(txCerId, change.Status, change.UTXO);
        return;
    }

    switch (change.Status) {
        case 0:
            applyTXCerStatus(account, {
                txCerID: txCerId,
                userID: account.accountId,
                address: '',
                status: 'ConvertedToUTXO',
                value: 0,
                sourcePosition: { BlockHeight: 0, Index: 0, InIndex: 0 },
                utxo: change.UTXO,
                reason: 'legacy_txcer_change',
                blockHeight: 0,
                updatedAt: Date.now(),
            });
            removeTxCer(account, txCerId);
            unlockTXCers([txCerId], false);
            notifyToast(`TXCer ${formatTxCerId(txCerId)} 已转换为 UTXO`, 'success');
            return;
        case 1:
            applyTXCerStatus(account, {
                txCerID: txCerId,
                userID: account.accountId,
                address: '',
                status: 'Invalid',
                value: 0,
                sourcePosition: { BlockHeight: 0, Index: 0, InIndex: 0 },
                reason: 'legacy_txcer_change',
                blockHeight: 0,
                updatedAt: Date.now(),
            });
            removeTxCer(account, txCerId);
            unlockTXCers([txCerId], false);
            notifyToast(`TXCer ${formatTxCerId(txCerId)} 验证失败`, 'error');
            return;
        case 2:
            markTXCerActive(account, txCerId, '', account.txCerStore?.[txCerId]?.Value || 0);
            notifyToast(`TXCer ${formatTxCerId(txCerId)} 已解除怀疑`, 'info');
            return;
        default:
            console.warn('[AccountPolling] Unknown TXCer status:', change.Status);
    }
}

function processTxCerStatusChange(account: UserAccount, view: TXCerStatusView): void {
    applyTXCerStatus(account, view);
    if (view.status === 'ConvertedToUTXO' || view.status === 'Exchanged' || view.status === 'Invalid') {
        unlockTXCers([view.txCerID], false);
    }
}

export async function processTxCerChangeDirectly(change: TXCerChangeToUser): Promise<void> {
    if (!change?.TXCerID) return;
    const accountId = activeAccountId || (await getActiveAccountId());
    if (!accountId) return;
    await mutateAccount(accountId, (latest) => {
        processTxCerChange(latest, change);
        recalcTotals(latest);
        return latest;
    });
    dispatchAccountUpdate(accountId);
}

interface TXCerDeliveryResult {
    accepted: boolean;
    newlyStored: boolean;
    txCerID?: string;
    reason?: string;
}

function processTxCerToUser(account: UserAccount, item: TXCerToUser): TXCerDeliveryResult {
    const normalized = normalizeAddress(item.ToAddress);
    const info = account.addresses[normalized];
    if (!item?.TXCer?.TXCerID) {
        return { accepted: false, newlyStored: false, reason: 'invalid_txcer_dto' };
    }
    if (!info) {
        return { accepted: false, newlyStored: false, txCerID: item.TXCer.TXCerID, reason: 'target_address_missing' };
    }
    if (info.type !== 0) {
        return { accepted: false, newlyStored: false, txCerID: item.TXCer.TXCerID, reason: 'target_address_type_unsupported' };
    }

    if (!info.txCers) info.txCers = {};
    const alreadyStored = info.txCers[item.TXCer.TXCerID] !== undefined;
    if (!alreadyStored) info.txCers[item.TXCer.TXCerID] = normalizeStoredAmount(item.TXCer.Value);

    const store = account.txCerStore || {};
    store[item.TXCer.TXCerID] = item.TXCer;
    account.txCerStore = store;
    const issuanceMetadata = extractTXCerIssuanceMetadata(item);
    if (issuanceMetadata) {
        account.txCerIssuanceRecords = account.txCerIssuanceRecords || {};
        account.txCerIssuanceRecords[item.TXCer.TXCerID] = mergeTXCerEvidenceMetadata(
            account.txCerIssuanceRecords[item.TXCer.TXCerID],
            issuanceMetadata,
        ) as TXCerIssuanceMetadata;
    }
    markTXCerActive(account, item.TXCer.TXCerID, normalized, item.TXCer.Value);

    recalcAddressBalance(info);
    return {
        accepted: true,
        newlyStored: !alreadyStored,
        txCerID: item.TXCer.TXCerID,
    };
}

function extractTXCerIssuanceMetadata(item: TXCerToUser): TXCerIssuanceMetadata | null {
    if (!item.IssuanceRecordID) {
        return null;
    }
    const detail = item.IssuanceRecord || {
        RecordID: item.IssuanceRecordID,
        Status: item.IssuanceStatus,
        Proof: item.IssuanceProof,
        BatchID: item.IssueBatchID,
        TXCer: item.TXCer,
        TXCerID: item.TXCer.TXCerID,
        TXID: item.TXCer.TXID,
        ToAddress: item.ToAddress,
        GuarGroupID: item.TXCer.FromGuarGroupID,
        LiabilityReceipt: item.LiabilityReceipt,
    } as TXCerIssuanceDetailView;
    const metadata = buildTXCerIssuanceMetadata(detail);
    metadata.deliveredAt = item.DeliveredAt;
    return metadata;
}

async function syncTXCerStatuses(force = false): Promise<void> {
    if (!activeAccountId || !activeGroupId) return;
    const requestAccountId = activeAccountId;
    const requestGroupId = activeGroupId;
    const requestAssignUrl = activeAssignUrl || API_BASE_URL;
    try {
        const endpoint = buildApiUrl(requestAssignUrl, API_ENDPOINTS.ASSIGN_TXCER_STATUSES(requestGroupId));
        const url = `${endpoint}?userID=${requestAccountId}`;
        const data = await apiClient.get<TXCerStatusResponse>(url, {
            timeout: 5000,
            retries: force ? 0 : 1,
            silent: true,
            useBigIntParsing: true,
        });
        if (!data.success || !Array.isArray(data.statuses)) return;
        await mutateAccount(requestAccountId, (latest) => {
            for (const view of data.statuses) processTxCerStatusChange(latest, view);
            recalcTotals(latest);
            return latest;
        });
        dispatchAccountUpdate(requestAccountId);
    } catch (error) {
        console.debug('[TXCerStatus] Full status sync skipped:', error);
    }
}

async function pollTXCerStatusChanges(
    accountId: string,
    groupId: string,
    assignUrl: string
): Promise<TXCerStatusView[]> {
    const endpoint = buildApiUrl(assignUrl, API_ENDPOINTS.ASSIGN_TXCER_STATUS_CHANGE(groupId));
    const url = `${endpoint}?userID=${accountId}&limit=10&consume=true`;
    const data = await apiClient.get<TXCerStatusChangeResponse>(url, {
        timeout: 5000,
        retries: 0,
        silent: true,
        useBigIntParsing: true,
    });
    if (!data.success || !Array.isArray(data.changes) || data.changes.length === 0) {
        return [];
    }
    return data.changes;
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
                const exTxCerIds = utxo?.UTXO?.ExTXCerID || [];
                if (Array.isArray(exTxCerIds) && exTxCerIds.length > 0) {
                    for (const txCerId of exTxCerIds) {
                        if (txCerId) {
                            removeTxCer(account, String(txCerId));
                        }
                    }
                }
                const tx = utxo.UTXO;
                const fromAddress = tx?.TXInputsNormal?.[0]?.FromAddress || '';
                const isCrossChainInbound =
                    tx?.TXType === 7 || fromAddress === 'Lightweight Computing Zone';
                const inferredMode: TransactionRecord['transferMode'] = isCrossChainInbound
                    ? 'cross'
                    : tx?.TXType === 8
                      ? 'normal'
                      : 'quick';
                const added = await maybeAddReceiveRecord(
                    account.accountId,
                    normalized,
                    utxo,
                    utxoId,
                    inferredMode
                );
                if (added) {
                    notifyToast(
                        isCrossChainInbound ? '收到跨链转账交易' : '收到转账交易',
                        'success'
                    );
                }
            }

            recalcAddressBalance(info);
        }
    }

    if (Array.isArray(update.WalletChangeData?.Out) && update.WalletChangeData.Out.length > 0) {
        const outIds = update.WalletChangeData.Out;
        const normalizedIds = outIds.map(normalizeUtxoId);

        // Unlock spent UTXOs (match frontend behavior).
        try {
            await unlockUTXOs([...normalizedIds, ...outIds]);
        } catch (error) {
            console.warn('[AccountPolling] Failed to unlock UTXOs:', error);
        }

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
    const requestAccountId = activeAccountId;
    const requestGroupId = activeGroupId;
    const requestAssignUrl = activeAssignUrl || API_BASE_URL;

    isPolling = true;
    try {
        const endpoint = buildApiUrl(requestAssignUrl, API_ENDPOINTS.ASSIGN_ACCOUNT_UPDATE(requestGroupId));
        const url = `${endpoint}?userID=${requestAccountId}&consume=true`;
        const data = await apiClient.get<AccountUpdateResponse>(url, {
            timeout: 5000,
            retries: 0,
            silent: true,
            useBigIntParsing: true,
        });
        consecutiveFailures = 0;
        if (!data.success || !data.updates?.length) return;

        await mutateAccount(requestAccountId, async (latest) => {
            for (const update of data.updates) await processAccountUpdate(latest, update);
            return latest;
        });
        dispatchAccountUpdate(requestAccountId);
    } catch (error) {
        consecutiveFailures += 1;
        if (isNetworkError(error) || isTimeoutError(error)) {
            // ignore, handled by retry/backoff
        }
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
    const requestAccountId = activeAccountId;
    const requestGroupId = activeGroupId;
    const requestAssignUrl = activeAssignUrl || API_BASE_URL;

    isPollingTXCer = true;
    try {
        const endpoint = buildApiUrl(requestAssignUrl, API_ENDPOINTS.ASSIGN_TXCER_CHANGE(requestGroupId));
        const url = `${endpoint}?userID=${requestAccountId}&limit=10&consume=true`;
        const data = await apiClient.get<TXCerChangeResponse>(url, {
            timeout: 5000,
            retries: 0,
            silent: true,
            useBigIntParsing: true,
        });
        txCerFailures = 0;

        const changes = data.success && data.changes?.length ? data.changes : [];
        let statusChanges: TXCerStatusView[] = [];
        try {
            statusChanges = await pollTXCerStatusChanges(requestAccountId, requestGroupId, requestAssignUrl);
        } catch (statusError) {
            console.debug('[TXCerStatus] Incremental poll skipped:', statusError);
        }
        if (changes.length === 0 && statusChanges.length === 0) return;

        await mutateAccount(requestAccountId, (latest) => {
            for (const change of changes) processTxCerChange(latest, change);
            for (const view of statusChanges) processTxCerStatusChange(latest, view);
            recalcTotals(latest);
            return latest;
        });
        dispatchAccountUpdate(requestAccountId);
    } catch (error) {
        txCerFailures += 1;
        if (txCerFailures >= MAX_CONSECUTIVE_FAILURES) {
            stopTXCerChangePolling();
        }
    } finally {
        isPollingTXCer = false;
    }
}

async function pollCrossOrgTXCers(_force = false): Promise<void> {
    if (isPollingCrossOrg) return;
    if (!activeAccountId || !activeGroupId) return;

    const requestAccountId = activeAccountId;
    const requestGroupId = activeGroupId;
    const requestAssignUrl = activeAssignUrl || API_BASE_URL;

    isPollingCrossOrg = true;
    try {
        const endpoint = buildApiUrl(requestAssignUrl, API_ENDPOINTS.ASSIGN_CROSS_ORG_TXCER(requestGroupId));
        const url = `${endpoint}?userID=${requestAccountId}&limit=10&consume=false`;
        const data = await apiClient.get<CrossOrgTXCerResponse>(url, {
            timeout: 5000,
            retries: 0,
            silent: true,
            useBigIntParsing: true,
        });
        crossOrgFailures = 0;
        if (!data.success || !data.txcers?.length) {
            await schedulePendingTXCerEvidenceRefreshes();
            return;
        }

        const acceptedIDs: string[] = [];
        await mutateAccount(requestAccountId, (latest) => {
            for (const item of data.txcers) {
                const result = processTxCerToUser(latest, item);
                if (result.accepted && result.txCerID) acceptedIDs.push(result.txCerID);
                if (!result.accepted) {
                    console.warn('[CrossOrgTXCer] Delivery retained for retry:', result.reason);
                }
            }
            recalcTotals(latest);
            return latest;
        });
        dispatchAccountUpdate(requestAccountId);
        for (const txCerID of acceptedIDs) {
            scheduleTXCerEvidenceRefresh(requestAccountId, txCerID);
        }
        await schedulePendingTXCerEvidenceRefreshes();
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
    void syncTXCerStatuses(true);
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
                    const requestAccountId = activeAccountId;
                    if (!requestAccountId) return;
                    await mutateAccount(requestAccountId, async (latest) => {
                        await processAccountUpdate(latest, data);
                        return latest;
                    });
                    dispatchAccountUpdate(requestAccountId);
                } catch (error) {
                    console.error('[AccountSSE] Failed to parse account_update:', error);
                }
            })();
        });

        eventSource.addEventListener('txcer_change', (event) => {
            void (async () => {
                try {
                    const data = parseBigIntJson<TXCerChangeToUser>((event as MessageEvent).data);
                    const requestAccountId = activeAccountId;
                    if (!requestAccountId) return;
                    await mutateAccount(requestAccountId, (latest) => {
                        processTxCerChange(latest, data);
                        recalcTotals(latest);
                        return latest;
                    });
                    dispatchAccountUpdate(requestAccountId);
                } catch (error) {
                    console.error('[AccountSSE] Failed to parse txcer_change:', error);
                }
            })();
        });

        eventSource.addEventListener('txcer_status_change', (event) => {
            void (async () => {
                try {
                    const data = parseBigIntJson<TXCerStatusView>((event as MessageEvent).data);
                    const requestAccountId = activeAccountId;
                    if (!requestAccountId) return;
                    await mutateAccount(requestAccountId, (latest) => {
                        processTxCerStatusChange(latest, data);
                        recalcTotals(latest);
                        return latest;
                    });
                    dispatchAccountUpdate(requestAccountId);
                } catch (error) {
                    console.error('[AccountSSE] Failed to parse txcer_status_change:', error);
                }
            })();
        });

        eventSource.addEventListener('cross_org_txcer', (event) => {
            void (async () => {
                try {
                    const requestAccountId = activeAccountId;
                    if (!requestAccountId) return;
                    const data = parseBigIntJson<TXCerToUser | CrossOrgTXCerResponse>((event as MessageEvent).data);
                    const acceptedIDs: string[] = [];
                    await mutateAccount(requestAccountId, (latest) => {
                        const items = (data as CrossOrgTXCerResponse).txcers || [data as TXCerToUser];
                        for (const item of items) {
                            const result = processTxCerToUser(latest, item);
                            if (result.accepted && result.txCerID) acceptedIDs.push(result.txCerID);
                        }
                        recalcTotals(latest);
                        return latest;
                    });
                    dispatchAccountUpdate(requestAccountId);
                    for (const txCerID of acceptedIDs) scheduleTXCerEvidenceRefresh(requestAccountId, txCerID);
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
                if (activeAccountId && data?.tx_id && data?.status) {
                    const accountId = activeAccountId;
                    void updateTransactionStatus(accountId, data.tx_id, data.status as any, {
                        blockNumber: data.block_height || 0,
                        failureReason: data.status === 'failed' ? data.error_reason || '' : undefined,
                    }).then((changed) => {
                        if (changed) {
                            dispatchHistoryUpdate(accountId, data.tx_id, data.status);
                        }
                        if (data.status === 'success' || data.status === 'failed') {
                            void notifyDappTxStatus(accountId, data.tx_id, data.status, {
                                error: data.status === 'failed' ? data.error_reason || '' : '',
                            });
                        }
                    });
                }
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
    activeAssignUrl = assignNodeUrl ? buildAssignNodeUrl(assignNodeUrl) : API_BASE_URL;
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
