import type { UTXOData, TxCertificate } from './blockchain';

export interface WalletKeys {
    privHex: string;
    pubXHex: string;
    pubYHex: string;
}

export interface AddressValue {
    totalValue: number;
    utxoValue: number;
    txCerValue: number;
}

export interface AddressData {
    type: number;
    utxos: Record<string, UTXOData>;
    txCers: Record<string, number>;
    value: AddressValue;
    estInterest: number;
    gas?: number;
    origin?: string;
    privHex?: string;
    pubXHex?: string;
    pubYHex?: string;
    locked?: boolean;
    publicKeyNew?: {
        CurveName: string;
        X: number | string;
        Y: number | string;
    };
}

export interface Wallet {
    addressMsg: Record<string, AddressData>;
    totalTXCers: Record<string, TxCertificate>;
    totalValue: number;
    valueDivision: Record<number, number>;
    updateTime: number;
    updateBlock: number;
}

export interface GuarantorGroup {
    groupID: string;
    aggreNode?: string;
    assignNode?: string;
    pledgeAddress?: string;
    assignAPIEndpoint?: string;
    aggrAPIEndpoint?: string;
}

export interface User {
    accountId: string;
    address: string;
    orgNumber: string;
    flowOrigin?: string;
    keys: WalletKeys;
    wallet: Wallet;
    privHex?: string;
    pubXHex?: string;
    pubYHex?: string;
    guarGroup?: GuarantorGroup;
}
