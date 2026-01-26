import {
    API_BASE_URL,
    API_ENDPOINTS,
    buildApiUrl,
    buildNodeUrl,
    clearComNodeCache,
    getComNodeEndpoint,
} from './api';
import { parseBigIntJson } from './bigIntJson';
import {
    convertHexToPublicKey,
    getTimestamp,
    serializeForBackend,
    signStruct,
    type EcdsaSignature,
    type PublicKeyNew,
} from './signature';
import { getOrganization, getSessionKey, type OrganizationChoice } from './storage';

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
    const base = org.assignNodeUrl ? buildNodeUrl(org.assignNodeUrl) : API_BASE_URL;
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

        const response = await fetch(buildAssignNewAddressUrl(org), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: serializeForBackend(requestBody),
        });

        let responseData: NewAddressResponse = { success: response.ok };
        try {
            responseData = await response.json();
        } catch {
            responseData = {
                success: response.ok,
                message: response.ok ? 'Address created' : `HTTP ${response.status}`,
            };
        }

        if (!response.ok) {
            return {
                success: false,
                error: responseData.error || responseData.message || `HTTP ${response.status}`,
            };
        }

        return { success: true, data: responseData };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : '创建地址失败',
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

        const response = await fetch(buildApiUrl(comNodeURL, API_ENDPOINTS.COM_REGISTER_ADDRESS), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: serializeForBackend(requestBody),
        });

        let responseData: RegisterAddressResponse = { success: response.ok };
        try {
            const data = await response.json();
            responseData = {
                ...data,
                success: typeof (data as RegisterAddressResponse).success === 'boolean' ? data.success : response.ok,
            };
        } catch {
            responseData = {
                success: response.ok,
                message: response.ok ? 'Address registered' : `HTTP ${response.status}`,
            };
        }

        if (!response.ok) {
            return {
                success: false,
                error: responseData.error || responseData.message || `HTTP ${response.status}`,
            };
        }

        return { success: true, data: responseData };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : '地址注册失败',
        };
    }
}

export async function queryAddressGroupInfo(
    address: string
): Promise<{ success: boolean; data?: { groupId: string; type: number }; error?: string }> {
    try {
        const comNodeURL = await getComNodeEndpoint();
        if (!comNodeURL) {
            return { success: false, error: 'ComNode 端点不可用' };
        }

        const normalized = normalizeAddress(address);
        const response = await fetch(buildApiUrl(comNodeURL, API_ENDPOINTS.COM_QUERY_ADDRESS_GROUP), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: [normalized] }),
        });

        if (!response.ok) {
            if (response.status === 503) {
                clearComNodeCache();
            }
            const data = await response.json().catch(() => ({}));
            return {
                success: false,
                error: data.error || data.message || `HTTP ${response.status}`,
            };
        }

        const data = parseBigIntJson<QueryAddressGroupResponse>(await response.text());
        const info = data?.Addresstogroup?.[normalized];
        const groupId = info?.GroupID || GROUP_ID_NOT_EXIST;
        const type = typeof info?.Type === 'number' ? info.Type : Number(info?.Type ?? 0);

        return { success: true, data: { groupId, type } };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : '查询失败',
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

        const base = org.assignNodeUrl ? buildNodeUrl(org.assignNodeUrl) : API_BASE_URL;
        const url = buildApiUrl(base, API_ENDPOINTS.ASSIGN_UNBIND_ADDRESS(org.groupId));

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: serializeForBackend(requestBody),
        });

        let responseData: UnbindAddressResponse = { success: response.ok };
        try {
            responseData = await response.json();
        } catch {
            responseData = {
                success: response.ok,
                message: response.ok ? 'Address unbound' : `HTTP ${response.status}`,
            };
        }

        if (!response.ok) {
            const errorMsg = responseData.error || responseData.message || `HTTP ${response.status}`;
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

        return { success: true, data: responseData };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : '解绑地址失败',
        };
    }
}
