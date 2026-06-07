import type { PublicKeyEnvelope, TxCertificate, TXCerStatusView, UTXOData } from './blockchain';

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
        CurveName?: string;
        Curve?: string;
        X: bigint | number | string;
        Y: bigint | number | string;
    };
    addressRootSeedHex?: string;
    signPublicKeyV2?: PublicKeyEnvelope | null;
    seedAnchor?: number[] | string;
    seedChainStep?: number;
    defaultSpendAlgorithm?: string;
    registrationState?: 'unknown' | 'pending' | 'registered' | 'failed';
    seedRepairRequired?: boolean;
    readOnly?: boolean;
    seedLocalState?: {
        mode: 'deterministic_p256';
        chainLength: number;
        step: number;
        generation?: number;
        source: string;
        available: boolean;
        requiresUnlock?: boolean;
    } | null;
    pendingSeedStep?: number;
    pendingNextSeedStep?: number;
    pendingSeedTxId?: string;
    pendingSeedAt?: number;
}

export interface Wallet {
    addressMsg: Record<string, AddressData>;
    totalTXCers: Record<string, TxCertificate>;
    txCerStatuses?: Record<string, TXCerStatusView>;
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
