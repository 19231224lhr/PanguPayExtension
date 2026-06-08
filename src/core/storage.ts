/**
 * Chrome Storage 适配层
 *
 * 将 localStorage 操作替换为 chrome.storage.local
 */

import type { PublicKeyEnvelope, TxCertificate, TXCerIssuanceMetadata, TXCerStatusView, UTXOData } from './blockchain';
import { decryptJsonPayload, encryptJsonPayload, type EncryptedKeyData } from './keyEncryption';
import {
    AlgorithmECDSAP256,
    convertPublicKeyToHex,
    decodeBackendBytes,
    getPublicKeyHexFromPrivate,
    publicKeyEnvelopeFromHex,
    type PublicKeyNew,
} from './signature';
import { deriveAddressKeypairFromAddressRootSeed } from './addressRootSeed';
import {
    DefaultSeedChainLength,
    buildInitialSeedMetaFromPrivateKey,
    recoverDeterministicSeedChainStateFromPrivateKey,
} from './seedChain';

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
    gas?: number;
    EstInterest?: number;
    publicKeyNew?: PublicKeyNew | null;
    locked?: boolean;
    addressRootSeedHex?: string;
    signPublicKeyV2?: PublicKeyEnvelope | null;
    seedAnchor?: number[] | string;
    seedChainStep?: number;
    defaultSpendAlgorithm?: string;
    registrationState?: AddressRegistrationState;
    registrationError?: string;
    seedLocalState?: AddressSeedLocalState | null;
    readOnly?: boolean;
    seedRepairRequired?: boolean;
    pendingSeedStep?: number;
    pendingNextSeedStep?: number;
    pendingSeedTxId?: string;
    pendingSeedAt?: number;
    lastProtocolSyncAt?: number;
}

export type AddressRegistrationState = 'unknown' | 'pending' | 'registered' | 'failed';

export interface AddressSeedLocalState {
    mode: 'deterministic_p256';
    chainLength: number;
    step: number;
    generation?: number;
    source: 'plain' | 'session' | 'missing';
    available: boolean;
    requiresUnlock?: boolean;
    lastRecoveredAt?: number;
}

