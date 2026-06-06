import {
    API_BASE_URL,
    API_ENDPOINTS,
    DEFAULT_TIMEOUT,
    apiClient,
    buildApiUrl,
    buildAssignNodeUrl,
    clearComNodeCache,
    getComNodeEndpoint,
    getErrorMessage,
    isApiError,
} from './api';
import {
    AlgorithmECDSAP256,
    convertHexToPublicKey,
    getPublicKeyHexFromPrivate,
    hashBackendJson,
    getTimestamp,
    publicKeyEnvelopeFromHex,
    serializeForBackend,
    signHashEnvelope,
    signStruct,
    bigIntToHex,
    type EcdsaSignature,
    type PublicKeyEnvelope,
    type PublicKeyNew,
    type SignatureEnvelope,
} from './signature';
import { buildInitialSeedMetaFromPrivateKey } from './seedChain';
import {
    getAccount,
    getAccountSignPublicKeyV2,
    getOrganization,
    getSessionAddressKey,
    getSessionKey,
    hasAddressProtocolMetadata,
    normalizeAddressDataForStorage,
    publicKeyEnvelopeEquals,
    saveAccount,
    type OrganizationChoice,
    type UserAccount,
} from './storage';

export interface UserNewAddressInfo {
    NewAddress: string;
    PublicKeyNew: PublicKeyNew;
    SignPublicKeyV2: PublicKeyEnvelope;
    SeedAnchor: number[] | string;
    SeedChainStep: number;
    DefaultSpendAlgorithm: string;
    UserID: string;
    Type: number;
    Sig?: EcdsaSignature;
}

export interface NewAddressResponse {
    success: boolean;
    message?: string;
    error?: string;
}

export interface RegisterAddressRequest {
    Address: string;
    PublicKeyNew: PublicKeyNew;
    GroupID: string;
    TimeStamp: number;
    Type: number;
    SignPublicKeyV2: PublicKeyEnvelope;
    SeedAnchor: number[] | string;
    SeedChainStep: number;
    DefaultSpendAlgorithm: string;
    AddressOwnershipSig?: SignatureEnvelope;
    Sig?: EcdsaSignature;
}

export interface RegisterAddressResponse {
    success: boolean;
    message?: string;
    error?: string;
}

export interface UserAddressBindingMsg {
    Op: number;
    UserID: string;
    Address: string;
    PublicKey: PublicKeyNew;
    SignPublicKeyV2?: PublicKeyEnvelope;
    SeedAnchor?: number[] | string;
    SeedChainStep?: number;
    DefaultSpendAlgorithm?: string;
    Type: number;
    TimeStamp: number;
    Sig?: EcdsaSignature;
}

export interface UnbindAddressResponse {
    success: boolean;
    message?: string;
    error?: string;
}

export type AddressResult<T> =
    | { success: true; data: T }
    | { success: false; error: string };

export interface AddressGroupInfo {
    GroupID: string;
    PublicKey?: { CurveName: string; X?: number | string; Y?: number | string };
    Type?: number;
    SignPublicKeyV2?: PublicKeyEnvelope;
    SeedAnchor?: number[] | string;
    SeedChainStep?: number;
    DefaultSpendAlgorithm?: string;
}

export interface QueryAddressGroupResponse {
    UserID: string;
    Addresstogroup: Record<string, AddressGroupInfo>;
}

export const GROUP_ID_NOT_EXIST = '0';
export const GROUP_ID_RETAIL = '1';

export function isInGuarGroup(groupId: string): boolean {
    return groupId !== GROUP_ID_NOT_EXIST && groupId !== GROUP_ID_RETAIL;
}

function normalizeAddress(address: string): string {
    return String(address || '').trim().replace(/^0x/i, '').toLowerCase();
}

function buildAssignNewAddressUrl(org: OrganizationChoice): string {
    const endpoint = org.assignAPIEndpoint || org.assignNodeUrl || '';
    const base = endpoint ? buildAssignNodeUrl(endpoint) : API_BASE_URL;
    return buildApiUrl(base, API_ENDPOINTS.ASSIGN_NEW_ADDRESS(org.groupId));
}

