import type { TXCerLifecycleStatus, TXCerStatusView } from './blockchain';
import type { UserAccount } from './storage';
import { formatAmount, parseAmount, toAmountNumber, type AmountInput } from './amount';
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
    const clientRecord = account.txCerIssuanceRecords?.[view.txCerID];
    if (clientRecord) {
        clientRecord.lifecycleStatus = view.status;
        if (clientRecord.security) {
            clientRecord.security.spendabilityStatus = view.status === 'Active' ? 'Active' : 'NonSpendable';
        }
    }
    if (TXCER_TERMINAL_STATUSES.includes(view.status)) {
        removeTXCerFromSpendableStores(account, view.txCerID);
    }
}

export function markTXCerActive(account: UserAccount, txCerID: string, address: string, value: AmountInput): void {
    if (!txCerID) return;
    ensureTXCerStatusStore(account)[txCerID] = {
        txCerID,
        userID: account.accountId,
        address,
        status: 'Active',
        value: formatAmount(parseAmount(value)),
        sourcePosition: { BlockHeight: 0, Index: 0, InIndex: 0 },
        blockHeight: 0,
        updatedAt: Date.now(),
    };
    const clientRecord = account.txCerIssuanceRecords?.[txCerID];
    if (clientRecord) {
        clientRecord.lifecycleStatus = 'Active';
        if (clientRecord.security) clientRecord.security.spendabilityStatus = 'Active';
    }
}

type TXCerStatusOwner = (Partial<UserAccount> & {
    wallet?: { txCerStatuses?: Record<string, TXCerStatusView>; txCerIssuanceRecords?: UserAccount['txCerIssuanceRecords'] };
}) | null | undefined;

function readTXCerStatusStore(owner: TXCerStatusOwner): Record<string, TXCerStatusView> | undefined {
    return owner?.txCerStatuses || owner?.wallet?.txCerStatuses;
}

export function getTXCerStatus(account: TXCerStatusOwner, txCerID: string): TXCerLifecycleStatus | undefined {
    return readTXCerStatusStore(account)?.[txCerID]?.status;
}

export function isTXCerSpendable(
    account: TXCerStatusOwner,
    txCerID: string,
    allowedDraftLockOwner?: string
): boolean {
    const metadata = account?.txCerIssuanceRecords?.[txCerID] || account?.wallet?.txCerIssuanceRecords?.[txCerID];
    const fastFailed = metadata?.security?.fastEvidenceStatus === 'Failed';
    const legacyProofFailed = !metadata?.security && metadata?.proofStatus === 'invalid';
    return getTXCerStatus(account, txCerID) === 'Active'
        && !fastFailed
        && !legacyProofFailed
        && !isTXCerLocked(txCerID, allowedDraftLockOwner);
}

export function sumSpendableTXCerValue(account: UserAccount, txCers: Record<string, AmountInput> | undefined): number {
    return toAmountNumber(sumSpendableTXCerUnits(account, txCers));
}

export function sumSpendableTXCerUnits(account: UserAccount, txCers: Record<string, AmountInput> | undefined): bigint {
    return Object.entries(txCers || {}).reduce((sum, [id, value]) => {
        if (!isTXCerSpendable(account, id)) return sum;
        return sum + parseAmount(value || '0');
    }, 0n);
}

export function removeTXCerFromSpendableStores(account: UserAccount, txCerID: string): void {
    delete account.txCerStore?.[txCerID];
    for (const info of Object.values(account.addresses || {})) {
        if (info?.txCers && info.txCers[txCerID] !== undefined) {
            delete info.txCers[txCerID];
            info.txCerCount = Object.keys(info.txCers).length;
        }
    }
}