export interface UserAccount {
    accountId: string;
    mainAddress: string;
    addresses: Record<string, AddressInfo>;
    defaultAddress?: string;
    txCerStore?: Record<string, TxCertificate>;
    txCerStatuses?: Record<string, TXCerStatusView>;
    txCerIssuanceRecords?: Record<string, TXCerIssuanceMetadata>;
    organizationId?: string;
    organizationName?: string;
    onboardingComplete?: boolean;
    onboardingStep?: OnboardingStep;
    mainAddressRegistered?: boolean;
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

export interface EncryptedAddressKeys extends EncryptedKeyData { }

export interface TransactionRecord {
    id: string;
    type: 'send' | 'receive';
    status: 'pending' | 'success' | 'failed';
    transferMode?: 'normal' | 'quick' | 'cross' | 'incoming' | 'unknown';
    amount: number;
    coinType: number;
    currency?: string;
    from: string;
    to: string;
    timestamp: number;
    txHash?: string;
    gas?: number;
    guarantorOrg?: string;
    blockNumber?: number;
    confirmations?: number;
    failureReason?: string;
}

// ========================================
// Storage Keys
// ========================================

const STORAGE_KEYS = {
    ACCOUNTS: 'pangu_accounts',
    ACTIVE_ACCOUNT: 'pangu_active_account',
    ENCRYPTED_KEYS: 'pangu_encrypted_keys',
    ENCRYPTED_ADDRESS_KEYS: 'pangu_encrypted_address_keys',
    SETTINGS: 'pangu_settings',
    TX_HISTORY: 'pangu_tx_history',
    ORGANIZATION: 'pangu_organization',
    DAPP_CONNECTIONS: 'pangu_dapp_connections',
    DAPP_PENDING: 'pangu_dapp_pending',
    DAPP_SIGN_PENDING: 'pangu_dapp_sign_pending',
    DAPP_TX_PENDING: 'pangu_dapp_tx_pending',
    DAPP_TX_WATCHES: 'pangu_dapp_tx_watches',
    SESSION: 'pangu_session',
};

function normalizeHexString(value: unknown): string {
    return String(value || '').trim().replace(/^0x/i, '').toLowerCase();
}

function decodeOptionalBytes(value: unknown): number[] {
    try {
        return decodeBackendBytes(value);
    } catch {
        return [];
    }
}

function normalizeAddressValue(value: unknown, fallbackBalance = 0): { totalValue: number; utxoValue: number; txCerValue: number } {
    const raw = (value && typeof value === 'object') ? value as Record<string, unknown> : {};
    const totalValue = Number(raw.totalValue ?? raw.TotalValue ?? fallbackBalance) || 0;
    const utxoValue = Number(raw.utxoValue ?? raw.UTXOValue ?? fallbackBalance) || 0;
    const txCerValue = Number(raw.txCerValue ?? raw.TXCerValue ?? 0) || 0;
    return { totalValue, utxoValue, txCerValue };
}

function isRegistrationState(value: unknown): value is AddressRegistrationState {
    return value === 'unknown' || value === 'pending' || value === 'registered' || value === 'failed';
}

function isEmptyPublicKeyEnvelope(value: PublicKeyEnvelope | null | undefined): boolean {
    if (!value) return true;
    if (!String(value.Algorithm || '').trim()) return true;
    return decodeOptionalBytes(value.PublicKey).length === 0;
}

export function publicKeyEnvelopeEquals(
    left: PublicKeyEnvelope | null | undefined,
    right: PublicKeyEnvelope | null | undefined
): boolean {
    if (isEmptyPublicKeyEnvelope(left) || isEmptyPublicKeyEnvelope(right)) return false;
    return (
        String(left?.Algorithm || '') === String(right?.Algorithm || '') &&
        decodeOptionalBytes(left?.PublicKey).join(',') === decodeOptionalBytes(right?.PublicKey).join(',')
    );
}

function normalizeStoredPublicKey(
    value: unknown,
    fallbackPubXHex?: string,
    fallbackPubYHex?: string
): PublicKeyNew | null {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null;
    const pubXHex = normalizeHexString(raw?.XHex ?? fallbackPubXHex);
    const pubYHex = normalizeHexString(raw?.YHex ?? fallbackPubYHex);
    const x = raw?.X != null ? String(raw.X) : undefined;
    const y = raw?.Y != null ? String(raw.Y) : undefined;

    if ((!x || !y) && pubXHex && pubYHex) {
        return {
            CurveName: String(raw?.CurveName || raw?.Curve || 'P256'),
            X: BigInt(`0x${pubXHex}`).toString(10),
            Y: BigInt(`0x${pubYHex}`).toString(10),
        };
    }

    if (!x || !y) return null;
    return {
        CurveName: String(raw?.CurveName || raw?.Curve || 'P256'),
        X: x,
        Y: y,
    };
}

function reconcileAddressRootSeedDerivedData(address: string, current: Record<string, unknown>): Record<string, unknown> {
    const normalizedAddress = normalizeHexString(address);
    const rootSeedHex = normalizeHexString(current.addressRootSeedHex);
    if (!rootSeedHex) return current;

    const preferredType = Number(current.type ?? current.Type ?? 0);
    const candidateTypes = [preferredType, 0, 1, 2].filter((item, index, arr) => arr.indexOf(item) === index);
    for (const candidateType of candidateTypes) {
        try {
            const derived = deriveAddressKeypairFromAddressRootSeed(rootSeedHex, candidateType);
            if (normalizeHexString(derived.address) !== normalizedAddress) continue;
            return {
                ...current,
                type: candidateType,
                privHex: current.privHex || derived.privHex,
                pubXHex: current.pubXHex || derived.pubXHex,
                pubYHex: current.pubYHex || derived.pubYHex,
                addressRootSeedHex: derived.addressRootSeedHex,
            };
        } catch {
            // Try the next possible type.
        }
    }

    return current;
}

function getAddressPrivateRecoveryMaterial(
    account: UserAccount,
    address: string,
    addrData: Partial<AddressInfo>
): { privHex: string; source: 'plain' | 'session' | 'missing' } {
    const normalized = normalizeHexString(address);
    const mainAddress = normalizeHexString(account.mainAddress);
    const plain = normalizeHexString(addrData.privHex);
    if (plain) return { privHex: plain, source: 'plain' };

    const sessionAddressPriv = getSessionAddressKey(normalized);
    if (sessionAddressPriv) return { privHex: normalizeHexString(sessionAddressPriv), source: 'session' };

    const session = getSessionKey();
    if (session?.accountId === account.accountId && normalized && normalized === mainAddress) {
        return { privHex: normalizeHexString(session.privKey), source: 'session' };
    }

    return { privHex: '', source: 'missing' };
}

function recoverAddressProtocolState(
    account: UserAccount,
    address: string,
    addrData: Partial<AddressInfo>
): {
    seedAnchor?: number[];
    seedChainStep?: number;
    defaultSpendAlgorithm?: string;
    seedLocalState: AddressSeedLocalState;
    readOnly: boolean;
    seedRepairRequired: boolean;
} {
    const chainLength = Number(addrData.seedLocalState?.chainLength || DefaultSeedChainLength) || DefaultSeedChainLength;
    const providedAnchor = decodeOptionalBytes(addrData.seedAnchor);
    const rawStep = Number(addrData.seedChainStep ?? addrData.seedLocalState?.step ?? 0);
    const providedStep = Number.isFinite(rawStep) && rawStep >= 0 ? rawStep : 0;
    const material = getAddressPrivateRecoveryMaterial(account, address, addrData);
    const now = Date.now();

    if (material.privHex) {
        try {
            if (providedAnchor.length > 0 && providedStep >= 0 && providedStep <= chainLength) {
                const recovered = recoverDeterministicSeedChainStateFromPrivateKey(
                    material.privHex,
                    chainLength,
                    providedStep,
                    providedAnchor
                );
                return {
                    seedAnchor: providedAnchor,
                    seedChainStep: providedStep,
                    defaultSpendAlgorithm: String(addrData.defaultSpendAlgorithm || '').trim() || AlgorithmECDSAP256,
                    seedLocalState: {
                        mode: 'deterministic_p256',
                        chainLength,
                        step: providedStep,
                        generation: recovered.generation,
                        source: material.source,
                        available: true,
                        lastRecoveredAt: now,
                    },
                    readOnly: false,
                    seedRepairRequired: false,
                };
            }

            const initial = buildInitialSeedMetaFromPrivateKey(material.privHex);
            return {
                seedAnchor: providedAnchor.length > 0 ? providedAnchor : [...initial.seedAnchor],
                seedChainStep: providedStep > 0 ? providedStep : initial.seedChainStep,
                defaultSpendAlgorithm: String(addrData.defaultSpendAlgorithm || '').trim() || initial.defaultSpendAlgorithm,
                seedLocalState: {
                    mode: 'deterministic_p256',
                    chainLength,
                    step: providedStep > 0 ? providedStep : initial.seedChainStep,
                    generation: initial.state.generation,
                    source: material.source,
                    available: true,
                    lastRecoveredAt: now,
                },
                readOnly: false,
                seedRepairRequired: false,
            };
        } catch (error) {
            console.warn(`[Storage] Failed to recover seed state for ${address}:`, error);
        }
    }

    const hasRemoteSeedMeta = providedAnchor.length > 0 && providedStep > 0;
    return {
        seedAnchor: providedAnchor.length > 0 ? providedAnchor : undefined,
        seedChainStep: providedStep > 0 ? providedStep : undefined,
        defaultSpendAlgorithm: String(addrData.defaultSpendAlgorithm || '').trim() || (hasRemoteSeedMeta ? AlgorithmECDSAP256 : undefined),
        seedLocalState: {
            mode: 'deterministic_p256',
            chainLength,
            step: providedStep > 0 ? providedStep : chainLength,
            source: 'missing',
            available: false,
            requiresUnlock: true,
        },
        readOnly: hasRemoteSeedMeta,
        seedRepairRequired: hasRemoteSeedMeta,
    };
}

export function getAccountPublicKeyHex(account: Partial<UserAccount> | null | undefined): { x: string; y: string } | null {
    const session = getSessionKey();
    if (account?.accountId && session?.accountId === account.accountId && session.privKey) {
        try {
            return getPublicKeyHexFromPrivate(session.privKey);
        } catch {
            return null;
        }
    }
    return null;
}

export function getAccountSignPublicKeyV2(account: Partial<UserAccount> | null | undefined): PublicKeyEnvelope | null {
    const accountPub = getAccountPublicKeyHex(account);
    if (!accountPub) return null;
    return publicKeyEnvelopeFromHex(accountPub.x, accountPub.y);
}

export function hasAddressProtocolMetadata(addrData: Partial<AddressInfo> | null | undefined): boolean {
    if (!addrData) return false;
    return (
        !isEmptyPublicKeyEnvelope(addrData.signPublicKeyV2 || undefined) &&
        decodeOptionalBytes(addrData.seedAnchor).length > 0 &&
        Number(addrData.seedChainStep || 0) > 0 &&
        !!String(addrData.defaultSpendAlgorithm || '').trim()
    );
}

export function getAddressProtocolIssues(address: string, addrData: Partial<AddressInfo> | null | undefined): string[] {
    if (!addrData) return [`${address}: missing local address metadata`];
    const issues: string[] = [];
    if (!addrData.pubXHex || !addrData.pubYHex) issues.push(`${address}: missing address public key`);
    if (isEmptyPublicKeyEnvelope(addrData.signPublicKeyV2 || undefined)) issues.push(`${address}: missing SignPublicKeyV2`);
    if (decodeOptionalBytes(addrData.seedAnchor).length === 0) issues.push(`${address}: missing SeedAnchor`);
    if (Number(addrData.seedChainStep || 0) <= 0) issues.push(`${address}: invalid SeedChainStep`);
    if (!String(addrData.defaultSpendAlgorithm || '').trim()) issues.push(`${address}: missing DefaultSpendAlgorithm`);
    if (addrData.seedRepairRequired) issues.push(`${address}: local seed state missing`);
    if (addrData.readOnly) issues.push(`${address}: address is read-only`);
    if (addrData.pendingSeedStep || addrData.pendingNextSeedStep) issues.push(`${address}: pending seed step not confirmed`);
    return issues;
}

export function normalizeAddressDataForStorage(
    address: string,
    addrData: Partial<AddressInfo> | null | undefined,
    account: UserAccount,
    options: { syncTime?: number } = {}
): AddressInfo {
    const current = reconcileAddressRootSeedDerivedData(address, (addrData || {}) as Record<string, unknown>);
    const normalizedAddress = normalizeHexString((current.address as string) || address);
    let pubXHex = normalizeHexString(current.pubXHex);
    let pubYHex = normalizeHexString(current.pubYHex);
    const publicKeyNew = normalizeStoredPublicKey(current.publicKeyNew ?? current.PublicKeyNew, pubXHex, pubYHex);

    if ((!pubXHex || !pubYHex) && publicKeyNew?.X != null && publicKeyNew?.Y != null) {
        try {
            const converted = convertPublicKeyToHex(publicKeyNew);
            pubXHex = pubXHex || converted.x;
            pubYHex = pubYHex || converted.y;
        } catch {
            // Leave malformed legacy public keys unset.
        }
    }

    const protocolState = recoverAddressProtocolState(account, normalizedAddress, current as Partial<AddressInfo>);
    const accountSignPublicKeyV2 = getAccountSignPublicKeyV2(account);
    const existingSignPublicKeyV2 = current.signPublicKeyV2 as PublicKeyEnvelope | undefined;
    const signPublicKeyV2 = accountSignPublicKeyV2 || (
        !isEmptyPublicKeyEnvelope(existingSignPublicKeyV2)
            ? existingSignPublicKeyV2
            : undefined
    );

    let registrationState: AddressRegistrationState = 'unknown';
    if (isRegistrationState(current.registrationState)) {
        registrationState = current.registrationState;
    } else if (current.registrationError) {
        registrationState = 'failed';
    }

    const balance = Number(current.balance ?? (current.Value as any)?.UTXOValue ?? 0) || 0;
    const value = normalizeAddressValue(current.value ?? current.Value, balance);
    return {
        address: normalizedAddress,
        type: Number(current.type ?? current.Type ?? 0) || 0,
        balance,
        utxoCount: Number(current.utxoCount ?? Object.keys((current.utxos ?? current.UTXO ?? {}) as Record<string, unknown>).length) || 0,
        txCerCount: Number(current.txCerCount ?? Object.keys((current.txCers ?? current.TXCers ?? {}) as Record<string, unknown>).length) || 0,
        source: (current.source as AddressInfo['source']) || undefined,
        privHex: normalizeHexString(current.privHex) || undefined,
        pubXHex: pubXHex || undefined,
        pubYHex: pubYHex || undefined,
        utxos: ((current.utxos ?? current.UTXO) as Record<string, UTXOData>) || {},
        txCers: ((current.txCers ?? current.TXCers) as Record<string, number>) || {},
        value,
        estInterest: Number(current.estInterest ?? current.EstInterest ?? current.Interest ?? current.gas ?? 0) || 0,
        gas: Number(current.gas ?? current.estInterest ?? current.EstInterest ?? current.Interest ?? 0) || 0,
        EstInterest: Number(current.EstInterest ?? current.estInterest ?? current.Interest ?? current.gas ?? 0) || 0,
        publicKeyNew: publicKeyNew || undefined,
        locked: Boolean(current.locked) || Boolean(protocolState.readOnly),
        addressRootSeedHex: normalizeHexString(current.addressRootSeedHex) || undefined,
        signPublicKeyV2: signPublicKeyV2 || undefined,
        seedAnchor: protocolState.seedAnchor && protocolState.seedAnchor.length > 0 ? protocolState.seedAnchor : undefined,
        seedChainStep: protocolState.seedChainStep,
        defaultSpendAlgorithm: protocolState.defaultSpendAlgorithm,
        registrationState,
        registrationError: registrationState === 'registered' ? undefined : (current.registrationError ? String(current.registrationError) : undefined),
        seedLocalState: protocolState.seedLocalState,
        readOnly: Boolean(current.readOnly) || protocolState.readOnly,
        seedRepairRequired: Boolean(current.seedRepairRequired) || protocolState.seedRepairRequired,
        pendingSeedStep: Number(current.pendingSeedStep || 0) || undefined,
        pendingNextSeedStep: Number(current.pendingNextSeedStep || 0) || undefined,
        pendingSeedTxId: current.pendingSeedTxId ? String(current.pendingSeedTxId) : undefined,
        pendingSeedAt: Number(current.pendingSeedAt || 0) || undefined,
        lastProtocolSyncAt: Number(current.lastProtocolSyncAt || options.syncTime || 0) || undefined,
    };
}

export function normalizeAccountForStorage(account: UserAccount): UserAccount {
    const normalized: UserAccount = {
        ...account,
        mainAddress: normalizeHexString(account.mainAddress),
        addresses: {},
        txCerStore: { ...(account.txCerStore || {}) },
        txCerStatuses: { ...(account.txCerStatuses || {}) },
        txCerIssuanceRecords: { ...(account.txCerIssuanceRecords || {}) },
        totalBalance: { 0: 0, 1: 0, 2: 0, ...(account.totalBalance || {}) },
    };
    for (const [rawAddress, info] of Object.entries(account.addresses || {})) {
        const address = normalizeHexString(info?.address || rawAddress);
        if (!address) continue;
        normalized.addresses[address] = normalizeAddressDataForStorage(address, info, normalized);
        if (
            normalized.addresses[address].pendingNextSeedStep &&
            normalized.addresses[address].seedChainStep &&
            Number(normalized.addresses[address].seedChainStep) === Number(normalized.addresses[address].pendingNextSeedStep)
        ) {
            normalized.addresses[address].pendingSeedStep = undefined;
            normalized.addresses[address].pendingNextSeedStep = undefined;
            normalized.addresses[address].pendingSeedTxId = undefined;
            normalized.addresses[address].pendingSeedAt = undefined;
        }
    }
    return normalized;
}

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
    accounts[account.accountId] = normalizeAccountForStorage(account);
    await setStorageData(STORAGE_KEYS.ACCOUNTS, accounts);
}

