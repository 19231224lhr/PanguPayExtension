/**
 * Capsule address helper (extension)
 */

import { API_BASE_URL, API_ENDPOINTS, buildApiUrl, buildNodeUrl, getComNodeEndpoint } from './api';
import { getOrganization, getSessionAddressKey, getSessionKey, type OrganizationChoice } from './storage';
import { getCustomEpochTimestamp, serializeForBackend, signStruct, type EcdsaSignature } from './signature';

interface CapsuleAddressRequest {
    UserID: string;
    Address: string;
    Timestamp: number;
    Sig?: EcdsaSignature;
}

interface CapsuleAddressReply {
    Success: boolean;
    CapsuleAddr: string;
    ErrorMsg?: string;
}

const COMMITTEE_ORG_ID = '00000000';
const capsuleCache = new Map<string, string>();

function normalizeAddress(address: string): string {
    return String(address || '').trim().replace(/^0x/i, '').toLowerCase();
}

function isValidAddress(address: string): boolean {
    return /^[0-9a-f]{40}$/.test(address);
}

function buildCacheKey(orgId: string, address: string): string {
    return `${orgId}:${address}`;
}

function buildAssignCapsuleUrl(org: OrganizationChoice): string {
    const base = org.assignNodeUrl ? buildNodeUrl(org.assignNodeUrl) : API_BASE_URL;
    return buildApiUrl(base, API_ENDPOINTS.ASSIGN_CAPSULE_GENERATE(org.groupId));
}

export async function requestCapsuleAddress(accountId: string, address: string): Promise<string> {
    const normalized = normalizeAddress(address);
    if (!isValidAddress(normalized)) {
        throw new Error('地址格式不正确');
    }

    const org = await getOrganization(accountId);
    const inGroup = !!(org && org.groupId && org.groupId.trim());
    const orgId = inGroup ? org!.groupId : COMMITTEE_ORG_ID;
    const cacheKey = buildCacheKey(orgId, normalized);
    const cached = capsuleCache.get(cacheKey);
    if (cached) return cached;

    const requestBody: CapsuleAddressRequest = {
        UserID: inGroup ? accountId : '',
        Address: normalized,
        Timestamp: getCustomEpochTimestamp(),
    };

    if (inGroup) {
        const session = getSessionKey();
        if (!session || session.accountId !== accountId) {
            throw new Error('请先解锁账户私钥');
        }
        requestBody.Sig = signStruct(requestBody as unknown as Record<string, unknown>, session.privKey, ['Sig']);
    } else {
        const addrKey = getSessionAddressKey(address);
        if (!addrKey) {
            throw new Error('请先导入或解锁该地址私钥');
        }
        requestBody.Sig = signStruct(requestBody as unknown as Record<string, unknown>, addrKey, ['Sig']);
    }

    const apiUrl = inGroup
        ? buildAssignCapsuleUrl(org as OrganizationChoice)
        : buildApiUrl(await getComNodeEndpoint(), API_ENDPOINTS.COM_CAPSULE_GENERATE);

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: serializeForBackend(requestBody),
    });

    const data = (await response.json()) as CapsuleAddressReply & { error?: string; message?: string };
    if (!response.ok) {
        throw new Error(data.error || data.message || '网络请求失败');
    }
    if (!data.Success) {
        throw new Error(data.ErrorMsg || '生成胶囊地址失败');
    }

    capsuleCache.set(cacheKey, data.CapsuleAddr);
    return data.CapsuleAddr;
}
