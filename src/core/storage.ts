/**
 * Chrome Storage 适配层
 * 
 * 将 localStorage 操作替换为 chrome.storage.local
 */

// ========================================
// 类型定义
// ========================================

export interface WalletKeys {
    privHex: string;
    pubXHex: string;
    pubYHex: string;
}

export interface AddressInfo {
    address: string;
    type: number; // 0=PGC, 1=BTC, 2=ETH
    balance: number;
    utxoCount: number;
    txCerCount: number;
    privHex?: string;
    pubXHex?: string;
    pubYHex?: string;
}

export interface UserAccount {
    accountId: string;
    mainAddress: string;
    addresses: Record<string, AddressInfo>;
    organizationId?: string;
    organizationName?: string;
    totalBalance: Record<number, number>; // coinType -> balance
    createdAt: number;
    lastLogin: number;
}

export interface EncryptedAccount {
    accountId: string;
    encrypted: string;
    salt: string;
    iv: string;
    mainAddress: string;
}

export interface TransactionRecord {
    id: string;
    type: 'send' | 'receive';
    status: 'pending' | 'success' | 'failed';
    amount: number;
    coinType: number;
    from: string;
    to: string;
    timestamp: number;
    txHash?: string;
    blockNumber?: number;
}

// ========================================
// Storage Keys
// ========================================

const STORAGE_KEYS = {
    ACCOUNTS: 'pangu_accounts',
    ACTIVE_ACCOUNT: 'pangu_active_account',
    ENCRYPTED_KEYS: 'pangu_encrypted_keys',
    SETTINGS: 'pangu_settings',
    TX_HISTORY: 'pangu_tx_history',
    ORGANIZATION: 'pangu_organization',
};

// ========================================
// Storage Functions
// ========================================

export async function getStorageData<T>(key: string): Promise<T | null> {
    return new Promise((resolve) => {
        chrome.storage.local.get(key, (result) => {
            resolve(result[key] || null);
        });
    });
}

export async function setStorageData<T>(key: string, value: T): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, resolve);
    });
}

export async function removeStorageData(key: string): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.local.remove(key, resolve);
    });
}

// ========================================
// Account Functions
// ========================================

export async function saveAccount(account: UserAccount): Promise<void> {
    const accounts = await getStorageData<Record<string, UserAccount>>(STORAGE_KEYS.ACCOUNTS) || {};
    accounts[account.accountId] = account;
    await setStorageData(STORAGE_KEYS.ACCOUNTS, accounts);
}

export async function getAccount(accountId: string): Promise<UserAccount | null> {
    const accounts = await getStorageData<Record<string, UserAccount>>(STORAGE_KEYS.ACCOUNTS);
    return accounts?.[accountId] || null;
}

export async function getAllAccounts(): Promise<UserAccount[]> {
    const accounts = await getStorageData<Record<string, UserAccount>>(STORAGE_KEYS.ACCOUNTS);
    return accounts ? Object.values(accounts) : [];
}

export async function deleteAccount(accountId: string): Promise<void> {
    const accounts = await getStorageData<Record<string, UserAccount>>(STORAGE_KEYS.ACCOUNTS) || {};
    delete accounts[accountId];
    await setStorageData(STORAGE_KEYS.ACCOUNTS, accounts);

    // 删除加密密钥
    const keys = await getStorageData<Record<string, EncryptedAccount>>(STORAGE_KEYS.ENCRYPTED_KEYS) || {};
    delete keys[accountId];
    await setStorageData(STORAGE_KEYS.ENCRYPTED_KEYS, keys);
}

// ========================================
// Active Account
// ========================================

export async function setActiveAccount(accountId: string): Promise<void> {
    await setStorageData(STORAGE_KEYS.ACTIVE_ACCOUNT, accountId);
}

export async function getActiveAccountId(): Promise<string | null> {
    return await getStorageData<string>(STORAGE_KEYS.ACTIVE_ACCOUNT);
}