export async function getAccount(accountId: string): Promise<UserAccount | null> {
    const accounts = await getStorageData<Record<string, UserAccount>>(STORAGE_KEYS.ACCOUNTS);
    const account = accounts?.[accountId] || null;
    if (!account) return null;
    const normalized = normalizeAccountForStorage(account);
    if (JSON.stringify(normalized) !== JSON.stringify(account)) {
        const nextAccounts = { ...(accounts || {}), [accountId]: normalized };
        await setStorageData(STORAGE_KEYS.ACCOUNTS, nextAccounts);
    }
    return normalized;
}

export async function getAllAccounts(): Promise<UserAccount[]> {
    const accounts = await getStorageData<Record<string, UserAccount>>(STORAGE_KEYS.ACCOUNTS);
    if (!accounts) return [];
    const normalizedAccounts: Record<string, UserAccount> = {};
    let changed = false;
    for (const [accountId, account] of Object.entries(accounts)) {
        const normalized = normalizeAccountForStorage(account);
        normalizedAccounts[accountId] = normalized;
        if (JSON.stringify(normalized) !== JSON.stringify(account)) changed = true;
    }
    if (changed) {
        await setStorageData(STORAGE_KEYS.ACCOUNTS, normalizedAccounts);
    }
    return Object.values(normalizedAccounts);
}

