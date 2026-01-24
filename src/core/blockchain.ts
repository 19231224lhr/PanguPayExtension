/**
 * Blockchain types aligned with backend Go structures.
 */

export interface EcdsaSignature {
    R: string;
    S: string;
}

export interface PublicKeyNew {
    X?: string;
    Y?: string;
    XHex?: string;
    YHex?: string;
    Curve: string;
}

export interface TxPosition {
    Blocknum: number;
    IndexX: number;
    IndexY: number;
    IndexZ: number;
}

export interface NullableEcdsaSignature {
    R: string | null;
    S: string | null;
}

export interface TXInputNormal {
    FromTXID: string;
    FromTxPosition: TxPosition;
    FromAddress: string;
    IsGuarMake: boolean;
    IsCommitteeMake: boolean;
    IsCrossChain: boolean;
    InputSignature: EcdsaSignature | NullableEcdsaSignature;
    TXOutputHash: number[] | string;
}

export interface TXCerPosition {
    BlockHeight: number;
    Index: number;
    InIndex: number;
}

export interface TxCertificate {
    TXCerID: string;
    ToAddress: string;
    Value: number;
    ToInterest: number;
    FromGuarGroupID: string;
    ToGuarGroupID: string;
    ConstructionTime: number;
    Size?: number;
    TXID: string;
    TxCerPosition: TXCerPosition;
    GuarGroupSignature: EcdsaSignature;
    UserSignature: EcdsaSignature;
}

export interface TXOutput {
    ToAddress: string;
    ToValue: number;
    ToGuarGroupID: string;
    ToPublicKey: PublicKeyNew;
    ToInterest: number;
    Type?: number;
    ToCoinType?: number;
    ToPeerID?: string;
    IsPayForGas?: boolean;
    IsCrossChain: boolean;
    IsGuarMake: boolean;
    Hash?: string;
}

export interface InterestAssign {
    Gas: number;
    Output: number;
    BackAssign: Record<string, number>;
}

export interface SubATX {
    TXID: string;
    TXType: number;
    TXInputsNormal: TXInputNormal[];
    TXInputsCertificate: TxCertificate[];
    TXOutputs: TXOutput[];
    InterestAssign: InterestAssign;
    ExTXCerID: string[];
    Data: number[];
}

export interface AggregateGTX {
    AggrTXType: number;
    IsGuarCommittee: boolean;
    IsNoGuarGroupTX: boolean;
    GuarantorGroupID: string;
    GuarantorGroupSig: EcdsaSignature | NullableEcdsaSignature;
    TXNum: number;
    TotalGas: number;
    TXHash: string;
    TXSize: number;
    Version: number;
    AllTransactions: SubATX[];
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
    UserSignature: EcdsaSignature;
    TXInputsNormal: TXInputNormal[];
    TXInputsCertificate: TxCertificate[];
    TXOutputs: TXOutput[];
    Data: number[];
}

export interface UTXOData {
    UTXO: SubATX;
    Value: number;
    Type: number;
    Time: number;
    Position: TxPosition;
    IsTXCerUTXO: boolean;
    TXID?: string;
    TXOutputHash?: string;
}

export interface BillMsg {
    MoneyType: number;
    Value: number;
    GuarGroupID: string;
    PublicKey: PublicKeyNew;
    ToInterest: number;
}

export interface BuildTXInfo {
    Value: number;
    ValueDivision: Record<number, number>;
    Bill: Record<string, BillMsg>;
    UserAddress: string[];
    PriUseTXCer: boolean;
    ChangeAddress: Record<number, string>;
    IsPledgeTX: boolean;
    HowMuchPayForGas: number;
    IsCrossChainTX: boolean;
    Data: number[];
    InterestAssign: InterestAssign;
}

export interface UserNewTX {
    TX: Transaction;
    UserID: string;
    Height: number;
    Sig: EcdsaSignature;
}

export interface AggregateGTXForSubmit {
    TXHash: string;
    AllTransactions: SubATX[];
}
