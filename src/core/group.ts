import {
    API_BASE_URL,
    API_ENDPOINTS,
    DEFAULT_TIMEOUT,
    apiClient,
    buildAggrNodeUrl,
    buildApiUrl,
    buildAssignNodeUrl,
    getErrorMessage,
    getGroupInfo,
} from './api';
import { isInGuarGroup, queryAddressGroupInfo } from './address';
import {
    getSessionKey,
    getWalletAddresses,
    type OrganizationChoice,
    type UserAccount,
} from './storage';
import {
    convertHexToPublicKey,
    getCustomEpochTimestamp,
    getPublicKeyHexFromPrivate,
    serializeForBackend,
    signStruct,
    type EcdsaSignature,
    type PublicKeyNew,
} from './signature';

export interface FlowApplyRequest {
    Status: number;
    UserID: string;
    UserPeerID: string;
    GuarGroupID: string;
    UserPublicKey: PublicKeyNew;
    AddressMsg: Record<string, { AddressData: { PublicKeyNew: PublicKeyNew } }>;
    TimeStamp: number;
    UserSig?: EcdsaSignature;
}

export interface FlowApplyResponse {
    status: number;
    user_id: string;
    guar_group_id: string;
    result: boolean;
    message: string;
    error?: string;
}

function ensurePublicKey(pubXHex?: string, pubYHex?: string): PublicKeyNew | null {
    if (!pubXHex || !pubYHex) return null;
    return convertHexToPublicKey(pubXHex, pubYHex);
}

async function enrichOrg(org: OrganizationChoice): Promise<OrganizationChoice> {
    if (org.assignNodeUrl && org.aggrNodeUrl) return org;

    const info = await getGroupInfo(org.groupId);
    if (!info.success || !info.data) return org;

    const data = info.data as {
        assign_api_endpoint?: string;
        aggr_api_endpoint?: string;
        pledge_address?: string;
        group_name?: string;
    };

    const assignAPIEndpoint = org.assignAPIEndpoint || data.assign_api_endpoint || '';
    const aggrAPIEndpoint = org.aggrAPIEndpoint || data.aggr_api_endpoint || '';
    return {
        ...org,
        groupName: org.groupName || data.group_name || org.groupId,
        assignAPIEndpoint,
        aggrAPIEndpoint,
        assignNodeUrl:
            org.assignNodeUrl || (assignAPIEndpoint ? buildAssignNodeUrl(assignAPIEndpoint) : ''),
        aggrNodeUrl:
            org.aggrNodeUrl || (aggrAPIEndpoint ? buildAggrNodeUrl(aggrAPIEndpoint) : ''),
        pledgeAddress: org.pledgeAddress || data.pledge_address || '',
    };
}

async function ensureAddressesBelongToTargetOrg(
    account: UserAccount,
    targetGroupId: string
): Promise<{ ok: boolean; error?: string }> {
    const addresses = getWalletAddresses(account);
    for (const addr of addresses) {
        try {
            const result = await queryAddressGroupInfo(addr.address);
            if (!result.success || !result.data) {
                return { ok: false, error: result.error || '查询地址所属组织失败' };
            }
            const groupId = result.data.groupId || '';
            if (isInGuarGroup(groupId) && groupId !== targetGroupId) {
                const short = `${addr.address.slice(0, 10)}...${addr.address.slice(-6)}`;
                return {
                    ok: false,
                    error: `地址 ${short} 已属于担保组织 ${groupId}，请加入该组织或删除该地址后重试`,
                };
            }
        } catch (error) {
            return { ok: false, error: (error as Error).message || '查询地址所属组织失败' };
        }
    }
    return { ok: true };
}

function normalizeAssignBase(endpoint: string): string {
    const base = buildAssignNodeUrl(endpoint);
    if (!base) return '';
    try {
        const url = new URL(base);
        let pathname = url.pathname.replace(/\/+$/, '');
        if (pathname.endsWith('/api/v1')) {
            pathname = pathname.slice(0, -7);
        } else if (pathname.endsWith('/api')) {
            pathname = pathname.slice(0, -4);
        }
        url.pathname = pathname || '';
        return url.toString().replace(/\/$/, '');
    } catch {
        return base.replace(/\/+$/, '');
    }
}