export async function clearStaleTxCerData(accountId?: string): Promise<void> {
    const accounts = await getStorageData<Record<string, UserAccount>>(STORAGE_KEYS.ACCOUNTS) || {};
    const targets = accountId ? [accountId] : Object.keys(accounts);
    let changed = false;

    for (const id of targets) {
        const account = accounts[id];
        if (!account) continue;
        let accountChanged = false;

        if (account.txCerStore && Object.keys(account.txCerStore).length > 0) {
            account.txCerStore = {};
            accountChanged = true;
        }
        if (account.txCerStatuses && Object.keys(account.txCerStatuses).length > 0) {
            account.txCerStatuses = {};
            accountChanged = true;
        }
        for (const info of Object.values(account.addresses || {})) {
            if (!info) continue;
            if (info.txCers && Object.keys(info.txCers).length > 0) {
                info.txCers = {};
                info.txCerCount = 0;
                accountChanged = true;
            }
            if (info.value) {
                if (info.value.txCerValue !== 0) {
                    info.value.txCerValue = 0;
                    accountChanged = true;
                }
                const baseUtxo = Number(info.value.utxoValue ?? info.balance ?? 0) || 0;
                if (info.value.totalValue !== baseUtxo) {
                    info.value.totalValue = baseUtxo;
                    accountChanged = true;
                }
            } else {
                info.value = {
                    totalValue: info.balance || 0,
                    utxoValue: info.balance || 0,
                    txCerValue: 0,
                };
                accountChanged = true;
            }
        }

        if (accountChanged) {
            const totals: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
            const mainAddress = account.mainAddress?.toLowerCase() || '';
            for (const [addr, info] of Object.entries(account.addresses || {})) {
                if (mainAddress && addr.toLowerCase() === mainAddress) continue;
                totals[info.type || 0] = (totals[info.type || 0] || 0) + (info.balance || 0);
            }
            account.totalBalance = totals;
            accounts[id] = account;
            changed = true;
        }
    }

    if (changed) {
        await setStorageData(STORAGE_KEYS.ACCOUNTS, accounts);
    }
}

