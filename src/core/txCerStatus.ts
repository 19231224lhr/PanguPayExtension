import type { TXCerLifecycleStatus, TXCerStatusView } from './blockchain';
import type { UserAccount } from './storage';
import { isTXCerLocked } from './txCerLockManager';

export const TXCER_TERMINAL_STATUSES: TXCerLifecycleStatus[] = [
    'Exchanged',
    'ConvertedToUTXO',
    'Invalid',
];

export function ensureTXCerStatusStore(account: UserAccount): Record<string, TXCerStatusView> {
    if (!account.txCerStatuses) {
        account.txCerStatuses = {};
    }
    return account.txCerStatuses;
}

export function applyTXCerStatus(account: UserAccount, view: TXCerStatusView): void {
    if (!view?.txCerID) return;
    const store = ensureTXCerStatusStore(account);
    store[view.txCerID] = view;
    if (TXCER_TERMINAL_STATUSES.includes(view.status)) {
        removeTXCerFromSpendableStores(account, view.txCerID);
    }
}

export function markTXCerActive(account: UserAccount, txCerID: string, address: string, value: number): void {
    if (!txCerID) return;
    ensureTXCerStatusStore(account)[txCerID] = {
        txCerID,
        userID: account.accountId,
        address,
        status: 'Active',
        value,
        sourcePosition: { BlockHeight: 0, Index: 0, InIndex: 0 },
        blockHeight: 0,
        updatedAt: Date.now(),
    };
}

type TXCerStatusOwner = (Partial<UserAccount> & {
    wallet?: { txCerStatuses?: Record<string, TXCerStatusView> };
}) | null | undefined;

function readTXCerStatusStore(owner: TXCerStatusOwner): Record<string, TXCerStatusView> | undefined {
    return owner?.txCerStatuses || owner?.wallet?.txCerStatuses;
}

export function getTXCerStatus(account: TXCerStatusOwner, txCerID: string): TXCerLifecycleStatus | undefined {
    return readTXCerStatusStore(account)?.[txCerID]?.status;
}

export function isTXCerSpendable(account: TXCerStatusOwner, txCerID: string): boolean {
    return getTXCerStatus(account, txCerID) === 'Active' && !isTXCerLocked(txCerID);
}

export function sumSpendableTXCerValue(account: UserAccount, txCers: Record<string, number> | undefined): number {
    return Object.entries(txCers || {}).reduce((sum, [id, value]) => {
        if (!isTXCerSpendable(account, id)) return sum;
        return sum + Number(value || 0);
    }, 0);
}

export function removeTXCerFromSpendableStores(account: UserAccount, txCerID: string): void {
    delete account.txCerStore?.[txCerID];
    delete account.txCerIssuanceRecords?.[txCerID];
    for (const info of Object.values(account.addresses || {})) {
        if (info?.txCers && info.txCers[txCerID] !== undefined) {
            delete info.txCers[txCerID];
            info.txCerCount = Object.keys(info.txCers).length;
        }
    }
}