function buildFlowApplyUrl(org: OrganizationChoice): string {
    const endpoint = org.assignAPIEndpoint || org.assignNodeUrl || '';
    const base = endpoint ? normalizeAssignBase(endpoint) : API_BASE_URL;
    return buildApiUrl(base, API_ENDPOINTS.ASSIGN_FLOW_APPLY(org.groupId));
}

function buildAddressMsg(account: UserAccount): Record<string, { AddressData: { PublicKeyNew: PublicKeyNew } }> {
    const addressMsg: Record<string, { AddressData: { PublicKeyNew: PublicKeyNew } }> = {};
    const addresses = getWalletAddresses(account);
    for (const addr of addresses) {
        const pub = ensurePublicKey(addr.pubXHex, addr.pubYHex);
        if (!pub) continue;
        addressMsg[addr.address] = {
            AddressData: {
                PublicKeyNew: pub,
            },
        };
    }
    return addressMsg;
}

export async function joinGuarantorGroup(
    account: UserAccount,
    org: OrganizationChoice
): Promise<{ success: boolean; error?: string; org?: OrganizationChoice }> {
    const session = getSessionKey();
    if (!session || session.accountId !== account.accountId) {
        return { success: false, error: '请先解锁账户私钥' };
    }

    const addressMsg = buildAddressMsg(account);
    if (Object.keys(addressMsg).length === 0) {
        return { success: false, error: '加入担保组织前需要至少一个钱包子地址' };
    }

    const precheck = await ensureAddressesBelongToTargetOrg(account, org.groupId);
    if (!precheck.ok) {
        return { success: false, error: precheck.error || '地址组织校验失败' };
    }

    const { x: pubXHex, y: pubYHex } = getPublicKeyHexFromPrivate(session.privKey);
    const userPublicKey = convertHexToPublicKey(pubXHex, pubYHex);

    const enriched = await enrichOrg(org);
    if (!enriched.assignAPIEndpoint && !enriched.assignNodeUrl) {
        return { success: false, error: '无法获取担保组织节点地址，请刷新组织列表后重试' };
    }

    const requestBody: FlowApplyRequest = {
        Status: 1,
        UserID: account.accountId,
        UserPeerID: '',
        GuarGroupID: enriched.groupId,
        UserPublicKey: userPublicKey,
        AddressMsg: addressMsg,
        TimeStamp: getCustomEpochTimestamp(),
    };

    requestBody.UserSig = signStruct(requestBody as unknown as Record<string, unknown>, session.privKey, ['UserSig']);

    try {
        const response = await apiClient.request<FlowApplyResponse & { error?: string; message?: string }>(
            buildFlowApplyUrl(enriched),
            {
                method: 'POST',
                body: serializeForBackend(requestBody),
                timeout: DEFAULT_TIMEOUT,
                retries: 0,
            }
        );
        const data = response.data;

        if (!data.result) {
            return {
                success: false,
                error: data.error || data.message || '加入担保组织失败',
            };
        }

        return { success: true, org: enriched };
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function leaveGuarantorGroup(
    account: UserAccount,
    org: OrganizationChoice
): Promise<{ success: boolean; error?: string }> {
    const session = getSessionKey();
    if (!session || session.accountId !== account.accountId) {
        return { success: false, error: '请先解锁账户私钥' };
    }

    const { x: pubXHex, y: pubYHex } = getPublicKeyHexFromPrivate(session.privKey);
    const userPublicKey = convertHexToPublicKey(pubXHex, pubYHex);

    const enriched = await enrichOrg(org);

    const requestBody: FlowApplyRequest = {
        Status: 0,
        UserID: account.accountId,
        UserPeerID: '',
        GuarGroupID: org.groupId,
        UserPublicKey: userPublicKey,
        AddressMsg: {},
        TimeStamp: getCustomEpochTimestamp(),
    };

    requestBody.UserSig = signStruct(requestBody as unknown as Record<string, unknown>, session.privKey, ['UserSig']);

    try {
        const response = await apiClient.request<FlowApplyResponse & { error?: string; message?: string }>(
            buildFlowApplyUrl(enriched),
            {
                method: 'POST',
                body: serializeForBackend(requestBody),
                timeout: DEFAULT_TIMEOUT,
                retries: 0,
            }
        );
        const data = response.data;

        if (!data.result) {
            return {
                success: false,
                error: data.error || data.message || '退出担保组织失败',
            };
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}