export async function deleteAccount(accountId: string): Promise<void> {
    const accounts = await getStorageData<Record<string, UserAccount>>(STORAGE_KEYS.ACCOUNTS) || {};
    delete accounts[accountId];
    await setStorageData(STORAGE_KEYS.ACCOUNTS, accounts);

    // 删除加密密钥
    const keys = await getStorageData<Record<string, EncryptedAccount>>(STORAGE_KEYS.ENCRYPTED_KEYS) || {};
    delete keys[accountId];
    await setStorageData(STORAGE_KEYS.ENCRYPTED_KEYS, keys);

    const addressKeys =
        await getStorageData<Record<string, EncryptedAddressKeys>>(STORAGE_KEYS.ENCRYPTED_ADDRESS_KEYS) || {};
    delete addressKeys[accountId];
    await setStorageData(STORAGE_KEYS.ENCRYPTED_ADDRESS_KEYS, addressKeys);

    const dappConnections =
        await getStorageData<Record<string, Record<string, DappConnection>>>(STORAGE_KEYS.DAPP_CONNECTIONS) || {};
    if (dappConnections[accountId]) {
        delete dappConnections[accountId];
        await setStorageData(STORAGE_KEYS.DAPP_CONNECTIONS, dappConnections);
    }

    const dappPending =
        await getStorageData<Record<string, DappPendingConnection>>(STORAGE_KEYS.DAPP_PENDING) || {};
    if (dappPending[accountId]) {
        delete dappPending[accountId];
        await setStorageData(STORAGE_KEYS.DAPP_PENDING, dappPending);
    }

    const dappSignPending =
        await getStorageData<Record<string, DappSignPendingConnection>>(STORAGE_KEYS.DAPP_SIGN_PENDING) || {};
    if (dappSignPending[accountId]) {
        delete dappSignPending[accountId];
        await setStorageData(STORAGE_KEYS.DAPP_SIGN_PENDING, dappSignPending);
    }

    const dappTxPending =
        await getStorageData<Record<string, DappPendingTransaction>>(STORAGE_KEYS.DAPP_TX_PENDING) || {};
    if (dappTxPending[accountId]) {
        delete dappTxPending[accountId];
        await setStorageData(STORAGE_KEYS.DAPP_TX_PENDING, dappTxPending);
    }

    const dappTxWatches =
        await getStorageData<Record<string, Record<string, DappTxWatch>>>(STORAGE_KEYS.DAPP_TX_WATCHES) || {};
    if (dappTxWatches[accountId]) {
        delete dappTxWatches[accountId];
        await setStorageData(STORAGE_KEYS.DAPP_TX_WATCHES, dappTxWatches);
    }
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
// Encrypted Address Keys
// ========================================

export async function getEncryptedAddressKeys(accountId: string): Promise<EncryptedAddressKeys | null> {
    const keys =
        await getStorageData<Record<string, EncryptedAddressKeys>>(STORAGE_KEYS.ENCRYPTED_ADDRESS_KEYS);
    return keys?.[accountId] || null;
}

export async function saveEncryptedAddressKeys(
    accountId: string,
    data: EncryptedAddressKeys | null
): Promise<void> {
    const keys =
        await getStorageData<Record<string, EncryptedAddressKeys>>(STORAGE_KEYS.ENCRYPTED_ADDRESS_KEYS) || {};
    if (data) {
        keys[accountId] = data;
    } else if (keys[accountId]) {
        delete keys[accountId];
    }
    await setStorageData(STORAGE_KEYS.ENCRYPTED_ADDRESS_KEYS, keys);
}

async function readAddressKeyStore(
    accountId: string,
    accountPrivKey: string
): Promise<Record<string, string>> {
    const encrypted = await getEncryptedAddressKeys(accountId);
    if (!encrypted) return {};
    try {
        const data = await decryptJsonPayload<Record<string, string>>(
            encrypted.encrypted,
            encrypted.salt,
            encrypted.iv,
            accountPrivKey
        );
        return data && typeof data === 'object' ? data : {};
    } catch (error) {
        console.warn('[Storage] 解密地址私钥失败:', error);
        return {};
    }
}

async function writeAddressKeyStore(
    accountId: string,
    accountPrivKey: string,
    payload: Record<string, string>
): Promise<void> {
    const encrypted = await encryptJsonPayload(payload, accountPrivKey);
    await saveEncryptedAddressKeys(accountId, encrypted);
}

export async function persistAddressKey(
    accountId: string,
    address: string,
    privKey: string,
    accountPrivKey: string
): Promise<void> {
    if (!accountId || !address || !privKey || !accountPrivKey) return;
    const normalized = address.toLowerCase();
    const store = await readAddressKeyStore(accountId, accountPrivKey);
    store[normalized] = privKey;
    await writeAddressKeyStore(accountId, accountPrivKey, store);
}

export async function removePersistedAddressKey(
    accountId: string,
    address: string,
    accountPrivKey: string
): Promise<void> {
    if (!accountId || !address || !accountPrivKey) return;
    const normalized = address.toLowerCase();
    const store = await readAddressKeyStore(accountId, accountPrivKey);
    if (store[normalized]) {
        delete store[normalized];
        await writeAddressKeyStore(accountId, accountPrivKey, store);
    }
}

export async function hydrateSessionAddressKeys(
    accountId: string,
    accountPrivKey: string
): Promise<void> {
    if (!accountId || !accountPrivKey) return;
    const store = await readAddressKeyStore(accountId, accountPrivKey);
    for (const [addr, key] of Object.entries(store)) {
        if (key) {
            sessionAddressKeys.set(normalizeSessionAddressKey(addr), key);
        }
    }
    void refreshSessionExpiry();
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
    // 只保留最近 200 条
    if (history[accountId].length > 200) {
        history[accountId] = history[accountId].slice(0, 200);
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
    options: { blockNumber?: number; failureReason?: string; confirmations?: number } = {}
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
            if (options.failureReason !== undefined && item.failureReason !== options.failureReason) {
                item.failureReason = options.failureReason;
                changed = true;
            }
            if (options.confirmations !== undefined && item.confirmations !== options.confirmations) {
                item.confirmations = options.confirmations;
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
    assignAPIEndpoint?: string;
    aggrAPIEndpoint?: string;
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
// DApp Connections
// ========================================

export interface DappConnection {
    accountId: string;
    origin: string;
    address: string;
    connectedAt: number;
    title?: string;
    icon?: string;
}

export interface DappPendingConnection {
    requestId: string;
    accountId: string;
    origin: string;
    createdAt: number;
    title?: string;
    icon?: string;
}

export interface DappSignPendingConnection {
    requestId: string;
    accountId: string;
    origin: string;
    createdAt: number;
    title?: string;
    icon?: string;
    message: string;
}

export interface DappTransactionRecipient {
    to: string;
    amount: number;
    coinType?: number;
    publicKey?: string;
    orgId?: string;
    transferGas?: number;
    seedAnchor?: number[] | string;
    seedChainStep?: number;
    defaultSpendAlgorithm?: string;
}

export interface DappTransactionRequest {
    to?: string;
    amount?: number;
    coinType?: number;
    mode?: 'normal' | 'quick' | 'cross';
    gas?: number;
    extraGas?: number;
    publicKey?: string;
    orgId?: string;
    transferGas?: number;
    seedAnchor?: number[] | string;
    seedChainStep?: number;
    defaultSpendAlgorithm?: string;
    recipients?: DappTransactionRecipient[];
}

export interface DappPendingTransaction {
    requestId: string;
    accountId: string;
    origin: string;
    createdAt: number;
    title?: string;
    icon?: string;
    request: DappTransactionRequest;
}

export interface DappTxWatch {
    accountId: string;
    txId: string;
    origin: string;
    mode: string;
    createdAt: number;
    requestId?: string;
}

function normalizeOrigin(origin: string): string {
    return String(origin || '').trim().toLowerCase();
}

function isPendingRecord(value: unknown): value is { requestId: string } {
    return !!value && typeof value === 'object' && typeof (value as { requestId?: string }).requestId === 'string';
}

function normalizePendingStore<T extends { requestId: string }>(
    raw: Record<string, unknown> | null
): { store: Record<string, Record<string, T>>; migrated: boolean } {
    const store: Record<string, Record<string, T>> = {};
    let migrated = false;
    if (!raw || typeof raw !== 'object') return { store, migrated };
    for (const [accountId, entry] of Object.entries(raw)) {
        if (!entry) continue;
        if (isPendingRecord(entry)) {
            store[accountId] = { [entry.requestId]: entry as T };
            migrated = true;
            continue;
        }
        if (typeof entry === 'object') {
            store[accountId] = entry as Record<string, T>;
        }
    }
    return { store, migrated };
}

export async function getDappConnection(
    accountId: string,
    origin: string
): Promise<DappConnection | null> {
    if (!accountId || !origin) return null;
    const connections =
        await getStorageData<Record<string, Record<string, DappConnection>>>(STORAGE_KEYS.DAPP_CONNECTIONS);
    const normalized = normalizeOrigin(origin);
    return connections?.[accountId]?.[normalized] || null;
}

export async function getDappConnections(
    accountId: string
): Promise<Record<string, DappConnection>> {
    if (!accountId) return {};
    const connections =
        await getStorageData<Record<string, Record<string, DappConnection>>>(STORAGE_KEYS.DAPP_CONNECTIONS);
    return connections?.[accountId] || {};
}

export async function setDappConnection(
    accountId: string,
    origin: string,
    connection: Omit<DappConnection, 'accountId' | 'origin' | 'connectedAt'> & {
        connectedAt?: number;
    }
): Promise<void> {
    if (!accountId || !origin) return;
    const connections =
        await getStorageData<Record<string, Record<string, DappConnection>>>(STORAGE_KEYS.DAPP_CONNECTIONS) || {};
    const normalized = normalizeOrigin(origin);
    if (!connections[accountId]) connections[accountId] = {};
    connections[accountId][normalized] = {
        accountId,
        origin: normalized,
        address: connection.address,
        connectedAt: connection.connectedAt || Date.now(),
        title: connection.title,
        icon: connection.icon,
    };
    await setStorageData(STORAGE_KEYS.DAPP_CONNECTIONS, connections);
}

export async function removeDappConnection(accountId: string, origin: string): Promise<void> {
    if (!accountId || !origin) return;
    const connections =
        await getStorageData<Record<string, Record<string, DappConnection>>>(STORAGE_KEYS.DAPP_CONNECTIONS) || {};
    const normalized = normalizeOrigin(origin);
    if (!connections[accountId]) return;
    if (connections[accountId][normalized]) {
        delete connections[accountId][normalized];
        await setStorageData(STORAGE_KEYS.DAPP_CONNECTIONS, connections);
    }
}

export async function saveDappPendingConnection(pending: DappPendingConnection): Promise<void> {
    if (!pending?.accountId) return;
    const raw =
        await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_PENDING);
    const { store } = normalizePendingStore<DappPendingConnection>(raw);
    if (!store[pending.accountId]) store[pending.accountId] = {};
    store[pending.accountId][pending.requestId] = pending;
    await setStorageData(STORAGE_KEYS.DAPP_PENDING, store);
}

export async function getDappPendingConnection(accountId: string): Promise<DappPendingConnection | null> {
    if (!accountId) return null;
    const raw =
        await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_PENDING);
    const { store, migrated } = normalizePendingStore<DappPendingConnection>(raw);
    if (migrated) {
        await setStorageData(STORAGE_KEYS.DAPP_PENDING, store);
    }
    const accountPending = store[accountId] || {};
    const list = Object.values(accountPending).sort((a, b) => a.createdAt - b.createdAt);
    return list[0] || null;
}

export async function getDappPendingConnections(accountId: string): Promise<DappPendingConnection[]> {
    if (!accountId) return [];
    const raw =
        await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_PENDING);
    const { store, migrated } = normalizePendingStore<DappPendingConnection>(raw);
    if (migrated) {
        await setStorageData(STORAGE_KEYS.DAPP_PENDING, store);
    }
    const accountPending = store[accountId] || {};
    return Object.values(accountPending).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getDappPendingConnectionById(
    accountId: string,
    requestId: string
): Promise<DappPendingConnection | null> {
    if (!accountId || !requestId) return null;
    const raw =
        await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_PENDING);
    const { store, migrated } = normalizePendingStore<DappPendingConnection>(raw);
    if (migrated) {
        await setStorageData(STORAGE_KEYS.DAPP_PENDING, store);
    }
    return store?.[accountId]?.[requestId] || null;
}

export async function clearDappPendingConnection(accountId: string, requestId?: string): Promise<void> {
    if (!accountId) return;
    const raw =
        await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_PENDING);
    const { store } = normalizePendingStore<DappPendingConnection>(raw);
    const accountPending = store[accountId];
    if (!accountPending) return;
    if (!requestId) {
        delete store[accountId];
        await setStorageData(STORAGE_KEYS.DAPP_PENDING, store);
        return;
    }
    if (!accountPending[requestId]) return;
    delete accountPending[requestId];
    if (Object.keys(accountPending).length === 0) {
        delete store[accountId];
    }
    await setStorageData(STORAGE_KEYS.DAPP_PENDING, store);
}

