/**
 * API 客户端 (Chrome Extension 版)
 *
 * 与前端项目的接口定义保持一致
 */

// ========================================
// 环境配置
// ========================================

function getRuntimeDevFlag(): boolean {
    if (typeof window === 'undefined') return false;
    const runtime = (window as any).__PANGU_DEV__;
    if (typeof runtime === 'boolean') return runtime;
    if (typeof runtime === 'string') return runtime.toLowerCase() === 'true';
    return false;
}

const DEV_MODE = getRuntimeDevFlag();
const DEFAULT_DEV_BASE_URL = 'http://localhost:3001';
const DEFAULT_PROD_BASE_URL = 'http://47.243.174.71:3001';

function getApiBaseUrl(): string {
    if (typeof window !== 'undefined') {
        const override = (window as any).__API_BASE_URL__ || (window as any).__PANGU_API_BASE_URL__;
        if (typeof override === 'string' && override.trim()) {
            return override.trim().replace(/\/$/, '');
        }
    }

    if (DEV_MODE) {
        return DEFAULT_DEV_BASE_URL;
    }

    if (typeof window !== 'undefined' && window.location && !window.location.protocol.includes('chrome-extension')) {
        const { protocol, hostname } = window.location;
        return `${protocol}//${hostname}:3001`;
    }

    return DEFAULT_PROD_BASE_URL;
}

export const API_BASE_URL = getApiBaseUrl();

export const DEFAULT_TIMEOUT = 10000;
export const DEFAULT_RETRY_COUNT = 2;
export const RETRY_DELAY = 1000;

// ========================================
// Endpoint 定义（对齐 TransferAreaInterface）
// ========================================

export const API_ENDPOINTS = {
    HEALTH: '/health',
    GROUPS_LIST: '/api/v1/groups',
    GROUP_INFO: (groupId: string) => `/api/v1/groups/${groupId}`,
    COMMITTEE_ENDPOINT: '/api/v1/committee/endpoint',
    ORG_PUBLIC_KEY: '/api/v1/org/publickey',

    ASSIGN_HEALTH: (groupId: string) => `/api/v1/${groupId}/assign/health`,
    ASSIGN_NEW_ADDRESS: (groupId: string) => `/api/v1/${groupId}/assign/new-address`,
    ASSIGN_UNBIND_ADDRESS: (groupId: string) => `/api/v1/${groupId}/assign/unbind-address`,
    ASSIGN_CAPSULE_GENERATE: (groupId: string) => `/api/v1/${groupId}/assign/capsule/generate`,
    ASSIGN_FLOW_APPLY: (groupId: string) => `/api/v1/${groupId}/assign/flow-apply`,
    ASSIGN_SUBMIT_TX: (groupId: string) => `/api/v1/${groupId}/assign/submit-tx`,
    ASSIGN_TX_STATUS: (groupId: string, txId: string) => `/api/v1/${groupId}/assign/tx-status/${txId}`,
    ASSIGN_RE_ONLINE: (groupId: string) => `/api/v1/${groupId}/assign/re-online`,
    ASSIGN_GROUP_INFO: (groupId: string) => `/api/v1/${groupId}/assign/group-info`,
    ASSIGN_ACCOUNT_UPDATE: (groupId: string) => `/api/v1/${groupId}/assign/account-update`,
    ASSIGN_TXCER_CHANGE: (groupId: string) => `/api/v1/${groupId}/assign/txcer-change`,
    ASSIGN_CROSS_ORG_TXCER: (groupId: string) => `/api/v1/${groupId}/assign/poll-cross-org-txcers`,

    AGGR_TXCER: (groupId: string) => `/api/v1/${groupId}/aggr/txcer`,

    COM_HEALTH: '/api/v1/com/health',
    COM_QUERY_ADDRESS: '/api/v1/com/query-address',
    COM_QUERY_ADDRESS_GROUP: '/api/v1/com/query-address-group',
    COM_REGISTER_ADDRESS: '/api/v1/com/register-address',
    COM_CAPSULE_GENERATE: '/api/v1/com/capsule/generate',
    COM_PUBLIC_KEY: '/api/v1/com/public-key',
    COM_SUBMIT_NOGUARGROUP_TX: '/api/v1/com/submit-noguargroup-tx',
    COM_UTXO_CHANGE: (committeeId: string) => `/api/v1/${committeeId}/com/utxo-change`,
} as const;