function ensureAddressProtocolMeta(params: {
    accountId: string;
    address: string;
    pubXHex: string;
    pubYHex: string;
    addressType: number;
    addressPrivHex: string;
    accountPrivHex: string;
}): {
    signPublicKeyV2: PublicKeyEnvelope;
    seedAnchor: number[];
    seedChainStep: number;
    defaultSpendAlgorithm: string;
} {
    const { accountPrivHex, addressPrivHex } = params;
    if (!accountPrivHex) {
        throw new Error('account private key required for SignPublicKeyV2');
    }
    if (!addressPrivHex) {
        throw new Error('address seed recovery material missing');
    }
    const accountPub = getPublicKeyHexFromPrivate(accountPrivHex);
    const signPublicKeyV2 = publicKeyEnvelopeFromHex(accountPub.x, accountPub.y);
    const seedMeta = buildInitialSeedMetaFromPrivateKey(addressPrivHex);
    return {
        signPublicKeyV2,
        seedAnchor: seedMeta.seedAnchor,
        seedChainStep: seedMeta.seedChainStep,
        defaultSpendAlgorithm: seedMeta.defaultSpendAlgorithm || AlgorithmECDSAP256,
    };
}

export async function createNewAddressOnBackendWithPriv(
    accountId: string,
    newAddress: string,
    pubXHex: string,
    pubYHex: string,
    addressType: number,
    accountPrivHex: string,
    orgOverride?: OrganizationChoice | null,
    addressPrivHex?: string
): Promise<AddressResult<NewAddressResponse>> {
    try {
        const org = orgOverride || (await getOrganization(accountId));
        if (!org || !org.groupId) {
            return {
                success: true,
                data: { success: true, message: 'Not in organization' },
            };
        }

        if (!accountPrivHex) {
            return { success: false, error: '账户私钥缺失' };
        }

        const normalizedAddress = normalizeAddress(newAddress);
        const resolvedAddressPriv = addressPrivHex || getSessionAddressKey(normalizedAddress) || '';
        if (!resolvedAddressPriv) {
            return { success: false, error: 'address seed recovery material missing' };
        }
        const protocolMeta = ensureAddressProtocolMeta({
            accountId,
            address: normalizedAddress,
            pubXHex,
            pubYHex,
            addressType,
            addressPrivHex: resolvedAddressPriv,
            accountPrivHex,
        });

        const requestBody: UserNewAddressInfo = {
            NewAddress: normalizedAddress,
            PublicKeyNew: convertHexToPublicKey(pubXHex, pubYHex),
            SignPublicKeyV2: protocolMeta.signPublicKeyV2,
            SeedAnchor: protocolMeta.seedAnchor,
            SeedChainStep: protocolMeta.seedChainStep,
            DefaultSpendAlgorithm: protocolMeta.defaultSpendAlgorithm,
            UserID: accountId,
            Type: addressType,
        };

        requestBody.Sig = signStruct(requestBody as unknown as Record<string, unknown>, accountPrivHex, ['Sig']);

        const response = await apiClient.request<NewAddressResponse>(buildAssignNewAddressUrl(org), {
            method: 'POST',
            body: serializeForBackend(requestBody),
            timeout: DEFAULT_TIMEOUT,
            retries: 0,
        });

        return { success: true, data: response.data };
    } catch (error) {
        return {
            success: false,
            error: getErrorMessage(error),
        };
    }
}

export interface RegisterAddressOnComNodeParams {
    accountId: string;
    address: string;
    pubXHex: string;
    pubYHex: string;
    addressPrivHex: string;
    accountPrivHex: string;
    addressType: number;
}

