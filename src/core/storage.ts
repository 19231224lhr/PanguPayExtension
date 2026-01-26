/**
 * Chrome Storage 适配层
 *
 * 将 localStorage 操作替换为 chrome.storage.local
 */

import type { TxCertificate, UTXOData } from './blockchain';

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
    source?: 'created' | 'imported';
    privHex?: string;
    pubXHex?: string;
    pubYHex?: string;
    utxos?: Record<string, UTXOData>;
    txCers?: Record<string, number>;
    value?: { totalValue: number; utxoValue: number; txCerValue: number };
    estInterest?: number;
    publicKeyNew?: { CurveName: string; X: number | string; Y: number | string };
    locked?: boolean;
}

export interface UserAccount {
    accountId: string;
    mainAddress: string;
    addresses: Record<string, AddressInfo>;
    defaultAddress?: string;
    txCerStore?: Record<string, TxCertificate>;
    organizationId?: string;
    organizationName?: string;
    onboardingComplete?: boolean;
    onboardingStep?: OnboardingStep;
    totalBalance: Record<number, number>; // coinType -> balance
    createdAt: number;
    lastLogin: number;
}

export type OnboardingStep = 'wallet' | 'organization' | 'complete';

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
    SESSION: 'pangu_session',
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

export async function clearActiveAccount(): Promise<void> {
    await removeStorageData(STORAGE_KEYS.ACTIVE_ACCOUNT);
}

export async function getActiveAccount(): Promise<UserAccount | null> {
    const accountId = await getActiveAccountId();
    if (!accountId) return null;
    return await getAccount(accountId);
}

// ========================================
// Onboarding
// ========================================

export async function setOnboardingComplete(accountId: string, complete: boolean): Promise<void> {
    await setOnboardingStep(accountId, complete ? 'complete' : 'organization');
}

export async function setOnboardingStep(accountId: string, step: OnboardingStep): Promise<void> {
    const account = await getAccount(accountId);
    if (!account) return;
    account.onboardingStep = step;
    account.onboardingComplete = step === 'complete';
    await saveAccount(account);
}

export async function getOnboardingStep(accountId: string): Promise<OnboardingStep> {
    const account = await getAccount(accountId);
    if (!account) return 'complete';

    if (account.onboardingStep) return account.onboardingStep;
    if (account.onboardingComplete === false) return 'organization';

    return 'complete';
}