// ========================================
// 类型定义
// ========================================

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

export interface GroupListItem {
    group_id: string;
    assign_api_endpoint: string;
    aggr_api_endpoint: string;
    assi_peer_id?: string;
    aggr_peer_id?: string;
    group_name?: string;
    pledge_address?: string;
    member_count?: number;
}

export interface GroupListResponse {
    success: boolean;
    groups: GroupListItem[];
    count: number;
    boot_node: boolean;
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
// 基础工具
// ========================================

function getBaseHostAndProtocol(): { host: string; protocol: string } {
    try {
        const base = new URL(API_BASE_URL);
        return {
            host: base.hostname || 'localhost',
            protocol: base.protocol || 'http:',
        };
    } catch {
        return { host: 'localhost', protocol: 'http:' };
    }
}

function isLocalHost(host: string): boolean {
    const h = host.trim().toLowerCase();
    return h === 'localhost' || h === '127.0.0.1';
}

export function buildApiUrl(baseUrl: string, path: string): string {
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const p = path.startsWith('/') ? path : '/' + path;
    return base + p;
}

export function buildNodeUrl(endpoint: string): string {
    const raw = String(endpoint || '').trim();
    if (!raw) return '';

    const { protocol, host } = getBaseHostAndProtocol();

    if (raw.startsWith(':')) {
        return `${protocol}//${host}${raw}`;
    }

    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
        const colonIndex = raw.lastIndexOf(':');
        if (colonIndex > 0) {
            const hostPart = raw.substring(0, colonIndex);
            const portPart = raw.substring(colonIndex + 1);
            const resolvedHost = isLocalHost(hostPart) ? host : hostPart;
            return `${protocol}//${resolvedHost}:${portPart}`;
        }
        const resolvedHost = isLocalHost(raw) ? host : raw;
        return `${protocol}//${resolvedHost}`;
    }

    try {
        const url = new URL(raw);
        const resolvedHost = isLocalHost(url.hostname) ? host : url.hostname;
        const portPart = url.port ? `:${url.port}` : '';
        return `${url.protocol}//${resolvedHost}${portPart}${url.pathname}`;
    } catch {
        return raw;
    }
}

function normalizeAddress(address: string): string {
    return String(address || '').trim().replace(/^0x/i, '').toLowerCase();
}

// ========================================
// HTTP 请求函数
// ========================================

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, options: RequestInit, timeout: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function request<T>(
    url: string,
    options: RequestInit = {},
    config: { timeout?: number; retries?: number } = {}
): Promise<ApiResponse<T>> {
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;
    const retries = config.retries ?? DEFAULT_RETRY_COUNT;
    let lastError = '';

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const response = await fetchWithTimeout(
                url,
                {
                    ...options,
                    headers: {
                        'Content-Type': 'application/json',
                        ...options.headers,
                    },
                },
                timeout
            );

            if (!response.ok) {
                return {
                    success: false,
                    error: `HTTP ${response.status}: ${response.statusText}`,
                };
            }

            try {
                const data = await response.json();
                return { success: true, data };
            } catch (error) {
                lastError = error instanceof Error ? error.message : '响应解析失败';
                return { success: false, error: lastError };
            }
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                lastError = `请求超时 (${timeout}ms)`;
            } else {
                lastError = error instanceof Error ? error.message : '网络错误';
            }

            if (attempt < retries) {
                await sleep(RETRY_DELAY * (attempt + 1));
                continue;
            }
        }
    }

    console.error('[API] 请求失败:', lastError);
    return { success: false, error: lastError || '网络错误' };
}

// ========================================
// BootNode API
// ========================================

export async function getBootNodeInfo(): Promise<ApiResponse<{ groups: GroupListItem[] }>> {
    return request(buildApiUrl(API_BASE_URL, '/api/v1/boot/info'));
}

export async function getGroupList(): Promise<ApiResponse<GroupListResponse>> {
    return request(buildApiUrl(API_BASE_URL, API_ENDPOINTS.GROUPS_LIST));
}

export async function getGroupInfo(groupId: string): Promise<ApiResponse<unknown>> {
    return request(buildApiUrl(API_BASE_URL, API_ENDPOINTS.GROUP_INFO(groupId)));
}

// ========================================
// ComNode Endpoint
// ========================================

