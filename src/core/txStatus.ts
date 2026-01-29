import { buildAssignNodeUrl } from './api';
import { getOrganization, getTransactionHistory, updateTransactionStatus, type OrganizationChoice } from './storage';
import { waitForTXConfirmation, type TXStatusResponse } from './txBuilder';
import { startAccountPolling, stopAccountPolling } from './accountPolling';
import { unlockUTXOsByTxId } from './utxoLock';
import { getLockedTXCerIdsByTxId, unlockTXCers } from './txCerLockManager';

type ToastType = 'success' | 'error' | 'info' | 'warning';

const activeWatchers = new Set<string>();
let activeAccountId: string | null = null;

function getToastHandler():
    | ((message: string, type?: ToastType, title?: string, duration?: number) => void)
    | null {
    if (typeof window === 'undefined') return null;
    const anyWindow = window as any;
    if (anyWindow?.PanguPay?.ui?.showToast) return anyWindow.PanguPay.ui.showToast;
    if (anyWindow?.showToast) return anyWindow.showToast;
    return null;
}

function notifyToast(message: string, type: ToastType, title: string, duration: number): void {
    const handler = getToastHandler();
    if (!handler) return;
    handler(message, type, title, duration);
}

function dispatchHistoryUpdate(accountId: string, txHash: string, status: string): void {
    if (typeof window === 'undefined') return;
    const event = new CustomEvent('pangu_tx_history_updated', {
        detail: { accountId, txHash, status },
    });
    window.dispatchEvent(event);
}

function buildWatchKey(accountId: string, txHash: string): string {
    return `${accountId}:${txHash}`;
}

async function handleStatusChange(
    accountId: string,
    txHash: string,
    status: TXStatusResponse
): Promise<void> {
    if (status.status !== 'success' && status.status !== 'failed') return;
    const changed = await updateTransactionStatus(accountId, txHash, status.status, {
        blockNumber: status.block_height || 0,
        failureReason: status.status === 'failed' ? status.error_reason || '未知错误' : undefined,
    });
    if (changed) {
        dispatchHistoryUpdate(accountId, txHash, status.status);
    }
}

async function watchTransactionStatus(
    accountId: string,
    txHash: string,
    org: OrganizationChoice
): Promise<void> {
    if (!org.groupId) return;
    const watchKey = buildWatchKey(accountId, txHash);
    if (activeWatchers.has(watchKey)) return;
    activeWatchers.add(watchKey);

    try {
        const endpoint = org.assignAPIEndpoint || org.assignNodeUrl || '';
        const assignUrl = endpoint ? buildAssignNodeUrl(endpoint) : undefined;
        const result = await waitForTXConfirmation(txHash, org.groupId, assignUrl, {
            pollInterval: 2000,
            maxWaitTime: 60000,
            onStatusChange: (status) => {
                void handleStatusChange(accountId, txHash, status);
            },
        });

        if (result.success && result.response) {
            await handleStatusChange(accountId, txHash, result.response);
            return;
        }

        if (result.timeout) {
            notifyToast(
                `交易 ${txHash.slice(0, 8)}... 确认超时，请稍后查看交易历史`,
                'warning',
                '确认超时',
                5000
            );
            return;
        }

        if (result.status === 'failed') {
            const reason = result.errorReason || '未知错误';
            notifyToast(`交易验证失败: ${reason}`, 'error', '交易验证失败', 8000);
            const changed = await updateTransactionStatus(accountId, txHash, 'failed', {
                failureReason: reason,
            });
            if (changed) {
                dispatchHistoryUpdate(accountId, txHash, 'failed');
            }
            try {
                await unlockUTXOsByTxId(txHash);
            } catch (error) {
                console.warn('[交易状态] 解锁 UTXO 失败:', error);
            }
            try {
                const lockedTxCers = getLockedTXCerIdsByTxId(txHash);
                if (lockedTxCers.length > 0) {
                    unlockTXCers(lockedTxCers, false);
                }
            } catch (error) {
                console.warn('[交易状态] 解锁 TXCer 失败:', error);
            }
        }
    } catch (error) {
        console.warn('[交易状态] 监听失败:', error);
    } finally {
        activeWatchers.delete(watchKey);
    }
}

export async function startTxStatusSync(accountId: string): Promise<void> {
    if (!accountId) return;
    if (activeAccountId && activeAccountId !== accountId) {
        stopTxStatusSync();
    }
    activeAccountId = accountId;

    const org = await getOrganization(accountId);
    if (org?.groupId) {
        startAccountPolling(accountId, org.groupId, org.assignAPIEndpoint || org.assignNodeUrl);
    } else {
        stopAccountPolling();
        return;
    }

    const history = await getTransactionHistory(accountId);
    const pending = history.filter((tx) => tx.status === 'pending' && tx.txHash);
    for (const tx of pending) {
        if (tx.txHash) {
            void watchTransactionStatus(accountId, tx.txHash, org);
        }
    }
}

export async function watchSubmittedTransaction(accountId: string, txHash: string): Promise<void> {
    if (!accountId || !txHash) return;
    await startTxStatusSync(accountId);
    const org = await getOrganization(accountId);
    if (!org?.groupId) return;
    await watchTransactionStatus(accountId, txHash, org);
}

export function stopTxStatusSync(): void {
    activeWatchers.clear();
    activeAccountId = null;
    stopAccountPolling();
}