export async function saveDappSignPendingConnection(pending: DappSignPendingConnection): Promise<void> {
    if (!pending?.accountId) return;
    const raw =
        await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_SIGN_PENDING);
    const { store } = normalizePendingStore<DappSignPendingConnection>(raw);
    if (!store[pending.accountId]) store[pending.accountId] = {};
    store[pending.accountId][pending.requestId] = pending;
    await setStorageData(STORAGE_KEYS.DAPP_SIGN_PENDING, store);
}

export async function getDappSignPendingConnection(accountId: string): Promise<DappSignPendingConnection | null> {
    if (!accountId) return null;
    const raw =
        await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_SIGN_PENDING);
    const { store, migrated } = normalizePendingStore<DappSignPendingConnection>(raw);
    if (migrated) {
        await setStorageData(STORAGE_KEYS.DAPP_SIGN_PENDING, store);
    }
    const accountPending = store[accountId] || {};
    const list = Object.values(accountPending).sort((a, b) => a.createdAt - b.createdAt);
    return list[0] || null;
}

export async function getDappSignPendingConnections(accountId: string): Promise<DappSignPendingConnection[]> {
    if (!accountId) return [];
    const raw =
        await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_SIGN_PENDING);
    const { store, migrated } = normalizePendingStore<DappSignPendingConnection>(raw);
    if (migrated) {
        await setStorageData(STORAGE_KEYS.DAPP_SIGN_PENDING, store);
    }
    const accountPending = store[accountId] || {};
    return Object.values(accountPending).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getDappSignPendingConnectionById(
    accountId: string,
    requestId: string
): Promise<DappSignPendingConnection | null> {
    if (!accountId || !requestId) return null;
    const raw =
        await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_SIGN_PENDING);
    const { store, migrated } = normalizePendingStore<DappSignPendingConnection>(raw);
    if (migrated) {
        await setStorageData(STORAGE_KEYS.DAPP_SIGN_PENDING, store);
    }
    return store?.[accountId]?.[requestId] || null;
}