export async function getActiveAccount(): Promise<UserAccount | null> {
    const accountId = await getActiveAccountId();
    if (!accountId) return null;
    return await getAccount(accountId);
}

// ========================================
// Encrypted Keys
// ========================================

export async function saveEncryptedKey(accountId: string, data: Omit<EncryptedAccount, 'accountId'>): Promise<void> {
    const keys = await getStorageData<Record<string, EncryptedAccount>>(STORAGE_KEYS.ENCRYPTED_KEYS) || {};
    keys[accountId] = { accountId, ...data };
    await setStorageData(STORAGE_KEYS.ENCRYPTED_KEYS, keys);
}

export async function getEncryptedKey(accountId: string): Promise<EncryptedAccount | null> {
    const keys = await getStorageData<Record<string, EncryptedAccount>>(STORAGE_KEYS.ENCRYPTED_KEYS);
    return keys?.[accountId] || null;
}

export async function hasEncryptedKey(accountId: string): Promise<boolean> {
    const key = await getEncryptedKey(accountId);
    return !!key;
}

// ========================================
// Transaction History
// ========================================

export async function saveTransaction(accountId: string, tx: TransactionRecord): Promise<void> {
    const history = await getStorageData<Record<string, TransactionRecord[]>>(STORAGE_KEYS.TX_HISTORY) || {};
    if (!history[accountId]) {
        history[accountId] = [];
    }
    history[accountId].unshift(tx);
    // 只保留最近 100 条
    if (history[accountId].length > 100) {
        history[accountId] = history[accountId].slice(0, 100);
    }
    await setStorageData(STORAGE_KEYS.TX_HISTORY, history);
}

export async function getTransactionHistory(accountId: string): Promise<TransactionRecord[]> {
    const history = await getStorageData<Record<string, TransactionRecord[]>>(STORAGE_KEYS.TX_HISTORY);
    return history?.[accountId] || [];
}

// ========================================
// Organization
// ========================================

export interface OrganizationChoice {
    groupId: string;
    groupName: string;
    assignNodeUrl: string;
    aggrNodeUrl: string;
    pledgeAddress: string;
}

export async function saveOrganization(accountId: string, org: OrganizationChoice): Promise<void> {
    const orgs = await getStorageData<Record<string, OrganizationChoice>>(STORAGE_KEYS.ORGANIZATION) || {};
    orgs[accountId] = org;
    await setStorageData(STORAGE_KEYS.ORGANIZATION, orgs);
}

export async function getOrganization(accountId: string): Promise<OrganizationChoice | null> {
    const orgs = await getStorageData<Record<string, OrganizationChoice>>(STORAGE_KEYS.ORGANIZATION);
    return orgs?.[accountId] || null;
}

// ========================================
// Settings
// ========================================

export interface ExtensionSettings {
    language: 'zh-CN' | 'en';
    theme: 'light' | 'dark';
    autoLockMinutes: number;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
    language: 'zh-CN',
    theme: 'light',
    autoLockMinutes: 15,
};

export async function getSettings(): Promise<ExtensionSettings> {
    const settings = await getStorageData<ExtensionSettings>(STORAGE_KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...settings };
}

export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
    const current = await getSettings();
    await setStorageData(STORAGE_KEYS.SETTINGS, { ...current, ...settings });
}

// ========================================
// Session (内存中的解锁状态)
// ========================================

let sessionPrivateKey: string | null = null;
let sessionAccountId: string | null = null;

export function setSessionKey(accountId: string, privKey: string): void {
    sessionAccountId = accountId;
    sessionPrivateKey = privKey;
}

export function getSessionKey(): { accountId: string; privKey: string } | null {
    if (sessionAccountId && sessionPrivateKey) {
        return { accountId: sessionAccountId, privKey: sessionPrivateKey };
    }
    return null;
}

export function clearSession(): void {
    sessionAccountId = null;
    sessionPrivateKey = null;
}

export function isUnlocked(): boolean {
    return sessionPrivateKey !== null;
}
