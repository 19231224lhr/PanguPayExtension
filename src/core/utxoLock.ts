import { getActiveAccountId, getStorageData, setStorageData, removeStorageData } from './storage';

export interface LockedUTXO {
    utxoId: string;
    address: string;
    value: number;
    type: number;
    lockTime: number;
    txId: string;
}

interface LockedUTXOStorage {
    version: number;
    lockedUtxos: LockedUTXO[];
    lastUpdate: number;
}

const STORAGE_VERSION = 1;
const STORAGE_KEY_PREFIX = 'pangu_utxo_locks_';
const LOCK_EXPIRY_MS = 24 * 60 * 60 * 1000;

let activeAccountId: string | null = null;
const lockedUtxos = new Map<string, LockedUTXO>();

function getStorageKey(accountId: string): string {
    return `${STORAGE_KEY_PREFIX}${accountId}`;
}

async function hydrateLocks(accountId: string): Promise<void> {
    if (!accountId) return;
    const key = getStorageKey(accountId);
    const data = await getStorageData<LockedUTXOStorage>(key);
    lockedUtxos.clear();
    activeAccountId = accountId;
    if (!data || data.version !== STORAGE_VERSION) {
        return;
    }
    const now = Date.now();
    for (const lock of data.lockedUtxos || []) {
        if (now - lock.lockTime < LOCK_EXPIRY_MS) {
            lockedUtxos.set(lock.utxoId, lock);
        }
    }
}

async function ensureActiveAccount(): Promise<void> {
    const accountId = await getActiveAccountId();
    if (!accountId) {
        activeAccountId = null;
        lockedUtxos.clear();
        return;
    }
    if (accountId !== activeAccountId) {
        await hydrateLocks(accountId);
    }
}

async function persistLocks(): Promise<void> {
    if (!activeAccountId) return;
    const key = getStorageKey(activeAccountId);
    const payload: LockedUTXOStorage = {
        version: STORAGE_VERSION,
        lockedUtxos: Array.from(lockedUtxos.values()),
        lastUpdate: Date.now(),
    };
    await setStorageData(key, payload);
}

export async function lockUTXOs(
    utxos: Omit<LockedUTXO, 'lockTime' | 'txId'>[],
    txId: string
): Promise<void> {
    if (!utxos.length || !txId) return;
    await ensureActiveAccount();
    if (!activeAccountId) return;

    const now = Date.now();
    for (const utxo of utxos) {
        if (!lockedUtxos.has(utxo.utxoId)) {
            lockedUtxos.set(utxo.utxoId, {
                ...utxo,
                lockTime: now,
                txId,
            });
        }
    }
    await persistLocks();
}

export async function unlockUTXOs(utxoIds: string[]): Promise<void> {
    if (!utxoIds.length) return;
    await ensureActiveAccount();
    if (!activeAccountId) return;
    for (const utxoId of utxoIds) {
        lockedUtxos.delete(utxoId);
    }
    await persistLocks();
}

export async function unlockUTXOsByTxId(txId: string): Promise<void> {
    if (!txId) return;
    await ensureActiveAccount();
    if (!activeAccountId) return;
    const normalized = txId.toLowerCase();
    for (const [key, lock] of lockedUtxos.entries()) {
        if ((lock.txId || '').toLowerCase() === normalized) {
            lockedUtxos.delete(key);
        }
    }
    await persistLocks();
}

export function isUTXOLocked(utxoId: string): boolean {
    if (!utxoId) return false;
    const lock = lockedUtxos.get(utxoId);
    if (!lock) return false;
    if (Date.now() - lock.lockTime > LOCK_EXPIRY_MS) {
        lockedUtxos.delete(utxoId);
        void persistLocks();
        return false;
    }
    return true;
}

export function getLockedUTXOs(): LockedUTXO[] {
    const now = Date.now();
    const results: LockedUTXO[] = [];
    for (const [key, lock] of lockedUtxos.entries()) {
        if (now - lock.lockTime > LOCK_EXPIRY_MS) {
            lockedUtxos.delete(key);
            continue;
        }
        results.push(lock);
    }
    if (results.length !== lockedUtxos.size) {
        void persistLocks();
    }
    return results;
}

export async function clearAllLockedUTXOs(): Promise<void> {
    await ensureActiveAccount();
    if (!activeAccountId) return;
    lockedUtxos.clear();
    await removeStorageData(getStorageKey(activeAccountId));
}

void getActiveAccountId().then((accountId) => {
    if (!accountId) return;
    void hydrateLocks(accountId);
});
