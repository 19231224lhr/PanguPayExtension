import { API_BASE_URL, buildNodeUrl } from './api';
import { parseBigIntJson } from './bigIntJson';
import { convertToStorageUTXO } from './accountQuery';
import {
    clearOrganization,
    saveAccount,
    saveOrganization,
    type OrganizationChoice,
    type UserAccount,
} from './storage';
import { bigIntToHex, serializeForBackend, signStruct, type PublicKeyNew } from './signature';

export interface UserReOnlineMsg {
    UserID: string;
    FromPeerID: string;
    Address: string[];
    Sig: { R: bigint | null; S: bigint | null };
}

export interface GuarGroupTable {
    GroupID: string;
    GuarGroupName?: string;
    AssignAPIEndpoint?: string;
    AggrAPIEndpoint?: string;
    PledgeAddress?: string;
    GuarPublicKey?: PublicKeyNew;
    AggrPublicKey?: PublicKeyNew;
}

export interface UserWalletData {
    Value?: number;
    TXCers?: Record<string, unknown> | unknown[];
    UTXOs?: Record<string, unknown>;
    SubAddressMsg?: Record<string, unknown>;
}

export interface ReturnUserReOnlineMsg {
    UserID: string;
    IsInGroup: boolean;
    GuarantorGroupID: string;
    GuarGroupBootMsg: GuarGroupTable | null;
    UserWalletData: UserWalletData;
    GatewayNotice?: string;
}

interface AddressValuePayload {
    TotalValue?: number;
    UTXOValue?: number;
    TXCerValue?: number;
    totalValue?: number;
    utxoValue?: number;
    txCerValue?: number;
}

interface AddressBackendData {
    Type?: number;
    UTXO?: Record<string, unknown>;
    TXCers?: Record<string, unknown> | unknown[];
    Value?: AddressValuePayload | number;
    EstInterest?: number;
    Interest?: number;
    PublicKeyNew?: PublicKeyNew;
}

function normalizeAddress(address: string): string {
    return String(address || '').trim().replace(/^0x/i, '').toLowerCase();
}

function normalizePublicKey(pub?: PublicKeyNew | null): PublicKeyNew | null {
    if (!pub || pub.X === undefined || pub.Y === undefined) return null;
    return {
        CurveName: pub.CurveName || 'P256',
        X: typeof pub.X === 'bigint' ? pub.X.toString(10) : String(pub.X),
        Y: typeof pub.Y === 'bigint' ? pub.Y.toString(10) : String(pub.Y),
    };
}

function extractTxCers(
    raw: AddressBackendData['TXCers']
): { txCers: Record<string, number>; txCerStore: Record<string, unknown> } {
    const txCers: Record<string, number> = {};
    const txCerStore: Record<string, unknown> = {};

    if (!raw) return { txCers, txCerStore };

    if (Array.isArray(raw)) {
        for (const item of raw) {
            const txCer = item as { TXCerID?: string; Value?: number };
            if (!txCer?.TXCerID) continue;
            const value = Number(txCer.Value ?? 0) || 0;
            txCers[txCer.TXCerID] = value;
            txCerStore[txCer.TXCerID] = txCer;
        }
        return { txCers, txCerStore };
    }

    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'number') {
            txCers[key] = value;
            continue;
        }
        const txCer = value as { TXCerID?: string; Value?: number };
        if (!txCer?.TXCerID) {
            const numericValue = Number((value as { value?: number }).value ?? 0) || 0;
            txCers[key] = numericValue;
            continue;
        }
        const numericValue = Number(txCer.Value ?? 0) || 0;
        txCers[txCer.TXCerID] = numericValue;
        txCerStore[txCer.TXCerID] = txCer;
    }

    return { txCers, txCerStore };
}

function buildOrgChoice(result: ReturnUserReOnlineMsg): OrganizationChoice | null {
    if (!result.IsInGroup) return null;
    const groupId = String(result.GuarantorGroupID || '');
    if (!groupId) return null;
    const boot = result.GuarGroupBootMsg || null;
    const assignNodeUrl = boot?.AssignAPIEndpoint ? buildNodeUrl(boot.AssignAPIEndpoint) : '';
    const aggrNodeUrl = boot?.AggrAPIEndpoint ? buildNodeUrl(boot.AggrAPIEndpoint) : '';
    return {
        groupId,
        groupName: boot?.GuarGroupName || groupId,
        assignNodeUrl: assignNodeUrl,
        aggrNodeUrl: aggrNodeUrl,
        pledgeAddress: boot?.PledgeAddress || '',
    };
}