let cachedComNodeUrl: string | null = null;

export async function getComNodeEndpoint(forceRefresh: boolean = false): Promise<string> {
    if (!forceRefresh && cachedComNodeUrl) {
        return cachedComNodeUrl;
    }

    const endpointUrl = buildApiUrl(API_BASE_URL, API_ENDPOINTS.COMMITTEE_ENDPOINT);
    const result = await request<{ endpoint?: string; Endpoint?: string; data?: { endpoint?: string } }>(endpointUrl, {
        method: 'GET',
    });
    if (!result.success || !result.data) {
        throw new Error(result.error || 'ComNode 获取失败');
    }

    const data = result.data;
    const endpoint = data.endpoint || data.Endpoint || data.data?.endpoint || '';
    if (!endpoint) {
        throw new Error('ComNode 端点为空');
    }

    cachedComNodeUrl = buildNodeUrl(endpoint);
    return cachedComNodeUrl;
}

// ========================================
// AssignNode API
// ========================================

export async function submitTransaction(
    groupId: string,
    transaction: unknown,
    assignNodeUrl?: string
): Promise<ApiResponse<{ txId: string; status: string }>> {
    const base = assignNodeUrl || API_BASE_URL;
    return request(buildApiUrl(base, API_ENDPOINTS.ASSIGN_SUBMIT_TX(groupId)), {
        method: 'POST',
        body: JSON.stringify(transaction),
    });
}

export async function pollAccountUpdate(
    groupId: string,
    userId: string,
    assignNodeUrl?: string
): Promise<ApiResponse<unknown[]>> {
    const base = assignNodeUrl || API_BASE_URL;
    const url = buildApiUrl(base, `${API_ENDPOINTS.ASSIGN_ACCOUNT_UPDATE(groupId)}?userID=${userId}&limit=50`);
    return request(url);
}

export async function pollTxCerChange(
    groupId: string,
    userId: string,
    assignNodeUrl?: string
): Promise<ApiResponse<unknown[]>> {
    const base = assignNodeUrl || API_BASE_URL;
    const url = buildApiUrl(base, `${API_ENDPOINTS.ASSIGN_TXCER_CHANGE(groupId)}?userID=${userId}&limit=50`);
    return request(url);
}

// ========================================
// ComNode API (散户)
// ========================================

export async function queryAddressPublic(
    comNodeUrl: string | null,
    address: string
): Promise<ApiResponse<AddressQueryResult>> {
    const base = comNodeUrl || (await getComNodeEndpoint());
    const body = { address: [normalizeAddress(address)] };
    return request(buildApiUrl(base, API_ENDPOINTS.COM_QUERY_ADDRESS), {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export async function queryAddressGroup(
    comNodeUrl: string | null,
    address: string
): Promise<ApiResponse<unknown>> {
    const base = comNodeUrl || (await getComNodeEndpoint());
    const body = { address: [normalizeAddress(address)] };
    return request(buildApiUrl(base, API_ENDPOINTS.COM_QUERY_ADDRESS_GROUP), {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export async function registerAddress(
    comNodeUrl: string | null,
    data: {
        userID: string;
        address: string;
        publicKey: { CurveName: string; X: string; Y: string };
        coinType: number;
    }
): Promise<ApiResponse<{ success: boolean }>> {
    const base = comNodeUrl || (await getComNodeEndpoint());
    return request(buildApiUrl(base, API_ENDPOINTS.COM_REGISTER_ADDRESS), {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export async function submitNoGuarGroupTx(
    comNodeUrl: string | null,
    transaction: unknown
): Promise<ApiResponse<{ txId: string }>> {
    const base = comNodeUrl || (await getComNodeEndpoint());
    return request(buildApiUrl(base, API_ENDPOINTS.COM_SUBMIT_NOGUARGROUP_TX), {
        method: 'POST',
        body: JSON.stringify(transaction),
    });
}

export const API_HOST = (() => {
    try {
        const url = new URL(API_BASE_URL);
        return `${url.protocol}//${url.hostname}`;
    } catch {
        return 'http://localhost';
    }
})();

export const BOOT_NODE_PORT = (() => {
    try {
        const url = new URL(API_BASE_URL);
        return url.port ? Number(url.port) : 3001;
    } catch {
        return 3001;
    }
})();

export { DEV_MODE };
