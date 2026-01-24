import type { AddressData, User } from './txUser';
import type { UserAccount } from './storage';
import { getSessionAddressKey, getSessionKey, saveAccount } from './storage';
import { buildAddressBalanceInfo, convertToStorageUTXO, queryAddressInfo } from './accountQuery';

function toHexFromDec(value: number | string): string {
    try {
        const bi = typeof value === 'string' ? BigInt(value) : BigInt(value);
        return bi.toString(16).padStart(64, '0');
    } catch {
        return '';
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

        const utxos: Record<string, ReturnType<typeof convertToStorageUTXO>> = {};
        const rawUtxos = info.utxos || {};
        for (const [key, utxo] of Object.entries(rawUtxos)) {
            utxos[key] = convertToStorageUTXO(key, utxo, normalized);
        }

        const pubXHex =
            existing.pubXHex ||
            toHexFromDec(data?.PublicKeyNew?.X || info.publicKey.x || '0');
        const pubYHex =
            existing.pubYHex ||
            toHexFromDec(data?.PublicKeyNew?.Y || info.publicKey.y || '0');

        account.addresses[normalized] = {
            ...existing,
            address: normalized,
            type: info.type || existing.type || 0,
            balance: info.balance || 0,
            utxoCount: info.utxoCount || 0,
            txCerCount: existing.txCerCount || 0,
            utxos,
            txCers: existing.txCers || {},
            value: {
                totalValue: info.totalAssets || 0,
                utxoValue: info.balance || 0,
                txCerValue: 0,
            },
            estInterest: info.interest || 0,
            publicKeyNew: data?.PublicKeyNew,
            pubXHex,
            pubYHex,
        };

    }

    const totals: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    for (const info of Object.values(account.addresses || {})) {
        totals[info.type || 0] = (totals[info.type || 0] || 0) + (info.balance || 0);
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
            totalTXCers: {},
            totalValue: account.totalBalance?.[0] || 0,
            valueDivision: account.totalBalance || { 0: 0, 1: 0, 2: 0 },
            updateTime: Date.now(),
            updateBlock: 0,
        },
    };
}
