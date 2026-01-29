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
    convertHexToPublicKey,
    getTimestamp,
    serializeForBackend,
    signStruct,
    bigIntToHex,
    type EcdsaSignature,
    type PublicKeyNew,
} from './signature';
import {
    getOrganization,
    getSessionAddressKey,
    getSessionKey,
    saveAccount,
    type OrganizationChoice,
    type UserAccount,
} from './storage';

export interface UserNewAddressInfo {
    NewAddress: string;
    PublicKeyNew: PublicKeyNew;
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

export async function createNewAddressOnBackendWithPriv(
    accountId: string,
    newAddress: string,
    pubXHex: string,
    pubYHex: string,
    addressType: number,
    accountPrivHex: string,
    orgOverride?: OrganizationChoice | null
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

        const requestBody: UserNewAddressInfo = {
            NewAddress: normalizeAddress(newAddress),
            PublicKeyNew: convertHexToPublicKey(pubXHex, pubYHex),
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

export async function registerAddressOnComNode(
    address: string,
    pubXHex: string,
    pubYHex: string,
    privHex: string,
    addressType: number
): Promise<AddressResult<RegisterAddressResponse>> {
    try {
        const comNodeURL = await getComNodeEndpoint();
        if (!comNodeURL) {
            return { success: false, error: 'ComNode 端点不可用' };
        }

        const requestBody: RegisterAddressRequest = {
            Address: normalizeAddress(address),
            PublicKeyNew: convertHexToPublicKey(pubXHex, pubYHex),
            GroupID: '',
            TimeStamp: getTimestamp(),
            Type: addressType,
        };

        requestBody.Sig = signStruct(requestBody as unknown as Record<string, unknown>, privHex, ['Sig']);

        const response = await apiClient.request<RegisterAddressResponse>(
            buildApiUrl(comNodeURL, API_ENDPOINTS.COM_REGISTER_ADDRESS),
            {
                method: 'POST',
                body: serializeForBackend(requestBody),
                timeout: DEFAULT_TIMEOUT,
                retries: 0,
            }
        );

        return { success: true, data: response.data };
    } catch (error) {
        return {
            success: false,
            error: getErrorMessage(error),
        };
    }
}

export async function queryAddressGroupInfo(
    address: string
): Promise<{ success: boolean; data?: { groupId: string; type: number; publicKey?: { x: string; y: string } }; error?: string }> {
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

        return { success: true, data: { groupId, type, publicKey } };
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

        const requestBody: UserAddressBindingMsg = {
            Op: 0,
            UserID: accountId,
            Address: normalizeAddress(address),
            PublicKey: convertHexToPublicKey(pubXHex, pubYHex),
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
    if (!account || account.mainAddressRegistered) return;

    const addressMap = account.addresses || {};
    const addresses = Object.keys(addressMap);
    const errors: string[] = [];
    let hadErrors = false;

    if (addresses.length === 0) {
        return;
    }

    const org = await getOrganization(account.accountId);

    if (org?.groupId) {
        const session = getSessionKey();
        if (!session || session.accountId !== account.accountId) {
            notifyToast('请先解锁账户私钥', 'warning');
            return;
        }

        for (const addr of addresses) {
            const meta = addressMap[addr];
            const pubXHex = meta?.pubXHex || '';
            const pubYHex = meta?.pubYHex || '';
            const addressType = Number(meta?.type ?? 0);
            if (!pubXHex || !pubYHex) {
                continue;
            }

            const result = await createNewAddressOnBackendWithPriv(
                account.accountId,
                addr,
                pubXHex,
                pubYHex,
                addressType,
                session.privKey,
                org
            );

            if (!result.success) {
                errors.push(result.error);
                hadErrors = true;
                continue;
            }
            const successFlag = typeof result.data?.success === 'boolean' ? result.data.success : true;
            if (!successFlag) {
                const msg = result.data?.error || result.data?.message || '地址注册失败';
                errors.push(msg);
                hadErrors = true;
            }
        }
    } else {
        for (const addr of addresses) {
            const meta = addressMap[addr];
            const pubXHex = meta?.pubXHex || '';
            const pubYHex = meta?.pubYHex || '';
            const privHex = getSessionAddressKey(addr) || meta?.privHex || '';
            const addressType = Number(meta?.type ?? 0);
            if (!pubXHex || !pubYHex || !privHex) {
                continue;
            }

            const result = await registerAddressOnComNode(
                addr,
                pubXHex,
                pubYHex,
                privHex,
                addressType
            );

            if (!result.success) {
                errors.push(result.error);
                hadErrors = true;
                continue;
            }
            const successFlag = typeof result.data?.success === 'boolean' ? result.data.success : true;
            if (!successFlag) {
                const msg = result.data?.error || result.data?.message || '地址注册失败';
                errors.push(msg);
                hadErrors = true;
            }
        }
    }

    if (errors.length > 0) {
        notifyToast(errors[0], 'error');
    }

    if (!hadErrors) {
        account.mainAddressRegistered = true;
        await saveAccount(account);
    }
}
