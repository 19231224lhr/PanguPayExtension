/**
 * API 客户端 (Chrome Extension 版)
 *
 * 与前端项目的接口定义保持一致
 */

import { parseBigIntJson } from './bigIntJson';

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
// API Client (移植自前端)
// ========================================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface ApiRequestOptions {
    method?: HttpMethod;
    body?: unknown;
    headers?: Record<string, string>;
    timeout?: number;
    retries?: number;
    signal?: AbortSignal;
    silent?: boolean;
    useBigIntParsing?: boolean;
}

export interface ApiClientResponse<T> {
    data: T;
    status: number;
    headers: Headers;
    ok: boolean;
}

export interface BackendErrorResponse {
    error?: string;
    message?: string;
    code?: string;
}

export class ApiRequestError extends Error {
    public readonly status?: number;
    public readonly code?: string;
    public readonly isTimeout: boolean;
    public readonly isNetworkError: boolean;
    public readonly isAborted: boolean;
    public readonly response?: Response;
    public cause?: Error;

    constructor(
        message: string,
        options: {
            status?: number;
            code?: string;
            isTimeout?: boolean;
            isNetworkError?: boolean;
            isAborted?: boolean;
            response?: Response;
            cause?: Error;
        } = {}
    ) {
        super(message);
        this.name = 'ApiRequestError';
        this.status = options.status;
        this.code = options.code;
        this.isTimeout = options.isTimeout ?? false;
        this.isNetworkError = options.isNetworkError ?? false;
        this.isAborted = options.isAborted ?? false;
        this.response = options.response;

        if (options.cause) {
            this.cause = options.cause;
        }

        const captureStackTrace = (Error as unknown as { captureStackTrace?: (target: unknown, ctor?: Function) => void })
            .captureStackTrace;
        if (typeof captureStackTrace === 'function') {
            captureStackTrace(this, ApiRequestError);
        }
    }

    static timeout(timeoutMs: number): ApiRequestError {
        return new ApiRequestError(`Request timed out after ${timeoutMs}ms`, {
            isTimeout: true,
            code: 'TIMEOUT',
        });
    }

    static networkError(cause?: Error): ApiRequestError {
        return new ApiRequestError('Network error - unable to reach server', {
            isNetworkError: true,
            code: 'NETWORK_ERROR',
            cause,
        });
    }

