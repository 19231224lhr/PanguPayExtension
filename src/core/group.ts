import { API_BASE_URL, API_ENDPOINTS, buildApiUrl, buildNodeUrl, getGroupInfo } from './api';
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

    return {
        ...org,
        groupName: org.groupName || data.group_name || org.groupId,
        assignNodeUrl: org.assignNodeUrl || (data.assign_api_endpoint ? buildNodeUrl(data.assign_api_endpoint) : ''),
        aggrNodeUrl: org.aggrNodeUrl || (data.aggr_api_endpoint ? buildNodeUrl(data.aggr_api_endpoint) : ''),
        pledgeAddress: org.pledgeAddress || data.pledge_address || '',
    };
}

function buildFlowApplyUrl(org: OrganizationChoice): string {
    const base = org.assignNodeUrl ? buildNodeUrl(org.assignNodeUrl) : API_BASE_URL;
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

    const { x: pubXHex, y: pubYHex } = getPublicKeyHexFromPrivate(session.privKey);
    const userPublicKey = convertHexToPublicKey(pubXHex, pubYHex);

    const enriched = await enrichOrg(org);

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

    const response = await fetch(buildFlowApplyUrl(enriched), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: serializeForBackend(requestBody),
    });

    const data = (await response.json()) as FlowApplyResponse & { error?: string; message?: string };
    if (!response.ok) {
        return {
            success: false,
            error: data.error || data.message || `HTTP ${response.status}`,
        };
    }

    if (!data.result) {
        return {
            success: false,
            error: data.error || data.message || '加入担保组织失败',
        };
    }

    return { success: true, org: enriched };
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

    const response = await fetch(buildFlowApplyUrl(org), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: serializeForBackend(requestBody),
    });

    const data = (await response.json()) as FlowApplyResponse & { error?: string; message?: string };
    if (!response.ok) {
        return {
            success: false,
            error: data.error || data.message || `HTTP ${response.status}`,
        };
    }

    if (!data.result) {
        return {
            success: false,
            error: data.error || data.message || '退出担保组织失败',
        };
    }

    return { success: true };
}
