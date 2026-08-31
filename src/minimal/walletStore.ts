import {
    clearSession,
    getActiveAccount,
    getAccount,
    hasActiveSession,
    saveAccount,
    saveOrganization,
    setActiveAccount,
    setSessionSecretsInMemory,
    type OrganizationChoice,
    type UserAccount,
} from '../core/storage';
import {
    decryptSecrets,
    encryptSecrets,
    validateWalletBundle,
    type EncryptedSecrets,
    type WalletBundleV1,
    type WalletSecrets,
} from './vault';

export const WALLET_RECORD_KEY = 'pangu_v2_wallet';
const CORE_SESSION_KEY = 'pangu_v2_session';

export interface MinimalWalletRecord {
    version: 1;
    account: UserAccount;
    organization: OrganizationChoice;
    encryptedSecrets: EncryptedSecrets;
}

export async function protectSessionStorage(): Promise<void> {
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}

export async function getWalletRecord(): Promise<MinimalWalletRecord | null> {
    const stored = await chrome.storage.local.get(WALLET_RECORD_KEY);
    return (stored[WALLET_RECORD_KEY] as MinimalWalletRecord | undefined) || null;
}

export async function hasWallet(): Promise<boolean> {
    return (await getWalletRecord()) !== null;
}

export async function importWalletBundle(value: unknown, password: string): Promise<UserAccount> {
    const bundle = validateWalletBundle(value);
    const account: UserAccount = {
        ...bundle.account,
        organizationId: bundle.organization.groupId,
        organizationName: bundle.organization.groupName,
        onboardingComplete: true,
        onboardingStep: 'complete',
        createdAt: bundle.account.createdAt || Date.now(),
        lastLogin: Date.now(),
    };
    const encryptedSecrets = await encryptSecrets(bundle.secrets, password);
    const record: MinimalWalletRecord = {
        version: 1,
        account,
        organization: bundle.organization,
        encryptedSecrets,
    };

    setSessionSecretsInMemory(account.accountId, bundle.secrets.accountPrivateKey, bundle.secrets.addressPrivateKeys);
    try {
        await saveAccount(account);
        await setActiveAccount(account.accountId);
        await saveOrganization(account.accountId, bundle.organization);
        await chrome.storage.local.set({ [WALLET_RECORD_KEY]: record });
    } finally {
        clearSession();
    }
    return account;
}

async function writeSession(accountId: string, secrets: WalletSecrets): Promise<void> {
    const expiresAt = setSessionSecretsInMemory(accountId, secrets.accountPrivateKey, secrets.addressPrivateKeys);
    await chrome.storage.session.set({
        [CORE_SESSION_KEY]: {
            accountId,
            privKey: secrets.accountPrivateKey,
            addressKeys: secrets.addressPrivateKeys,
            expiresAt,
        },
    });
}

export async function unlockWallet(password: string): Promise<UserAccount> {
    const record = await getWalletRecord();
    if (!record) throw new Error('Wallet has not been imported');
    const secrets = await decryptSecrets(record.encryptedSecrets, password);
    await setActiveAccount(record.account.accountId);
    await writeSession(record.account.accountId, secrets);
    return (await getAccount(record.account.accountId)) || record.account;
}

export async function isWalletUnlocked(): Promise<boolean> {
    const account = await getActiveAccount();
    return !!account && await hasActiveSession(account.accountId);
}

export async function lockWallet(): Promise<void> {
    clearSession();
    await chrome.storage.session.remove(CORE_SESSION_KEY);
}

export async function getWalletAccount(): Promise<UserAccount | null> {
    return (await getActiveAccount()) || (await getWalletRecord())?.account || null;
}

export async function resetMinimalWallet(): Promise<void> {
    clearSession();
    const local = await chrome.storage.local.get(null);
    const session = await chrome.storage.session.get(null);
    const localKeys = Object.keys(local).filter((key) => key.startsWith('pangu_v2_'));
    const sessionKeys = Object.keys(session).filter((key) => key.startsWith('pangu_v2_'));
    if (localKeys.length) await chrome.storage.local.remove(localKeys);
    if (sessionKeys.length) await chrome.storage.session.remove(sessionKeys);
}

export type { WalletBundleV1 };