    static aborted(): ApiRequestError {
        return new ApiRequestError('Request was aborted', {
            isAborted: true,
            code: 'ABORTED',
        });
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffDelay(attempt: number, baseDelay: number): number {
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return Math.min(exponentialDelay + jitter, 30000);
}

function buildUrl(path: string, baseUrl: string = API_BASE_URL): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${normalizedBase}${normalizedPath}`;
}

async function parseErrorResponse(response: Response): Promise<string> {
    try {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const data = (await response.json()) as BackendErrorResponse;
            return data.error || data.message || `HTTP ${response.status}`;
        }
        const text = await response.text();
        return text || `HTTP ${response.status}`;
    } catch {
        return `HTTP ${response.status}: ${response.statusText}`;
    }
}

async function makeRequest<T>(url: string, options: ApiRequestOptions = {}): Promise<ApiClientResponse<T>> {
    const {
        method = 'GET',
        body,
        headers = {},
        timeout = DEFAULT_TIMEOUT,
        signal,
        useBigIntParsing = false,
    } = options;

    const controller = new AbortController();
    const abortFromExternal = () => controller.abort();
    if (signal) {
        if (signal.aborted) {
            controller.abort();
        } else {
            signal.addEventListener('abort', abortFromExternal, { once: true });
        }
    }

    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const requestInit: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...headers,
            },
            signal: controller.signal,
        };

        if (body !== undefined && body !== null && method !== 'GET') {
            requestInit.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        const response = await fetch(url, requestInit);

        clearTimeout(timeoutId);
        if (signal) {
            signal.removeEventListener('abort', abortFromExternal);
        }

        if (!response.ok) {
            const errorMessage = await parseErrorResponse(response);
            throw new ApiRequestError(errorMessage, {
                status: response.status,
                response,
            });
        }

        let data: T;
        if (useBigIntParsing) {
            const text = await response.text();
            data = parseBigIntJson<T>(text);
        } else {
            data = (await response.json()) as T;
        }

        return {
            data,
            status: response.status,
            headers: response.headers,
            ok: true,
        };
    } catch (error) {
        clearTimeout(timeoutId);
        if (signal) {
            signal.removeEventListener('abort', abortFromExternal);
        }
        if (error instanceof ApiRequestError) {
            throw error;
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
            if (signal?.aborted) {
                throw ApiRequestError.aborted();
            }
            throw ApiRequestError.timeout(timeout);
        }
        if (error instanceof TypeError && error.message.includes('fetch')) {
            throw ApiRequestError.networkError(error);
        }
        throw new ApiRequestError(
            error instanceof Error ? error.message : 'Unknown error',
            { cause: error instanceof Error ? error : undefined }
        );
    }
}

async function makeRequestWithRetry<T>(
    url: string,
    options: ApiRequestOptions = {}
): Promise<ApiClientResponse<T>> {
    const { retries = DEFAULT_RETRY_COUNT, ...requestOptions } = options;
    let lastError: ApiRequestError | null = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await makeRequest<T>(url, requestOptions);
        } catch (error) {
            if (!(error instanceof ApiRequestError)) {
                throw error;
            }

            lastError = error;

            const shouldNotRetry =
                error.isAborted ||
                (error.status && error.status >= 400 && error.status < 500) ||
                attempt >= retries;

            if (shouldNotRetry) {
                throw error;
            }

            const delay = getBackoffDelay(attempt, RETRY_DELAY);
            console.warn(`[API] Request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms...`);
            await sleep(delay);
        }
    }

    throw lastError || new ApiRequestError('Request failed after retries');
}

export const apiClient = {
    async get<T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<T> {
        const url = buildUrl(path);
        const response = await makeRequestWithRetry<T>(url, { ...options, method: 'GET' });
        return response.data;
    },
    async post<T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<T> {
        const url = buildUrl(path);
        const response = await makeRequestWithRetry<T>(url, { ...options, method: 'POST', body });
        return response.data;
    },
    async put<T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<T> {
        const url = buildUrl(path);
        const response = await makeRequestWithRetry<T>(url, { ...options, method: 'PUT', body });
        return response.data;
    },
    async delete<T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<T> {
        const url = buildUrl(path);
        const response = await makeRequestWithRetry<T>(url, { ...options, method: 'DELETE' });
        return response.data;
    },
    async request<T>(path: string, options?: ApiRequestOptions): Promise<ApiClientResponse<T>> {
        const url = buildUrl(path);
        return makeRequestWithRetry<T>(url, options);
    },
};

export function isApiError(error: unknown): error is ApiRequestError {
    return error instanceof ApiRequestError;
}

export function isNetworkError(error: unknown): boolean {
    return error instanceof ApiRequestError && error.isNetworkError;
}

export function isTimeoutError(error: unknown): boolean {
    return error instanceof ApiRequestError && error.isTimeout;
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof ApiRequestError) {
        if (error.status === 404) return '资源未找到';
        if (error.status === 401) return '身份验证失败';
        if (error.status === 403) return '权限不足';
        if (error.status === 500) return '服务器内部错误';
        if (error.isTimeout) return '请求超时，请检查网络连接';
        if (error.isNetworkError) return '网络连接失败，请检查后端服务是否运行';
        return error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return '未知错误';
}

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

export function buildAssignNodeUrl(assignEndpoint: string): string {
    const raw = String(assignEndpoint || '').trim();
    if (!raw) return '';

    let protocol = 'http:';
    let currentHost = 'localhost';
    try {
        const baseUrl = new URL(API_BASE_URL);
        protocol = baseUrl.protocol || protocol;
        currentHost = baseUrl.hostname || currentHost;
    } catch {
        // ignore
    }

    if (raw.startsWith(':')) {
        const port = raw.slice(1);
        return `${protocol}//${currentHost}:${port}`;
    }

    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
        const colonIndex = raw.lastIndexOf(':');
        if (colonIndex > 0) {
            const ip = raw.substring(0, colonIndex);
            const port = raw.substring(colonIndex + 1);
            if (ip === '127.0.0.1' || ip === 'localhost') {
                return `${protocol}//${currentHost}:${port}`;
            }
            return `${protocol}//${raw}`;
        }
        return `${protocol}//${raw}`;
    }

    try {
        const endpointUrl = new URL(raw);
        if (endpointUrl.hostname === '127.0.0.1' || endpointUrl.hostname === 'localhost') {
            const port = endpointUrl.port ? `:${endpointUrl.port}` : '';
            return `${endpointUrl.protocol}//${currentHost}${port}${endpointUrl.pathname}`;
        }
    } catch {
        // ignore
    }

    return raw;
}

