import type { AddressData, User } from './txUser';
import type { UserAccount } from './storage';
import { getSessionAddressKey, getSessionKey, saveAccount } from './storage';
import { buildAddressBalanceInfo, convertToStorageUTXO, queryAddressInfo } from './accountQuery';
import { convertHexToPublicKey, getPublicKeyHexFromPrivate } from './signature';

function toHexFromDec(value: number | string): string {
    try {
        const bi = typeof value === 'string' ? BigInt(value) : BigInt(value);
        return bi.toString(16).padStart(64, '0');
    } catch {
        return '';
    }
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

export async function syncAccountAddresses(
    account: UserAccount,
    addresses: string[]
): Promise<UserAccount> {
    const result = await queryAddressInfo(addresses);
    if (!result.success) {
        throw new Error(result.error);
    }

    const addressData = result.data.AddressData || {};

    for (const addr of addresses) {
        const normalized = addr.replace(/^0x/i, '').toLowerCase();
        const data = addressData[normalized];
        const info = buildAddressBalanceInfo(normalized, data);

        const existing = account.addresses[normalized] || {
            address: normalized,
            type: info.type || 0,
            balance: 0,
            utxoCount: 0,
            txCerCount: 0,
        };
        const existingTxCerValue = Object.values(existing.txCers || {}).reduce(
            (sum, value) => sum + (Number(value) || 0),
            0
        );

        const utxos: Record<string, ReturnType<typeof convertToStorageUTXO>> = {};
        const rawUtxos = info.utxos || {};
        for (const [key, utxo] of Object.entries(rawUtxos)) {
            utxos[key] = convertToStorageUTXO(key, utxo, normalized);
        }

        let pubXHex =
            normalizePubHex(existing.pubXHex) ||
            toHexFromDec(data?.PublicKeyNew?.X || info.publicKey.x || '0');
        let pubYHex =
            normalizePubHex(existing.pubYHex) ||
            toHexFromDec(data?.PublicKeyNew?.Y || info.publicKey.y || '0');

        const isMain = account.mainAddress
            ? account.mainAddress.toLowerCase() === normalized
            : false;
        const sessionPriv = isMain ? getSessionKey()?.privKey : getSessionAddressKey(normalized);
        if (isMissingPubHex(pubXHex) || isMissingPubHex(pubYHex)) {
            const derived = derivePubFromPriv(sessionPriv);
            if (derived) {
                if (isMissingPubHex(pubXHex)) pubXHex = derived.x;
                if (isMissingPubHex(pubYHex)) pubYHex = derived.y;
            }
        }

        const resolvedPublicKey =
            data?.PublicKeyNew ||
            (!isMissingPubHex(pubXHex) && !isMissingPubHex(pubYHex)
                ? convertHexToPublicKey(pubXHex, pubYHex)
                : existing.publicKeyNew);

        account.addresses[normalized] = {
            ...existing,
            address: normalized,
            type: info.type || existing.type || 0,
            balance: info.balance || 0,
            utxoCount: info.utxoCount || 0,
            txCerCount: Object.keys(existing.txCers || {}).length,
            utxos,
            txCers: existing.txCers || {},
            value: {
                totalValue: (info.balance || 0) + existingTxCerValue,
                utxoValue: info.balance || 0,
                txCerValue: existingTxCerValue,
            },
            estInterest: info.interest || 0,
            EstInterest: info.interest || 0,
            gas: info.interest || 0,
            publicKeyNew: resolvedPublicKey,
            pubXHex,
            pubYHex,
        };

    }

    const totals: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    const mainAddress = account.mainAddress?.toLowerCase() || '';
    for (const [addr, info] of Object.entries(account.addresses || {})) {
        if (mainAddress && addr.toLowerCase() === mainAddress) continue;
        const rawTotal = Number(info.value?.totalValue);
        const utxoValue = Number(info.value?.utxoValue ?? info.balance ?? 0) || 0;
        const txCerValue =
            Number(info.value?.txCerValue) ||
            Object.values(info.txCers || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
        const totalValue = Number.isFinite(rawTotal) ? rawTotal : utxoValue + txCerValue;
        totals[info.type || 0] = (totals[info.type || 0] || 0) + totalValue;
    }
    account.totalBalance = totals;
    account.lastLogin = Date.now();

    await saveAccount(account);
    return account;
}

export function buildTxUserFromAccount(account: UserAccount): User {
    const session = getSessionKey();
    const accountPriv = session && session.accountId === account.accountId ? session.privKey : '';

    const addressMsg: Record<string, AddressData> = {};
    for (const [addr, info] of Object.entries(account.addresses || {})) {
        if (addr === account.mainAddress) continue;
        const addrPriv = getSessionAddressKey(addr) || info.privHex || '';
        addressMsg[addr] = {
            type: info.type || 0,
            utxos: info.utxos || {},
            txCers: info.txCers || {},
            value: info.value || { totalValue: info.balance || 0, utxoValue: info.balance || 0, txCerValue: 0 },
            estInterest: info.estInterest || 0,
            privHex: addrPriv || undefined,
            pubXHex: info.pubXHex,
            pubYHex: info.pubYHex,
            locked: info.locked,
            publicKeyNew: info.publicKeyNew,
        };
    }

    return {
        accountId: account.accountId,
        address: account.mainAddress,
        orgNumber: account.organizationId || '',
        keys: {
            privHex: accountPriv,
            pubXHex: '',
            pubYHex: '',
        },
        wallet: {
            addressMsg,
            totalTXCers: account.txCerStore || {},
            totalValue: account.totalBalance?.[0] || 0,
            valueDivision: account.totalBalance || { 0: 0, 1: 0, 2: 0 },
            updateTime: Date.now(),
            updateBlock: 0,
        },
    };
}
