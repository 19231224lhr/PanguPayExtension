import type { OrganizationChoice, UserAccount } from '../core/storage';

export const PBKDF2_ITERATIONS = 600_000;
export const SESSION_TTL_MS = 15 * 60 * 1000;

export interface WalletSecrets {
    accountPrivateKey: string;
    addressPrivateKeys: Record<string, string>;
}

export interface WalletBundleV1 {
    version: 1;
    account: UserAccount;
    organization: OrganizationChoice;
    secrets: WalletSecrets;
}

export interface EncryptedSecrets {
    algorithm: 'AES-GCM';
    kdf: 'PBKDF2-SHA256';
    iterations: number;
    salt: string;
    iv: string;
    ciphertext: string;
}

interface SessionLike {
    expiresAt: number;
}

const PRIVATE_KEY_PATTERN = /^[a-fA-F0-9]{64}$/;
const ADDRESS_PATTERN = /^(?:0x)?[a-fA-F0-9]{40}$/;

function requireObject(value: unknown, message: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
    return value as Record<string, unknown>;
}

function requirePrivateKey(value: unknown, label: string): string {
    const key = String(value || '').trim();
    if (!PRIVATE_KEY_PATTERN.test(key)) throw new Error(`${label} must be a 64-character hexadecimal key`);
    return key.toLowerCase();
}

function requireEndpoint(value: unknown, label: string): string {
    const endpoint = String(value || '').trim();
    try {
        const parsed = new URL(endpoint);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol');
        return endpoint;
    } catch {
        throw new Error(`${label} must be a valid HTTP endpoint`);
    }
}

function stripAccountSecrets(account: UserAccount): UserAccount {
    const safeAccount = { ...account } as UserAccount & Record<string, unknown>;
    for (const field of ['privKey', 'privateKey', 'accountPrivateKey', 'addressPrivateKeys', 'mnemonic', 'password']) {
        delete safeAccount[field];
    }
    safeAccount.addresses = Object.fromEntries(
        Object.entries(account.addresses || {}).map(([address, info]) => {
            const safeInfo = { ...info };
            delete safeInfo.privHex;
            delete safeInfo.addressRootSeedHex;
            return [address, safeInfo];
        })
    ) as UserAccount['addresses'];
    return safeAccount;
}

export function validateWalletBundle(value: unknown): WalletBundleV1 {
    const root = requireObject(value, 'Wallet bundle must be an object');
    if (root.version !== 1) throw new Error('Wallet bundle version must be 1');

    const account = requireObject(root.account, 'Wallet account is required') as unknown as UserAccount;
    const accountId = String(account.accountId || '').trim();
    const mainAddress = String(account.mainAddress || '').trim();
    const defaultAddress = String(account.defaultAddress || '').trim();
    if (!accountId) throw new Error('Wallet account ID is required');
    if (!ADDRESS_PATTERN.test(mainAddress) || !account.addresses?.[mainAddress]) throw new Error('Wallet main address is invalid');
    if (!ADDRESS_PATTERN.test(defaultAddress) || !account.addresses?.[defaultAddress]) {
        throw new Error('Wallet default address is invalid');
    }

    const organization = requireObject(root.organization, 'Wallet organization is required') as unknown as OrganizationChoice;
    if (!String(organization.groupId || '').trim()) throw new Error('Wallet organization group ID is required');
    requireEndpoint(organization.assignAPIEndpoint || organization.assignNodeUrl, 'Wallet organization Assign endpoint');
    requireEndpoint(organization.aggrAPIEndpoint || organization.aggrNodeUrl, 'Wallet organization Aggregation endpoint');

    const rawSecrets = requireObject(root.secrets, 'Wallet secrets are required');
    const rawAddressKeys = requireObject(rawSecrets.addressPrivateKeys, 'Wallet address private keys are required');
    const addressPrivateKeys = Object.fromEntries(
        Object.entries(rawAddressKeys).map(([address, key]) => [address, requirePrivateKey(key, `Address ${address} private key`)])
    );
    if (!addressPrivateKeys[mainAddress]) throw new Error('Wallet main address private key is required');
    if (!addressPrivateKeys[defaultAddress]) throw new Error('Wallet default address private key is required');

    return {
        version: 1,
        account: { ...stripAccountSecrets(account), accountId, mainAddress, defaultAddress },
        organization,
        secrets: {
            accountPrivateKey: requirePrivateKey(rawSecrets.accountPrivateKey, 'Account private key'),
            addressPrivateKeys,
        },
    };
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
    const binary = atob(value);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
    if (password.length < 8) throw new Error('Wallet password must contain at least 8 characters');
    const material = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptSecrets(secrets: WalletSecrets, password: string): Promise<EncryptedSecrets> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
    const plaintext = new TextEncoder().encode(JSON.stringify(secrets));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return {
        algorithm: 'AES-GCM',
        kdf: 'PBKDF2-SHA256',
        iterations: PBKDF2_ITERATIONS,
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    };
}

export async function decryptSecrets(encrypted: EncryptedSecrets, password: string): Promise<WalletSecrets> {
    try {
        if (encrypted.algorithm !== 'AES-GCM' || encrypted.kdf !== 'PBKDF2-SHA256') throw new Error('Unsupported wallet');
        if (encrypted.iterations !== PBKDF2_ITERATIONS) throw new Error('Unsupported wallet KDF');
        const salt = base64ToBytes(encrypted.salt);
        const iv = base64ToBytes(encrypted.iv);
        const key = await deriveKey(password, salt, encrypted.iterations);
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            base64ToBytes(encrypted.ciphertext)
        );
        const parsed = requireObject(JSON.parse(new TextDecoder().decode(plaintext)), 'Wallet secrets are invalid');
        const rawAddressKeys = requireObject(parsed.addressPrivateKeys, 'Wallet address private keys are invalid');
        const addressPrivateKeys = Object.fromEntries(
            Object.entries(rawAddressKeys).map(([address, privateKey]) => [
                address,
                requirePrivateKey(privateKey, `Address ${address} private key`),
            ])
        );
        if (Object.keys(addressPrivateKeys).length === 0) throw new Error('Wallet address private keys are empty');
        return {
            accountPrivateKey: requirePrivateKey(parsed.accountPrivateKey, 'Account private key'),
            addressPrivateKeys,
        };
    } catch {
        throw new Error('Unable to unlock wallet');
    }
}

export function isSessionExpired(session: SessionLike, now = Date.now()): boolean {
    return now >= session.expiresAt;
}
