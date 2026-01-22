/**
 * API 客户端 (Chrome Extension 版)
 * 
 * 与后端 Gateway 通信
 */

// ========================================
// 配置
// ========================================

// 开发模式使用本地地址，生产模式使用远程地址
const DEV_MODE = true;
const API_HOST = DEV_MODE ? 'http://127.0.0.1' : 'http://47.243.174.71';
const BOOT_NODE_PORT = 3001;

// ========================================
// 类型定义
// ========================================

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

export interface GroupInfo {
    groupId: string;
    groupName: string;
    assignNodeUrl: string;
    aggrNodeUrl: string;
    pledgeAddress: string;
    memberCount: number;
}

export interface AddressQueryResult {
    address: string;
    balance: number;
    utxos: UTXO[];
    txCers: TxCer[];
    coinType: number;
}

export interface UTXO {
    txId: string;
    position: TxPosition;
    value: number;
    address: string;
}

export interface TxPosition {
    Blocknum: number;
    IndexX: number;
    IndexY: number;
    IndexZ: number;
}

export interface TxCer {
    txCerId: string;
    value: number;
    status: number; // 0=NoUse, 1=Using, 2=Used
    fromTxId: string;
}

// ========================================
// HTTP 请求函数
// ========================================

async function request<T>(
    url: string,
    options: RequestInit = {}
): Promise<ApiResponse<T>> {
    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });

        if (!response.ok) {
            return {
                success: false,
                error: `HTTP ${response.status}: ${response.statusText}`,
            };
        }

        const data = await response.json();
        return { success: true, data };
    } catch (error) {
        console.error('[API] 请求失败:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : '网络错误',
        };
    }
}

// ========================================
// BootNode API
// ========================================

export async function getBootNodeInfo(): Promise<ApiResponse<{ groups: GroupInfo[] }>> {
    return request(`${API_HOST}:${BOOT_NODE_PORT}/api/v1/boot/info`);
}

export async function getGroupList(): Promise<ApiResponse<GroupInfo[]>> {
    return request(`${API_HOST}:${BOOT_NODE_PORT}/api/v1/groups`);
}

// ========================================
// AssignNode API
// ========================================

export async function queryAddress(
    assignNodeUrl: string,
    address: string,
    coinType: number = 0
): Promise<ApiResponse<AddressQueryResult>> {
    const url = `${assignNodeUrl}/api/v1/query-address?address=${address}&coinType=${coinType}`;
    return request(url);
}

export async function submitTransaction(
    assignNodeUrl: string,
    transaction: unknown
): Promise<ApiResponse<{ txId: string; status: string }>> {
    return request(`${assignNodeUrl}/api/v1/submit-tx`, {
        method: 'POST',
        body: JSON.stringify(transaction),
    });
}

export async function registerAddress(
    assignNodeUrl: string,
    data: {
        userID: string;
        address: string;
        publicKey: { CurveName: string; X: string; Y: string };
        coinType: number;
    }
): Promise<ApiResponse<{ success: boolean }>> {
    return request(`${assignNodeUrl}/api/v1/register-address`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export async function pollAccountUpdate(
    assignNodeUrl: string,
    userId: string
): Promise<ApiResponse<unknown[]>> {
    return request(`${assignNodeUrl}/api/v1/account-update?userID=${userId}&limit=50`);
}

export async function pollTxCerChange(
    assignNodeUrl: string,
    userId: string
): Promise<ApiResponse<unknown[]>> {
    return request(`${assignNodeUrl}/api/v1/txcer-change?userID=${userId}&limit=50`);
}

// ========================================
// ComNode API (散户)
// ========================================

export async function queryAddressPublic(
    comNodeUrl: string,
    address: string
): Promise<ApiResponse<AddressQueryResult>> {
    return request(`${comNodeUrl}/api/v1/com/query-address?address=${address}`);
}

export async function submitNoGuarGroupTx(
    comNodeUrl: string,
    transaction: unknown
): Promise<ApiResponse<{ txId: string }>> {
    return request(`${comNodeUrl}/api/v1/com/submit-noguargroup-tx`, {
        method: 'POST',
        body: JSON.stringify(transaction),
    });
}

// ========================================
// 工具函数
// ========================================

export function buildApiUrl(baseUrl: string, path: string): string {
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const p = path.startsWith('/') ? path : '/' + path;
    return base + p;
}

export { API_HOST, BOOT_NODE_PORT, DEV_MODE };