export async function registerAddressOnComNode(
    params: RegisterAddressOnComNodeParams
): Promise<AddressResult<RegisterAddressResponse & {
    signPublicKeyV2: PublicKeyEnvelope;
    seedAnchor: number[];
    seedChainStep: number;
    defaultSpendAlgorithm: string;
}>> {
    try {
        const comNodeURL = await getComNodeEndpoint();
        if (!comNodeURL) {
            return { success: false, error: 'ComNode 端点不可用' };
        }

        const {
            accountId,
            address,
            pubXHex,
            pubYHex,
            addressPrivHex,
            accountPrivHex,
            addressType,
        } = params;
        if (!accountPrivHex) {
            return { success: false, error: 'Unlock account private key first' };
        }
        if (!addressPrivHex) {
            return { success: false, error: 'address private key missing' };
        }

        const normalizedAddress = normalizeAddress(address);
        const protocolMeta = ensureAddressProtocolMeta({
            accountId,
            address: normalizedAddress,
            pubXHex,
            pubYHex,
            addressType,
            addressPrivHex,
            accountPrivHex,
        });
        const ownershipPayload = {
            Address: normalizedAddress,
            PublicKeyNew: convertHexToPublicKey(pubXHex, pubYHex),
            GroupID: '',
            TimeStamp: getTimestamp(),
            Type: addressType,
            SignPublicKeyV2: protocolMeta.signPublicKeyV2,
            SeedAnchor: protocolMeta.seedAnchor,
            SeedChainStep: protocolMeta.seedChainStep,
            DefaultSpendAlgorithm: protocolMeta.defaultSpendAlgorithm,
        };
        const addressOwnershipSig = signHashEnvelope(
            AlgorithmECDSAP256,
            hashBackendJson(ownershipPayload),
            addressPrivHex
        );

        const requestBody: RegisterAddressRequest = {
            Address: normalizedAddress,
            PublicKeyNew: convertHexToPublicKey(pubXHex, pubYHex),
            GroupID: '',
            TimeStamp: ownershipPayload.TimeStamp,
            Type: addressType,
            SignPublicKeyV2: protocolMeta.signPublicKeyV2,
            SeedAnchor: protocolMeta.seedAnchor,
            SeedChainStep: protocolMeta.seedChainStep,
            DefaultSpendAlgorithm: protocolMeta.defaultSpendAlgorithm,
            AddressOwnershipSig: addressOwnershipSig,
        };

        requestBody.Sig = signStruct(
            requestBody as unknown as Record<string, unknown>,
            addressPrivHex,
            ['Sig', 'AddressOwnershipSig']
        );

        const response = await apiClient.request<RegisterAddressResponse>(
            buildApiUrl(comNodeURL, API_ENDPOINTS.COM_REGISTER_ADDRESS),
            {
                method: 'POST',
                body: serializeForBackend(requestBody),
                timeout: DEFAULT_TIMEOUT,
                retries: 0,
            }
        );

        return {
            success: true,
            data: {
                ...response.data,
                signPublicKeyV2: protocolMeta.signPublicKeyV2,
                seedAnchor: protocolMeta.seedAnchor,
                seedChainStep: protocolMeta.seedChainStep,
                defaultSpendAlgorithm: protocolMeta.defaultSpendAlgorithm,
            },
        };
    } catch (error) {
        return {
            success: false,
            error: getErrorMessage(error),
        };
    }
}

export async function queryAddressGroupInfo(
    address: string
): Promise<{
    success: boolean;
    data?: {
        groupId: string;
        type: number;
        publicKey?: { x: string; y: string };
        signPublicKeyV2?: PublicKeyEnvelope;
        seedAnchor?: number[] | string;
        seedChainStep?: number;
        defaultSpendAlgorithm?: string;
    };
    error?: string;
}> {
    try {
        const comNodeURL = await getComNodeEndpoint();
        if (!comNodeURL) {
            return { success: false, error: 'ComNode 端点不可用' };
        }

        const normalized = normalizeAddress(address);
        const response = await apiClient.request<QueryAddressGroupResponse>(
            buildApiUrl(comNodeURL, API_ENDPOINTS.COM_QUERY_ADDRESS_GROUP),
            {
                method: 'POST',
                body: { address: [normalized] },
                timeout: DEFAULT_TIMEOUT,
                retries: 0,
                useBigIntParsing: true,
                silent: true,
            }
        );

        const data = response.data;
        const info = data?.Addresstogroup?.[normalized];
        const groupId = info?.GroupID || GROUP_ID_NOT_EXIST;
        const type = typeof info?.Type === 'number' ? info.Type : Number(info?.Type ?? 0);
        let publicKey: { x: string; y: string } | undefined;
        if (info?.PublicKey?.X !== undefined && info?.PublicKey?.Y !== undefined) {
            try {
                const xHex = bigIntToHex(info.PublicKey.X);
                const yHex = bigIntToHex(info.PublicKey.Y);
                if (!/^0+$/.test(xHex) && !/^0+$/.test(yHex)) {
                    publicKey = { x: xHex, y: yHex };
                }
            } catch {
                publicKey = undefined;
            }
        }

        return {
            success: true,
            data: {
                groupId,
                type,
                publicKey,
                signPublicKeyV2: info?.SignPublicKeyV2,
                seedAnchor: info?.SeedAnchor,
                seedChainStep: Number(info?.SeedChainStep ?? 0) || undefined,
                defaultSpendAlgorithm: info?.DefaultSpendAlgorithm,
            },
        };
    } catch (error) {
        if (isApiError(error) && error.status === 503) {
            clearComNodeCache();
        }
        return {
            success: false,
            error: getErrorMessage(error),
        };
    }
}

