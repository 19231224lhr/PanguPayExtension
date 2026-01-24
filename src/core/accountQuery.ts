/**
 * Account query helpers aligned with frontend logic.
 */

import type { UTXOData } from './blockchain';
import { API_ENDPOINTS, buildApiUrl, clearComNodeCache, getComNodeEndpoint } from './api';
import { parseBigIntJson } from './bigIntJson';

export interface QueryAddressRequest {
    address: string[];
}

export interface QueryTxPosition {
    Blocknum: number;
    IndexX: number;
    IndexY: number;
    IndexZ: number;
}

export interface QueryUTXOData {
    UTXO?: Record<string, unknown>;
    Value: number;
    Type: number;
    Time?: number;
    Position?: QueryTxPosition;
    IsTXCerUTXO?: boolean;
}

export interface PointAddressData {
    Value: number;
    Type: number;
    Interest: number;
    GroupID: string;
    PublicKeyNew: {
        CurveName: string;
        X: number | string;
        Y: number | string;
    };
    UTXO: Record<string, QueryUTXOData>;
    LastHeight: number;
}

export interface QueryAddressResponse {
    FromGroupID: string;
    AddressData: Record<string, PointAddressData>;
    Sig: {
        R: number | string;
        S: number | string;
    };
}

export interface AddressBalanceInfo {
    address: string;
    balance: number;
    interest: number;
    totalAssets: number;
    type: number;
    groupID: string;
    isInGroup: boolean;
    utxoCount: number;
    utxos: Record<string, QueryUTXOData>;
    publicKey: {
        curveName: string;
        x: string;
        y: string;
    };
    lastHeight: number;
    exists: boolean;
}

export type QueryResult<T> =
    | { success: true; data: T }
    | { success: false; error: string; isLeaderUnavailable?: boolean };

const DEFAULT_TIMEOUT = 10000;

function normalizeAddress(address: string): string {
    return address.replace(/^0x/i, '').toLowerCase();
}

function normalizeAddressData(address: string, data: PointAddressData): AddressBalanceInfo {
    const exists =
        data.Value > 0 ||
        data.Interest > 0 ||
        data.LastHeight > 0 ||
        Object.keys(data.UTXO || {}).length > 0;

    return {
        address,
        balance: data.Value || 0,
        interest: data.Interest || 0,
        totalAssets: (data.Value || 0) + (data.Interest || 0),
        type: data.Type || 0,
        groupID: data.GroupID || '',
        isInGroup: !!(data.GroupID && data.GroupID !== '' && data.GroupID !== '1'),
        utxoCount: Object.keys(data.UTXO || {}).length,
        utxos: data.UTXO || {},
        publicKey: {
            curveName: data.PublicKeyNew?.CurveName || 'P256',
            x: String(data.PublicKeyNew?.X || '0'),
            y: String(data.PublicKeyNew?.Y || '0'),
        },
        lastHeight: data.LastHeight || 0,
        exists,
    };
}

