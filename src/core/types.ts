/**
 * 类型定义
 */

// ========================================
// 交易相关类型
// ========================================

export interface EcdsaSignatureJSON {
    R: string | null;
    S: string | null;
}

export interface PublicKeyNewJSON {
    CurveName: string;
    X: string;
    Y: string;
}

export interface TxPosition {
    Blocknum: number;
    IndexX: number;
    IndexY: number;
    IndexZ: number;
}

export interface TXOutput {
    ToAddress: string;
    ToValue: number;
    ToGuarGroupID: string;
    ToPublicKey: PublicKeyNewJSON;
    ToInterest: number;
    Type: number;
    ToPeerID: string;
    IsPayForGas: boolean;
    IsCrossChain: boolean;
    IsGuarMake: boolean;
}

export interface TXInputNormal {
    FromTXID: string;
    FromTxPosition: TxPosition;
    FromAddress: string;
    IsGuarMake: boolean;
    IsCommitteeMake: boolean;
    IsCrossChain: boolean;
    InputSignature: EcdsaSignatureJSON;
    TXOutputHash: number[];
}

export interface InterestAssign {
    Gas: number;
    Output: number;
    BackAssign: Record<string, number>;
}

export interface Transaction {
    TXID: string;
    Size: number;
    Version: number;
    GuarantorGroup: string;
    TXType: number;
    Value: number;
    ValueDivision: Record<number, number>;
    NewValue: number;
    NewValueDiv: Record<number, number>;
    InterestAssign: InterestAssign;
    UserSignature: EcdsaSignatureJSON;
    TXInputsNormal: TXInputNormal[];
    TXInputsCertificate: unknown[];
    TXOutputs: TXOutput[];
    Data: number[] | string;
}

export interface UserNewTX {
    TX: Transaction;
    UserID: string;
    Height: number;
    Sig: EcdsaSignatureJSON;
}

// ========================================
// UTXO 和 TXCer 类型
// ========================================

export interface UTXOData {
    txId: string;
    position: TxPosition;
    value: number;
    address: string;
    coinType: number;
    locked?: boolean;
}

export interface TxCertificate {
    txCerId: string;
    value: number;
    status: TxCerStatus;
    fromTxId: string;
    coinType: number;
    timestamp: number;
}

export enum TxCerStatus {
    NoUse = 0,
    Using = 1,
    Used = 2,
    EXing = 3,
    EXed = 4,
}

// ========================================
// 组织类型
// ========================================

export interface GuarantorGroup {
    groupId: string;
    groupName: string;
    assignNodeUrl: string;
    aggrNodeUrl: string;
    pledgeAddress: string;
    memberCount: number;
    description?: string;
}

// ========================================
// 消息类型
// ========================================

export type MessageType =
    | 'PANGU_CONNECT'
    | 'PANGU_CONNECT_SIGN'
    | 'PANGU_DISCONNECT'
    | 'PANGU_GET_ACCOUNT'
    | 'PANGU_SEND_TRANSACTION'
    | 'PANGU_SIGN_MESSAGE'
    | 'PANGU_DAPP_GET_PENDING'
    | 'PANGU_DAPP_APPROVE'
    | 'PANGU_DAPP_REJECT'
    | 'PANGU_DAPP_SIGN_GET_PENDING'
    | 'PANGU_DAPP_SIGN_APPROVE'
    | 'PANGU_DAPP_SIGN_REJECT'
    | 'PANGU_DAPP_NOTIFY'
    | 'PANGU_CONNECTED'
    | 'PANGU_RESPONSE';

export interface PanguMessage {
    type: MessageType;
    payload?: unknown;
    requestId?: string;
    site?: {
        origin?: string;
        href?: string;
        title?: string;
        icon?: string;
    };
}

export interface PanguResponse {
    type: 'PANGU_RESPONSE';
    requestId: string;
    success: boolean;
    data?: unknown;
    error?: string;
}

// ========================================
// UI 状态类型
// ========================================

export type PageName =
    | 'unlock'
    | 'welcome'
    | 'setPassword'
    | 'create'
    | 'import'
    | 'walletManager'
    | 'walletCreate'
    | 'walletImport'
    | 'home'
    | 'send'
    | 'receive'
    | 'history'
    | 'organization'
    | 'settings'
    | 'dappSign'
    | 'dappConnect';

export interface UIState {
    currentPage: PageName;
    isLoading: boolean;
    error: string | null;
}

// ========================================
// 币种类型
// ========================================

export const COIN_TYPES = {
    PGC: 0,
    BTC: 1,
    ETH: 2,
} as const;

export type CoinType = typeof COIN_TYPES[keyof typeof COIN_TYPES];

export const COIN_NAMES: Record<CoinType, string> = {
    [COIN_TYPES.PGC]: 'PGC',
    [COIN_TYPES.BTC]: 'BTC',
    [COIN_TYPES.ETH]: 'ETH',
};

export const COIN_DECIMALS: Record<CoinType, number> = {
    [COIN_TYPES.PGC]: 2,
    [COIN_TYPES.BTC]: 8,
    [COIN_TYPES.ETH]: 18,
};