export async function unbindAddressOnBackend(
    accountId: string,
    address: string,
    pubXHex: string,
    pubYHex: string,
    addressType: number = 0
): Promise<AddressResult<UnbindAddressResponse>> {
    try {
        const org = await getOrganization(accountId);
        if (!org || !org.groupId) {
            return {
                success: true,
                data: { success: true, message: 'Not in organization' },
            };
        }

        const session = getSessionKey();
        if (!session || session.accountId !== accountId) {
            return { success: false, error: '请先解锁账户私钥' };
        }

        if (!pubXHex || !pubYHex) {
            return { success: false, error: '地址公钥缺失' };
        }

        const normalizedAddress = normalizeAddress(address);
        const account = await getAccount(accountId);
        const existing = account?.addresses?.[normalizedAddress];
        const normalizedMeta = account && existing
            ? normalizeAddressDataForStorage(normalizedAddress, existing, account)
            : null;
        if (!normalizedMeta || !hasAddressProtocolMetadata(normalizedMeta)) {
            return { success: false, error: 'address protocol metadata incomplete' };
        }

        const requestBody: UserAddressBindingMsg = {
            Op: 0,
            UserID: accountId,
            Address: normalizedAddress,
            PublicKey: convertHexToPublicKey(pubXHex, pubYHex),
            SignPublicKeyV2: normalizedMeta.signPublicKeyV2 || undefined,
            SeedAnchor: normalizedMeta.seedAnchor,
            SeedChainStep: normalizedMeta.seedChainStep,
            DefaultSpendAlgorithm: normalizedMeta.defaultSpendAlgorithm,
            Type: addressType,
            TimeStamp: getTimestamp(),
        };

        requestBody.Sig = signStruct(requestBody as unknown as Record<string, unknown>, session.privKey, ['Sig']);

        const endpoint = org.assignAPIEndpoint || org.assignNodeUrl || '';
        const base = endpoint ? buildAssignNodeUrl(endpoint) : API_BASE_URL;
        const url = buildApiUrl(base, API_ENDPOINTS.ASSIGN_UNBIND_ADDRESS(org.groupId));

        try {
            const response = await apiClient.request<UnbindAddressResponse>(url, {
                method: 'POST',
                body: serializeForBackend(requestBody),
                timeout: DEFAULT_TIMEOUT,
                retries: 0,
            });
            return { success: true, data: response.data };
        } catch (error) {
            const errorMsg = getErrorMessage(error);
            if (
                errorMsg.includes('user is not in the guarantor') ||
                errorMsg.includes('user not found in group') ||
                errorMsg.includes('address not found') ||
                errorMsg.includes('already revoked')
            ) {
                return { success: true, data: { success: true, message: errorMsg } };
            }
            return { success: false, error: errorMsg };
        }
    } catch (error) {
        return {
            success: false,
            error: getErrorMessage(error),
        };
    }
}

type ToastType = 'success' | 'error' | 'info' | 'warning';

function getToastHandler():
    | ((message: string, type?: ToastType, title?: string, duration?: number) => void)
    | null {
    if (typeof window === 'undefined') return null;
    const anyWindow = window as any;
    if (anyWindow?.PanguPay?.ui?.showToast) return anyWindow.PanguPay.ui.showToast;
    if (anyWindow?.showToast) return anyWindow.showToast;
    return null;
}

function notifyToast(message: string, type: ToastType): void {
    const handler = getToastHandler();
    if (!handler) return;
    handler(message, type);
}

