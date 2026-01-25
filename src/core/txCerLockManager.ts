import { getActiveAccountId, getStorageData, setStorageData } from './storage';

interface TXCerLock {
    txCerId: string;
    lockTime: number;
    mode: 'draft' | 'submitted';
    reason: string;
    relatedTXID?: string;
}

interface PendingTXCerUpdate {
    txCerId: string;
    status: number;
    utxo?: string;
    receivedTime: number;
}

interface LockedTXCerStorage {
    version: number;
    locks: TXCerLock[];
    lastUpdate: number;
}

const STORAGE_VERSION = 1;
const STORAGE_KEY_PREFIX = 'pangu_txcer_locks_';
const DRAFT_LOCK_TIMEOUT = 30000;
const SUBMITTED_LOCK_TIMEOUT = 24 * 60 * 60 * 1000;

let activeAccountId: string | null = null;
const lockedTXCers = new Map<string, TXCerLock>();
const pendingUpdates = new Map<string, PendingTXCerUpdate>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function getStorageKey(accountId: string): string {
    return `${STORAGE_KEY_PREFIX}${accountId}`;
}

async function hydrateLocks(accountId: string): Promise<void> {
    if (!accountId) return;
    const key = getStorageKey(accountId);
    const data = await getStorageData<LockedTXCerStorage>(key);
    lockedTXCers.clear();
    activeAccountId = accountId;
    if (!data || data.version !== STORAGE_VERSION) return;
    const now = Date.now();
    let restored = 0;
    for (const lock of data.locks || []) {
        const timeout = lock.mode === 'submitted' ? SUBMITTED_LOCK_TIMEOUT : DRAFT_LOCK_TIMEOUT;
        if (now - lock.lockTime < timeout) {
            lockedTXCers.set(lock.txCerId, lock);
            restored += 1;
        }
    }
    if (restored > 0) {
        ensureCleanupTimer();
    }
}

async function ensureActiveAccount(): Promise<void> {
    const accountId = await getActiveAccountId();
    if (!accountId) {
        activeAccountId = null;
        lockedTXCers.clear();
        pendingUpdates.clear();
        return;
    }
    if (accountId !== activeAccountId) {
        await hydrateLocks(accountId);
    }
}

async function persistLocks(): Promise<void> {
    if (!activeAccountId) return;
    const key = getStorageKey(activeAccountId);
    const payload: LockedTXCerStorage = {
        version: STORAGE_VERSION,
        locks: Array.from(lockedTXCers.values()),
        lastUpdate: Date.now(),
    };
    await setStorageData(key, payload);
}

function processPendingUpdateNow(update: PendingTXCerUpdate): void {
    import('./accountPolling')
        .then(({ processTxCerChangeDirectly }) => {
            if (typeof processTxCerChangeDirectly !== 'function') return;
            processTxCerChangeDirectly({
                TXCerID: update.txCerId,
                Status: update.status,
                UTXO: update.utxo || '',
                Sig: { R: '', S: '' },
            });
        })
        .catch((err) => {
            console.error('[TXCerLock] Failed to process pending update:', err);
        });
}

function cleanupTimeoutLocks(): void {
    const now = Date.now();
    const toUnlock: string[] = [];

    for (const [txCerId, lock] of lockedTXCers.entries()) {
        const timeout = lock.mode === 'submitted' ? SUBMITTED_LOCK_TIMEOUT : DRAFT_LOCK_TIMEOUT;
        if (now - lock.lockTime > timeout) {
            toUnlock.push(txCerId);
        }
    }

    if (toUnlock.length > 0) {
        unlockTXCers(toUnlock, true);
    }

    if (lockedTXCers.size === 0 && cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
}

function ensureCleanupTimer(): void {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(cleanupTimeoutLocks, 5000);
}

export function lockTXCers(
    txCerIds: string[],
    reason: string = '构造交易中',
    relatedTXID?: string
): string[] {
    const lockedIds: string[] = [];
    const now = Date.now();
    for (const txCerId of txCerIds) {
        if (lockedTXCers.has(txCerId)) continue;
        lockedTXCers.set(txCerId, {
            txCerId,
            lockTime: now,
            mode: 'draft',
            reason,
            relatedTXID,
        });
        lockedIds.push(txCerId);
    }
    if (lockedIds.length > 0) {
        ensureCleanupTimer();
    }
    void ensureActiveAccount().then(persistLocks);
    return lockedIds;
}

export function markTXCersSubmitted(
    txCerIds: string[],
    relatedTXID: string,
    reason: string = '交易已提交'
): void {
    const now = Date.now();
    for (const txCerId of txCerIds) {
        const existing = lockedTXCers.get(txCerId);
        lockedTXCers.set(txCerId, {
            txCerId,
            lockTime: existing?.lockTime ?? now,
            mode: 'submitted',
            reason,
            relatedTXID,
        });
        const pending = pendingUpdates.get(txCerId);
        if (pending && (pending.status === 0 || pending.status === 1)) {
            unlockTXCers([txCerId], true);
        }
    }
    if (txCerIds.length > 0) {
        ensureCleanupTimer();
    }
    void ensureActiveAccount().then(persistLocks);
}

export function unlockTXCers(txCerIds: string[], processPending: boolean = true): number {
    let unlocked = 0;
    for (const txCerId of txCerIds) {
        if (!lockedTXCers.has(txCerId)) continue;
        lockedTXCers.delete(txCerId);
        unlocked += 1;
        if (processPending && pendingUpdates.has(txCerId)) {
            const update = pendingUpdates.get(txCerId)!;
            pendingUpdates.delete(txCerId);
            processPendingUpdateNow(update);
        }
    }
    if (lockedTXCers.size === 0 && cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
    void ensureActiveAccount().then(persistLocks);
    return unlocked;
}

export function getLockedTXCerIdsByTxId(txId: string): string[] {
    const normalized = String(txId || '').toLowerCase();
    if (!normalized) return [];
    const ids: string[] = [];
    for (const lock of lockedTXCers.values()) {
        if ((lock.relatedTXID || '').toLowerCase() === normalized) {
            ids.push(lock.txCerId);
        }
    }
    return ids;
}

export function shouldBlockTXCerUpdate(txCerId: string, status: number): boolean {
    const lock = lockedTXCers.get(txCerId);
    if (!lock) return false;
    if (status === 0 || status === 1) {
        return lock.mode === 'draft';
    }
    return false;
}

export function cacheTXCerUpdate(txCerId: string, status: number, utxo?: string): void {
    pendingUpdates.set(txCerId, {
        txCerId,
        status,
        utxo,
        receivedTime: Date.now(),
    });
}

export function isTXCerLocked(txCerId: string): boolean {
    const lock = lockedTXCers.get(txCerId);
    if (!lock) return false;
    const timeout = lock.mode === 'submitted' ? SUBMITTED_LOCK_TIMEOUT : DRAFT_LOCK_TIMEOUT;
    if (Date.now() - lock.lockTime > timeout) {
        unlockTXCers([txCerId], true);
        return false;
    }
    return true;
}

void getActiveAccountId().then((accountId) => {
    if (!accountId) return;
    void hydrateLocks(accountId);
});