export function buildAggrNodeUrl(aggrEndpoint: string): string {
    const raw = String(aggrEndpoint || '').trim();
    if (!raw) return '';

    let protocol = 'http:';
    let currentHost = 'localhost';
    try {
        const baseUrl = new URL(API_BASE_URL);
        protocol = baseUrl.protocol || protocol;
        currentHost = baseUrl.hostname || currentHost;
    } catch {
        // ignore
    }

    if (raw.startsWith(':')) {
        const port = raw.slice(1);
        return `${protocol}//${currentHost}:${port}`;
    }

    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
        const colonIndex = raw.lastIndexOf(':');
        if (colonIndex > 0) {
            const ip = raw.substring(0, colonIndex);
            const port = raw.substring(colonIndex + 1);
            if (ip === '127.0.0.1' || ip === 'localhost') {
                return `${protocol}//${currentHost}:${port}`;
            }
            return `${protocol}//${raw}`;
        }
        return `${protocol}//${raw}`;
    }

    try {
        const endpointUrl = new URL(raw);
        if (endpointUrl.hostname === '127.0.0.1' || endpointUrl.hostname === 'localhost') {
            const port = endpointUrl.port ? `:${endpointUrl.port}` : '';
            return `${endpointUrl.protocol}//${currentHost}${port}${endpointUrl.pathname}`;
        }
    } catch {
        // ignore
    }

    return raw;
}

function normalizeAddress(address: string): string {
    return String(address || '').trim().replace(/^0x/i, '').toLowerCase();
}

// ========================================
// HTTP 请求函数
// ========================================

async function request<T>(
    url: string,
    options: ApiRequestOptions = {},
    config: { timeout?: number; retries?: number; useBigIntParsing?: boolean; silent?: boolean } = {}
): Promise<ApiResponse<T>> {
    try {
        const response = await apiClient.request<T>(url, {
            ...options,
            timeout: config.timeout ?? options.timeout,
            retries: config.retries ?? options.retries,
            useBigIntParsing: config.useBigIntParsing ?? options.useBigIntParsing,
            silent: config.silent ?? options.silent,
        });
        return { success: true, data: response.data };
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
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

export function clearComNodeCache(): void {
    cachedComNodeUrl = null;
}

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
    const base = assignNodeUrl ? buildAssignNodeUrl(assignNodeUrl) : API_BASE_URL;
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
    const base = assignNodeUrl ? buildAssignNodeUrl(assignNodeUrl) : API_BASE_URL;
    const url = buildApiUrl(base, `${API_ENDPOINTS.ASSIGN_ACCOUNT_UPDATE(groupId)}?userID=${userId}&limit=50`);
    return request(url);
}

export async function pollTxCerChange(
    groupId: string,
    userId: string,
    assignNodeUrl?: string
): Promise<ApiResponse<unknown[]>> {
    const base = assignNodeUrl ? buildAssignNodeUrl(assignNodeUrl) : API_BASE_URL;
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