export async function registerAddressesOnMainEntry(account: UserAccount): Promise<void> {
    if (!account) return;

    const addresses = Object.keys(account.addresses || {});
    if (addresses.length === 0) return;

    const org = await getOrganization(account.accountId);
    if (account.mainAddressRegistered && org?.groupId) return;

    const errors: string[] = [];
    let hadErrors = false;
    let changed = false;

    if (org?.groupId) {
        const session = getSessionKey();
        if (!session || session.accountId !== account.accountId) {
            notifyToast('Unlock account private key first', 'warning');
            return;
        }

        for (const rawAddr of addresses) {
            const addr = normalizeAddress(rawAddr);
            const meta = normalizeAddressDataForStorage(addr, account.addresses[rawAddr], account);
            const pubXHex = meta.pubXHex || '';
            const pubYHex = meta.pubYHex || '';
            if (!pubXHex || !pubYHex) continue;

            const addressPrivHex =
                getSessionAddressKey(addr) ||
                meta.privHex ||
                (addr === normalizeAddress(account.mainAddress) ? session.privKey : '');
            if (!addressPrivHex || meta.readOnly || meta.seedRepairRequired) {
                account.addresses[addr] = {
                    ...meta,
                    registrationState: 'failed',
                    registrationError: !addressPrivHex
                        ? 'address private key missing'
                        : 'address requires seed repair before registration',
                };
                changed = true;
                continue;
            }

            const result = await createNewAddressOnBackendWithPriv(
                account.accountId,
                addr,
                pubXHex,
                pubYHex,
                Number(meta.type ?? 0),
                session.privKey,
                org,
                addressPrivHex
            );
            const successFlag = result.success &&
                (typeof result.data?.success === 'boolean' ? result.data.success : true);
            if (!successFlag) {
                const msg = result.success
                    ? result.data?.error || result.data?.message || 'address registration failed'
                    : result.error;
                errors.push(msg);
                account.addresses[addr] = {
                    ...meta,
                    registrationState: 'failed',
                    registrationError: msg,
                };
                changed = true;
                hadErrors = true;
                continue;
            }

            account.addresses[addr] = normalizeAddressDataForStorage(addr, {
                ...meta,
                registrationState: 'registered',
                registrationError: undefined,
            }, account);
            changed = true;
        }
    } else {
        const session = getSessionKey();
        if (!session || session.accountId !== account.accountId) {
            notifyToast('Unlock account private key first', 'warning');
            return;
        }

        const accountSignPublicKeyV2 = getAccountSignPublicKeyV2(account);
        if (!accountSignPublicKeyV2) {
            notifyToast('Account SignPublicKeyV2 unavailable', 'warning');
            return;
        }

        for (const rawAddr of addresses) {
            const addr = normalizeAddress(rawAddr);
            const meta = normalizeAddressDataForStorage(addr, account.addresses[rawAddr], account);
            if (JSON.stringify(meta) !== JSON.stringify(account.addresses[rawAddr])) {
                account.addresses[addr] = meta;
                changed = true;
            }

            const pubXHex = meta.pubXHex || '';
            const pubYHex = meta.pubYHex || '';
            if (!pubXHex || !pubYHex) continue;

            const addressPrivHex =
                getSessionAddressKey(addr) ||
                meta.privHex ||
                (addr === normalizeAddress(account.mainAddress) ? session.privKey : '');
            if (!addressPrivHex || meta.readOnly || meta.seedRepairRequired) {
                account.addresses[addr] = {
                    ...meta,
                    registrationState: 'failed',
                    registrationError: !addressPrivHex
                        ? 'address private key missing'
                        : 'address requires seed repair before registration',
                };
                changed = true;
                continue;
            }

            let remoteSignPublicKeyV2: PublicKeyEnvelope | undefined;
            let remoteGroupId = GROUP_ID_NOT_EXIST;
            const remote = await queryAddressGroupInfo(addr);
            if (remote.success) {
                remoteSignPublicKeyV2 = remote.data?.signPublicKeyV2;
                remoteGroupId = remote.data?.groupId || GROUP_ID_NOT_EXIST;
            }

            if (isInGuarGroup(remoteGroupId)) {
                const msg = `address already bound to guarantor group ${remoteGroupId}`;
                errors.push(msg);
                account.addresses[addr] = {
                    ...meta,
                    registrationState: 'failed',
                    registrationError: msg,
                };
                changed = true;
                hadErrors = true;
                continue;
            }

            const needsRegister =
                meta.registrationState !== 'registered' ||
                remoteGroupId === GROUP_ID_NOT_EXIST ||
                !publicKeyEnvelopeEquals(meta.signPublicKeyV2, accountSignPublicKeyV2) ||
                !publicKeyEnvelopeEquals(remoteSignPublicKeyV2, accountSignPublicKeyV2);
            if (!needsRegister) continue;

            const result = await registerAddressOnComNode({
                accountId: account.accountId,
                address: addr,
                pubXHex,
                pubYHex,
                addressPrivHex,
                accountPrivHex: session.privKey,
                addressType: Number(meta.type ?? 0),
            });
            const successFlag = result.success &&
                (typeof result.data?.success === 'boolean' ? result.data.success : true);
            if (!successFlag) {
                const msg = result.success
                    ? result.data?.error || result.data?.message || 'address registration failed'
                    : result.error;
                errors.push(msg);
                account.addresses[addr] = {
                    ...meta,
                    registrationState: 'failed',
                    registrationError: msg,
                };
                changed = true;
                hadErrors = true;
                continue;
            }

            account.addresses[addr] = normalizeAddressDataForStorage(addr, {
                ...meta,
                signPublicKeyV2: result.data.signPublicKeyV2,
                seedAnchor: result.data.seedAnchor,
                seedChainStep: result.data.seedChainStep,
                defaultSpendAlgorithm: result.data.defaultSpendAlgorithm,
                registrationState: 'registered',
                registrationError: undefined,
            }, account);
            changed = true;
        }
    }

    if (errors.length > 0) {
        notifyToast(errors[0], 'error');
    }

    if (!hadErrors) {
        account.mainAddressRegistered = true;
        changed = true;
    }

    if (changed) {
        await saveAccount(account);
    }
}