export async function clearDappSignPendingConnection(accountId: string, requestId?: string): Promise<void> {
    if (!accountId) return;
    const raw =
        await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_SIGN_PENDING);
    const { store } = normalizePendingStore<DappSignPendingConnection>(raw);
    const accountPending = store[accountId];
    if (!accountPending) return;
    if (!requestId) {
        delete store[accountId];
        await setStorageData(STORAGE_KEYS.DAPP_SIGN_PENDING, store);
        return;
    }
    if (!accountPending[requestId]) return;
    delete accountPending[requestId];
    if (Object.keys(accountPending).length === 0) {
        delete store[accountId];
    }
    await setStorageData(STORAGE_KEYS.DAPP_SIGN_PENDING, store);
}

export async function saveDappPendingTransaction(pending: DappPendingTransaction): Promise<void> {
    if (!pending?.accountId) return;
    const raw = await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_TX_PENDING);
    const { store } = normalizePendingStore<DappPendingTransaction>(raw);
    if (!store[pending.accountId]) store[pending.accountId] = {};
    store[pending.accountId][pending.requestId] = pending;
    await setStorageData(STORAGE_KEYS.DAPP_TX_PENDING, store);
}

export async function getDappPendingTransaction(accountId: string): Promise<DappPendingTransaction | null> {
    if (!accountId) return null;
    const raw = await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_TX_PENDING);
    const { store, migrated } = normalizePendingStore<DappPendingTransaction>(raw);
    if (migrated) {
        await setStorageData(STORAGE_KEYS.DAPP_TX_PENDING, store);
    }
    const accountPending = store[accountId] || {};
    const list = Object.values(accountPending).sort((a, b) => a.createdAt - b.createdAt);
    return list[0] || null;
}

