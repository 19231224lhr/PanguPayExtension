import { API_BASE_URL, DEFAULT_TIMEOUT, apiClient, buildAggrNodeUrl, buildAssignNodeUrl } from './api';
import { convertToStorageUTXO } from './accountQuery';
import {
    clearOrganization,
    getSessionAddressKey,
    saveAccount,
    saveOrganization,
    type OrganizationChoice,
    type UserAccount,
} from './storage';
import {
    bigIntToHex,
    convertHexToPublicKey,
    getPublicKeyHexFromPrivate,
    serializeForBackend,
    signStruct,
    type PublicKeyNew,
} from './signature';

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

function normalizePubHex(value?: string): string {
    const cleaned = String(value || '').trim().replace(/^0x/i, '').toLowerCase();
    if (!cleaned) return '';
    return cleaned.padStart(64, '0');
}

function isMissingPubHex(value?: string): boolean {
    const normalized = normalizePubHex(value);
    return !normalized || /^0+$/.test(normalized);
}

function derivePubFromPriv(privKey?: string): { x: string; y: string } | null {
    if (!privKey) return null;
    try {
        return getPublicKeyHexFromPrivate(privKey);
    } catch {
        return null;
    }
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
    const assignAPIEndpoint = boot?.AssignAPIEndpoint || '';
    const aggrAPIEndpoint = boot?.AggrAPIEndpoint || '';
    const assignNodeUrl = assignAPIEndpoint ? buildAssignNodeUrl(assignAPIEndpoint) : '';
    const aggrNodeUrl = aggrAPIEndpoint ? buildAggrNodeUrl(aggrAPIEndpoint) : '';
    return {
        groupId,
        groupName: boot?.GuarGroupName || groupId,
        assignNodeUrl,
        aggrNodeUrl,
        assignAPIEndpoint,
        aggrAPIEndpoint,
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

    const response = await apiClient.request<ReturnUserReOnlineMsg>(`${API_BASE_URL}/api/v1/re-online`, {
        method: 'POST',
        body: serializeForBackend(message),
        timeout: DEFAULT_TIMEOUT,
        retries: 0,
        useBigIntParsing: true,
    });

    const gatewayNotice = response.headers.get('X-Gateway-Notice') || '';
    const result = response.data;
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
        let pubXHex = normalizePubHex(existing.pubXHex) || (normalizedPub ? bigIntToHex(normalizedPub.X) : undefined);
        let pubYHex = normalizePubHex(existing.pubYHex) || (normalizedPub ? bigIntToHex(normalizedPub.Y) : undefined);

        const isMain = account.mainAddress ? account.mainAddress.toLowerCase() === normalized : false;
        const sessionPriv = isMain ? privateKeyHex : getSessionAddressKey(normalized);
        if (isMissingPubHex(pubXHex) || isMissingPubHex(pubYHex)) {
            const derived = derivePubFromPriv(sessionPriv);
            if (derived) {
                if (isMissingPubHex(pubXHex)) pubXHex = derived.x;
                if (isMissingPubHex(pubYHex)) pubYHex = derived.y;
            }
        }

        const resolvedPublicKey =
            normalizedPub ||
            (!isMissingPubHex(pubXHex) && !isMissingPubHex(pubYHex)
                ? convertHexToPublicKey(pubXHex, pubYHex)
                : existing.publicKeyNew);

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
            EstInterest: Number(payload.EstInterest ?? payload.Interest ?? existing.EstInterest ?? 0) || 0,
            gas: Number(payload.EstInterest ?? payload.Interest ?? (existing as any).gas ?? 0) || 0,
            publicKeyNew: resolvedPublicKey,
            pubXHex: pubXHex || existing.pubXHex,
            pubYHex: pubYHex || existing.pubYHex,
        };
    }

    const totals: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    const mainAddress = updated.mainAddress?.toLowerCase() || '';
    for (const [addr, info] of Object.entries(updated.addresses || {})) {
        if (mainAddress && addr.toLowerCase() === mainAddress) continue;
        const rawTotal = Number(info.value?.totalValue);
        const utxoValue = Number(info.value?.utxoValue ?? info.balance ?? 0) || 0;
        const txCerValue =
            Number(info.value?.txCerValue) ||
            Object.values(info.txCers || {}).reduce((sum, value) => sum + Number(value || 0), 0);
        const totalValue = Number.isFinite(rawTotal) ? rawTotal : utxoValue + txCerValue;
        totals[info.type || 0] = (totals[info.type || 0] || 0) + totalValue;
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