export function convertToStorageUTXO(
    utxoKey: string,
    queryUtxo: QueryUTXOData,
    address: string
): UTXOData {
    let txid: string;
    let indexZFromKey = 0;

    if (utxoKey.includes(' + ')) {
        const parts = utxoKey.split(' + ');
        txid = parts[0].trim();
        indexZFromKey = parseInt(parts[1]?.trim() || '0', 10);
    } else if (utxoKey.includes(':')) {
        const parts = utxoKey.split(':');
        txid = parts[0];
        indexZFromKey = parseInt(parts[1] || '0', 10);
    } else if (utxoKey.includes('_')) {
        const parts = utxoKey.split('_');
        txid = parts[0];
        indexZFromKey = parseInt(parts[1] || '0', 10);
    } else {
        txid = utxoKey;
        indexZFromKey = 0;
    }

    const position: QueryTxPosition = queryUtxo.Position
        ? {
              Blocknum: queryUtxo.Position.Blocknum || 0,
              IndexX: queryUtxo.Position.IndexX || 0,
              IndexY: queryUtxo.Position.IndexY || 0,
              IndexZ: queryUtxo.Position.IndexZ ?? indexZFromKey,
          }
        : { Blocknum: 0, IndexX: 0, IndexY: 0, IndexZ: indexZFromKey };

    if (queryUtxo.UTXO && typeof queryUtxo.UTXO === 'object') {
        const backendUTXO = queryUtxo.UTXO as Record<string, unknown>;
        return {
            UTXO: {
                TXID: txid,
                TXType: (backendUTXO.TXType as number) || 0,
                TXInputsNormal: (backendUTXO.TXInputsNormal as unknown[]) || [],
                TXInputsCertificate: (backendUTXO.TXInputsCertificate as unknown[]) || [],
                TXOutputs: (backendUTXO.TXOutputs as unknown[]) || [],
                InterestAssign: (backendUTXO.InterestAssign as Record<string, unknown>) || {
                    Gas: 0,
                    Output: 0,
                    BackAssign: {},
                },
                ExTXCerID: (backendUTXO.ExTXCerID as string[]) || [],
                Data: (backendUTXO.Data as number[]) || [],
            },
            TXID: txid,
            Value: queryUtxo.Value,
            Type: queryUtxo.Type,
            Time: queryUtxo.Time || Date.now(),
            Position: position,
            IsTXCerUTXO: queryUtxo.IsTXCerUTXO || false,
        };
    }

    return {
        UTXO: {
            TXID: txid,
            TXType: 0,
            TXInputsNormal: [],
            TXInputsCertificate: [],
            TXOutputs: [
                {
                    ToAddress: address,
                    ToValue: queryUtxo.Value,
                    ToGuarGroupID: '',
                    ToPublicKey: { Curve: 'P256' },
                    ToInterest: 0,
                    Type: queryUtxo.Type,
                    ToCoinType: queryUtxo.Type,
                    ToPeerID: '',
                    IsPayForGas: false,
                    IsCrossChain: false,
                    IsGuarMake: false,
                },
            ],
            InterestAssign: { Gas: 0, Output: 0, BackAssign: {} },
            ExTXCerID: [],
            Data: [],
        },
        TXID: txid,
        Value: queryUtxo.Value,
        Type: queryUtxo.Type,
        Time: queryUtxo.Time || Date.now(),
        Position: position,
        IsTXCerUTXO: queryUtxo.IsTXCerUTXO || false,
    };
}

async function fetchWithTimeout(url: string, options: RequestInit, timeout = DEFAULT_TIMEOUT): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

export async function queryAddressInfo(addresses: string[]): Promise<QueryResult<QueryAddressResponse>> {
    try {
        if (!addresses || addresses.length === 0) {
            return { success: false, error: '没有要查询的地址' };
        }

        const comNodeURL = await getComNodeEndpoint();
        if (!comNodeURL) {
            return { success: false, error: 'ComNode 端点不可用，请稍后重试' };
        }

        const normalizedAddresses = addresses.map(normalizeAddress);
        const endpoint = buildApiUrl(comNodeURL, API_ENDPOINTS.COM_QUERY_ADDRESS);

        const requestBody: QueryAddressRequest = {
            address: normalizedAddresses,
        };

        const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            if (response.status === 503) {
                clearComNodeCache();
                return { success: false, error: 'Leader 节点暂时不可用，请稍后重试', isLeaderUnavailable: true };
            }

            const errorData = await response.json().catch(() => ({}));
            return {
                success: false,
                error: (errorData as { error?: string }).error || '查询失败',
            };
        }

        const responseText = await response.text();
        const data = parseBigIntJson(responseText) as QueryAddressResponse;
        return { success: true, data };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : '网络错误',
        };
    }
}

export async function queryAddressBalances(addresses: string[]): Promise<QueryResult<AddressBalanceInfo[]>> {
    const result = await queryAddressInfo(addresses);

    if (!result.success) {
        return result;
    }

    const balances: AddressBalanceInfo[] = [];
    const addressData = result.data.AddressData || {};

    for (const [address, data] of Object.entries(addressData)) {
        balances.push(normalizeAddressData(address, data));
    }

    return { success: true, data: balances };
}

export function buildAddressBalanceInfo(
    address: string,
    data?: PointAddressData
): AddressBalanceInfo {
    if (!data) {
        const normalizedAddr = normalizeAddress(address);
        return {
            address: normalizedAddr,
            balance: 0,
            interest: 0,
            totalAssets: 0,
            type: 0,
            groupID: '',
            isInGroup: false,
            utxoCount: 0,
            utxos: {},
            publicKey: { curveName: 'P256', x: '0', y: '0' },
            lastHeight: 0,
            exists: false,
        };
    }

    return normalizeAddressData(address, data);
}