export async function getDappPendingTransactions(accountId: string): Promise<DappPendingTransaction[]> {
    if (!accountId) return [];
    const raw = await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_TX_PENDING);
    const { store, migrated } = normalizePendingStore<DappPendingTransaction>(raw);
    if (migrated) {
        await setStorageData(STORAGE_KEYS.DAPP_TX_PENDING, store);
    }
    const accountPending = store[accountId] || {};
    return Object.values(accountPending).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getDappPendingTransactionById(
    accountId: string,
    requestId: string
): Promise<DappPendingTransaction | null> {
    if (!accountId || !requestId) return null;
    const raw = await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_TX_PENDING);
    const { store, migrated } = normalizePendingStore<DappPendingTransaction>(raw);
    if (migrated) {
        await setStorageData(STORAGE_KEYS.DAPP_TX_PENDING, store);
    }
    return store?.[accountId]?.[requestId] || null;
}

export async function clearDappPendingTransaction(accountId: string, requestId?: string): Promise<void> {
    if (!accountId) return;
    const raw = await getStorageData<Record<string, unknown>>(STORAGE_KEYS.DAPP_TX_PENDING);
    const { store } = normalizePendingStore<DappPendingTransaction>(raw);
    const accountPending = store[accountId];
    if (!accountPending) return;
    if (!requestId) {
        delete store[accountId];
        await setStorageData(STORAGE_KEYS.DAPP_TX_PENDING, store);
        return;
    }
    if (!accountPending[requestId]) return;
    delete accountPending[requestId];
    if (Object.keys(accountPending).length === 0) {
        delete store[accountId];
    }
    await setStorageData(STORAGE_KEYS.DAPP_TX_PENDING, store);
}

function normalizeDappTxId(txId: string): string {
    return String(txId || '').trim().toLowerCase();
}

function buildDappTxWatchKey(watch: DappTxWatch): string {
    return [
        normalizeDappTxId(watch.txId),
        normalizeOrigin(watch.origin),
        String(watch.requestId || watch.createdAt || Date.now()),
    ].join(':');
}

function pruneDappTxWatches(store: Record<string, Record<string, DappTxWatch>>): void {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const [accountId, watches] of Object.entries(store)) {
        for (const [key, watch] of Object.entries(watches || {})) {
            if (!watch?.txId || Number(watch.createdAt || 0) < cutoff) {
                delete watches[key];
            }
        }
        if (Object.keys(watches || {}).length === 0) {
            delete store[accountId];
        }
    }
}

export async function saveDappTxWatch(watch: DappTxWatch): Promise<void> {
    if (!watch?.accountId || !watch.txId || !watch.origin) return;
    const raw = await getStorageData<Record<string, Record<string, DappTxWatch>>>(STORAGE_KEYS.DAPP_TX_WATCHES);
    const store = raw && typeof raw === 'object' ? raw : {};
    pruneDappTxWatches(store);
    if (!store[watch.accountId]) store[watch.accountId] = {};
    const normalized: DappTxWatch = {
        ...watch,
        txId: normalizeDappTxId(watch.txId),
        origin: normalizeOrigin(watch.origin),
        mode: String(watch.mode || 'normal'),
        createdAt: Number(watch.createdAt || Date.now()),
    };
    store[watch.accountId][buildDappTxWatchKey(normalized)] = normalized;
    await setStorageData(STORAGE_KEYS.DAPP_TX_WATCHES, store);
}

export async function consumeDappTxWatches(accountId: string, txId: string): Promise<DappTxWatch[]> {
    if (!accountId || !txId) return [];
    const normalizedTxId = normalizeDappTxId(txId);
    const raw = await getStorageData<Record<string, Record<string, DappTxWatch>>>(STORAGE_KEYS.DAPP_TX_WATCHES);
    const store = raw && typeof raw === 'object' ? raw : {};
    pruneDappTxWatches(store);
    const accountWatches = store[accountId] || {};
    const matched: DappTxWatch[] = [];
    for (const [key, watch] of Object.entries(accountWatches)) {
        if (normalizeDappTxId(watch?.txId || '') !== normalizedTxId) continue;
        matched.push(watch);
        delete accountWatches[key];
    }
    if (Object.keys(accountWatches).length === 0) {
        delete store[accountId];
    } else {
        store[accountId] = accountWatches;
    }
    await setStorageData(STORAGE_KEYS.DAPP_TX_WATCHES, store);
    return matched;
}

export async function getDappTxWatches(): Promise<Record<string, DappTxWatch[]>> {
    const raw = await getStorageData<Record<string, Record<string, DappTxWatch>>>(STORAGE_KEYS.DAPP_TX_WATCHES);
    const store = raw && typeof raw === 'object' ? raw : {};
    pruneDappTxWatches(store);
    await setStorageData(STORAGE_KEYS.DAPP_TX_WATCHES, store);
    const result: Record<string, DappTxWatch[]> = {};
    for (const [accountId, watches] of Object.entries(store)) {
        const list = Object.values(watches || {});
        if (list.length > 0) result[accountId] = list;
    }
    return result;
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

export async function hasActiveSession(accountId?: string): Promise<boolean> {
    const record = await getStorageData<SessionRecord>(STORAGE_KEYS.SESSION);
    if (!record || !record.accountId || !record.privKey) return false;
    if (accountId && record.accountId !== accountId) return false;
    if (!record.expiresAt || Date.now() > record.expiresAt) {
        await removeStorageData(STORAGE_KEYS.SESSION);
        return false;
    }
    return true;
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