export async function isOnboardingComplete(accountId: string): Promise<boolean> {
    return (await getOnboardingStep(accountId)) === 'complete';
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

export async function clearTransactionHistory(accountId: string): Promise<void> {
    if (!accountId) return;
    const history = await getStorageData<Record<string, TransactionRecord[]>>(STORAGE_KEYS.TX_HISTORY) || {};
    if (history[accountId]) {
        delete history[accountId];
        await setStorageData(STORAGE_KEYS.TX_HISTORY, history);
    }
}

export async function updateTransactionStatus(
    accountId: string,
    txHash: string,
    status: TransactionRecord['status'],
    options: { blockNumber?: number } = {}
): Promise<boolean> {
    if (!accountId || !txHash) return false;
    const history = await getStorageData<Record<string, TransactionRecord[]>>(STORAGE_KEYS.TX_HISTORY) || {};
    const list = history[accountId] || [];
    let changed = false;

    for (const item of list) {
        if (item.txHash === txHash) {
            if (item.status !== status) {
                item.status = status;
                changed = true;
            }
            if (options.blockNumber && item.blockNumber !== options.blockNumber) {
                item.blockNumber = options.blockNumber;
                changed = true;
            }
        }
    }

    if (changed) {
        history[accountId] = list;
        await setStorageData(STORAGE_KEYS.TX_HISTORY, history);
    }

    return changed;
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

export async function clearOrganization(accountId: string): Promise<void> {
    const orgs = await getStorageData<Record<string, OrganizationChoice>>(STORAGE_KEYS.ORGANIZATION) || {};
    delete orgs[accountId];
    await setStorageData(STORAGE_KEYS.ORGANIZATION, orgs);
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
    autoLockMinutes: 10,
};

export async function getSettings(): Promise<ExtensionSettings> {
    const settings = await getStorageData<ExtensionSettings>(STORAGE_KEYS.SETTINGS);
    return {
        ...DEFAULT_SETTINGS,
        ...settings,
        autoLockMinutes: DEFAULT_SETTINGS.autoLockMinutes,
    };
}

export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
    const current = await getSettings();
    await setStorageData(STORAGE_KEYS.SETTINGS, { ...current, ...settings });
}

// ========================================
// Session (内存中的解锁状态)
// ========================================

interface SessionRecord {
    accountId: string;
    privKey: string;
    expiresAt: number;
    addressKeys?: Record<string, string>;
}

let sessionPrivateKey: string | null = null;
let sessionAccountId: string | null = null;
let sessionExpiresAt: number | null = null;
let sessionAutoLockMs = DEFAULT_SETTINGS.autoLockMinutes * 60 * 1000;
const sessionAddressKeys = new Map<string, string>();

function normalizeSessionAddressKey(address: string): string {
    return String(address || '').trim().toLowerCase();
}

export function setSessionKey(accountId: string, privKey: string): void {
    sessionAccountId = accountId;
    sessionPrivateKey = privKey;
    void refreshSessionExpiry();
}

export function getSessionKey(): { accountId: string; privKey: string } | null {
    if (!sessionAccountId || !sessionPrivateKey) return null;
    if (isSessionExpired()) {
        clearSession();
        return null;
    }
    void refreshSessionExpiry();
    return { accountId: sessionAccountId, privKey: sessionPrivateKey };
}

export function clearSession(): void {
    sessionAccountId = null;
    sessionPrivateKey = null;
    sessionExpiresAt = null;
    sessionAddressKeys.clear();
    void removeStorageData(STORAGE_KEYS.SESSION);
}

export function isUnlocked(): boolean {
    return getSessionKey() !== null;
}

export function setSessionAddressKey(address: string, privKey: string): void {
    sessionAddressKeys.set(normalizeSessionAddressKey(address), privKey);
    void refreshSessionExpiry();
}

export function hasSessionAddressKey(address: string): boolean {
    if (isSessionExpired()) {
        clearSession();
        return false;
    }
    return sessionAddressKeys.has(normalizeSessionAddressKey(address));
}

export function getSessionAddressKey(address: string): string | null {
    if (isSessionExpired()) {
        clearSession();
        return null;
    }
    void refreshSessionExpiry();
    return sessionAddressKeys.get(normalizeSessionAddressKey(address)) || null;
}

export function removeSessionAddressKey(address: string): void {
    sessionAddressKeys.delete(normalizeSessionAddressKey(address));
    void refreshSessionExpiry();
}

function isSessionExpired(): boolean {
    if (!sessionExpiresAt) return false;
    return Date.now() > sessionExpiresAt;
}

async function refreshSessionExpiry(): Promise<void> {
    if (!sessionAccountId || !sessionPrivateKey) return;
    try {
        const settings = await getSettings();
        sessionAutoLockMs = Math.max(1, settings.autoLockMinutes || DEFAULT_SETTINGS.autoLockMinutes) * 60 * 1000;
    } catch {
        sessionAutoLockMs = DEFAULT_SETTINGS.autoLockMinutes * 60 * 1000;
    }
    sessionExpiresAt = Date.now() + sessionAutoLockMs;
    const record: SessionRecord = {
        accountId: sessionAccountId,
        privKey: sessionPrivateKey,
        expiresAt: sessionExpiresAt,
        addressKeys: Object.fromEntries(sessionAddressKeys),
    };
    await setStorageData(STORAGE_KEYS.SESSION, record);
}

export async function hydrateSession(): Promise<void> {
    const record = await getStorageData<SessionRecord>(STORAGE_KEYS.SESSION);
    if (!record || !record.accountId || !record.privKey) return;
    if (!record.expiresAt || Date.now() > record.expiresAt) {
        await removeStorageData(STORAGE_KEYS.SESSION);
        return;
    }

    sessionAccountId = record.accountId;
    sessionPrivateKey = record.privKey;
    sessionExpiresAt = record.expiresAt;
    sessionAddressKeys.clear();
    if (record.addressKeys) {
        for (const [addr, key] of Object.entries(record.addressKeys)) {
            if (key) sessionAddressKeys.set(normalizeSessionAddressKey(addr), key);
        }
    }

    try {
        const settings = await getSettings();
        sessionAutoLockMs = Math.max(1, settings.autoLockMinutes || DEFAULT_SETTINGS.autoLockMinutes) * 60 * 1000;
    } catch {
        sessionAutoLockMs = DEFAULT_SETTINGS.autoLockMinutes * 60 * 1000;
    }
}

// ========================================
// Wallet Address Helpers
// ========================================

export function getWalletAddresses(account: UserAccount): AddressInfo[] {
    const list = Object.values(account.addresses || {});
    return list.filter((item) => item.address !== account.mainAddress);
}

export function getDefaultWalletAddress(account: UserAccount): AddressInfo | null {
    const list = getWalletAddresses(account);
    if (!list.length) return null;

    const preferred = account.defaultAddress ? account.addresses[account.defaultAddress] : null;
    if (preferred && preferred.address !== account.mainAddress) {
        return preferred;
    }

    return list[0];
}

export async function setDefaultWalletAddress(accountId: string, address: string): Promise<void> {
    const account = await getAccount(accountId);
    if (!account) return;
    if (!account.addresses[address]) return;
    if (address === account.mainAddress) return;
    account.defaultAddress = address;
    await saveAccount(account);
}