export async function userReOnline(
    userId: string,
    addresses: string[],
    privateKeyHex: string
): Promise<ReturnUserReOnlineMsg> {
    const message: UserReOnlineMsg = {
        UserID: userId,
        FromPeerID: '',
        Address: addresses,
        Sig: { R: null, S: null },
    };

    const signature = signStruct(message as unknown as Record<string, unknown>, privateKeyHex, ['Sig']);
    message.Sig = { R: signature.R, S: signature.S };

    const response = await fetch(`${API_BASE_URL}/api/v1/re-online`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serializeForBackend(message),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}`);
    }

    const gatewayNotice = response.headers.get('X-Gateway-Notice') || '';
    const result = parseBigIntJson<ReturnUserReOnlineMsg>(await response.text());
    if (gatewayNotice) result.GatewayNotice = gatewayNotice;
    return result;
}

export async function syncAccountFromReOnline(
    account: UserAccount,
    privateKeyHex: string
): Promise<{ account: UserAccount; org: OrganizationChoice | null; notice?: string }> {
    const addrList = Object.keys(account.addresses || {});
    if (addrList.length === 0 && account.mainAddress) {
        addrList.push(account.mainAddress);
    }

    const result = await userReOnline(account.accountId, addrList, privateKeyHex);
    const updated: UserAccount = {
        ...account,
        addresses: { ...account.addresses },
        txCerStore: { ...(account.txCerStore || {}) },
    };

    const walletData = result.UserWalletData?.SubAddressMsg || {};
    for (const [addr, data] of Object.entries(walletData)) {
        const normalized = normalizeAddress(addr);
        const existing = updated.addresses[normalized] || {
            address: normalized,
            type: 0,
            balance: 0,
            utxoCount: 0,
            txCerCount: 0,
            source: 'imported',
        };

        const payload = data as AddressBackendData;
        const utxoMap = (payload.UTXO || {}) as Record<string, unknown>;
        const utxos: Record<string, ReturnType<typeof convertToStorageUTXO>> = {};
        for (const [key, utxo] of Object.entries(utxoMap)) {
            utxos[key] = convertToStorageUTXO(key, utxo as any, normalized);
        }

        const { txCers, txCerStore } = extractTxCers(payload.TXCers);
        if (Object.keys(txCerStore).length > 0) {
            updated.txCerStore = { ...(updated.txCerStore || {}), ...txCerStore };
        }

        const valuePayload = payload.Value as AddressValuePayload | number | undefined;
        const totalValue =
            typeof valuePayload === 'number'
                ? valuePayload
                : Number(valuePayload?.TotalValue ?? valuePayload?.totalValue ?? 0) || 0;
        const rawUtxoValue =
            typeof valuePayload === 'number'
                ? valuePayload
                : Number(valuePayload?.UTXOValue ?? valuePayload?.utxoValue ?? 0) || 0;
        const computedUtxoValue = Object.values(utxos).reduce((sum, utxo) => sum + (utxo?.Value || 0), 0);
        const utxoValue = rawUtxoValue || computedUtxoValue;
        const txCerValue =
            typeof valuePayload === 'number'
                ? 0
                : Number(valuePayload?.TXCerValue ?? valuePayload?.txCerValue ?? 0) ||
                  Object.values(txCers).reduce((sum, val) => sum + Number(val || 0), 0);
        const normalizedPub = normalizePublicKey(payload.PublicKeyNew);
        const pubXHex = existing.pubXHex || (normalizedPub ? bigIntToHex(normalizedPub.X) : undefined);
        const pubYHex = existing.pubYHex || (normalizedPub ? bigIntToHex(normalizedPub.Y) : undefined);

        updated.addresses[normalized] = {
            ...existing,
            address: normalized,
            type: Number(payload.Type ?? existing.type ?? 0),
            balance: utxoValue,
            utxoCount: Object.keys(utxos).length,
            txCerCount: Object.keys(txCers).length,
            utxos,
            txCers,
            value: {
                totalValue: totalValue || utxoValue + txCerValue,
                utxoValue,
                txCerValue,
            },
            estInterest: Number(payload.EstInterest ?? payload.Interest ?? existing.estInterest ?? 0) || 0,
            publicKeyNew: normalizedPub || existing.publicKeyNew,
            pubXHex: pubXHex || existing.pubXHex,
            pubYHex: pubYHex || existing.pubYHex,
        };
    }

    const totals: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    for (const info of Object.values(updated.addresses || {})) {
        totals[info.type || 0] = (totals[info.type || 0] || 0) + (info.balance || 0);
    }
    updated.totalBalance = totals;
    updated.lastLogin = Date.now();

    await saveAccount(updated);

    const org = buildOrgChoice(result);
    if (org) {
        await saveOrganization(updated.accountId, org);
    } else {
        await clearOrganization(updated.accountId);
    }

    return { account: updated, org, notice: result.GatewayNotice };
}
