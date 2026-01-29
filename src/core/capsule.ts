/**
 * Capsule address helper (extension)
 */

import { ec as EC } from 'elliptic';
import { sha256 } from 'js-sha256';
import {
    API_BASE_URL,
    API_ENDPOINTS,
    DEFAULT_TIMEOUT,
    apiClient,
    buildApiUrl,
    buildAssignNodeUrl,
    getComNodeEndpoint,
} from './api';
import { getOrganization, getSessionAddressKey, getSessionKey, type OrganizationChoice } from './storage';
import {
    bigIntToHex,
    getCustomEpochTimestamp,
    serializeForBackend,
    signStruct,
    type EcdsaSignature,
    type PublicKeyNew,
} from './signature';

interface CapsuleAddressRequest {
    UserID: string;
    Address: string;
    Timestamp: number;
    Sig?: EcdsaSignature;
}

interface CapsuleAddressReply {
    Success: boolean;
    CapsuleAddr: string;
    ErrorMsg?: string;
}

interface OrgPublicKeyResponse {
    org_id?: string;
    public_key?: PublicKeyNew;
}

const COMMITTEE_ORG_ID = '00000000';
const capsuleCache = new Map<string, string>();
const orgPublicKeyCache = new Map<string, PublicKeyNew>();
const CAPSULE_MASK_SALT = 'PANGU_CAPSULE_V1';
const CAPSULE_MASK_LEN = 20;
const CAPSULE_SIG_PART_LEN = 32;
const CAPSULE_PAYLOAD_LEN = CAPSULE_MASK_LEN + CAPSULE_SIG_PART_LEN * 2;
const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58Map: Record<string, number> = Object.fromEntries(
    base58Alphabet.split('').map((char, index) => [char, index])
);
const ec = new EC('p256');

function normalizeAddress(address: string): string {
    return String(address || '').trim().replace(/^0x/i, '').toLowerCase();
}

function isValidAddress(address: string): boolean {
    return /^[0-9a-f]{40}$/.test(address);
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

function hexToBytes(hex: string): Uint8Array {
    const clean = hex.replace(/^0x/i, '');
    const out = new Uint8Array(Math.ceil(clean.length / 2));
    for (let i = 0; i < out.length; i += 1) {
        out[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
}

function base58Decode(input: string): Uint8Array {
    const str = String(input || '').trim();
    if (!str) return new Uint8Array(0);
    let zeros = 0;
    while (zeros < str.length && str[zeros] === '1') zeros += 1;
    if (zeros === str.length) {
        return new Uint8Array(zeros);
    }
    const bytes: number[] = [0];
    for (let i = zeros; i < str.length; i += 1) {
        const value = base58Map[str[i]];
        if (value === undefined) {
            throw new Error('Invalid base58 character');
        }
        let carry = value;
        for (let j = 0; j < bytes.length; j += 1) {
            carry += bytes[j] * base58Alphabet.length;
            bytes[j] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    for (let i = 0; i < zeros; i += 1) {
        bytes.push(0);
    }
    return new Uint8Array(bytes.reverse());
}

function base58CheckDecode(input: string): Uint8Array {
    const full = base58Decode(input);
    if (full.length < 4) {
        throw new Error('Invalid capsule payload');
    }
    const payload = full.slice(0, full.length - 4);
    const checksum = full.slice(full.length - 4);
    const first = sha256.array(payload);
    const second = sha256.array(first);
    for (let i = 0; i < 4; i += 1) {
        if (checksum[i] !== second[i]) {
            throw new Error('Invalid capsule checksum');
        }
    }
    return payload;
}

function normalizePublicKey(pubKey?: PublicKeyNew | null): PublicKeyNew | null {
    if (!pubKey || pubKey.X === undefined || pubKey.Y === undefined) return null;
    return {
        CurveName: pubKey.CurveName || 'P256',
        X: typeof pubKey.X === 'bigint' ? pubKey.X.toString(10) : String(pubKey.X),
        Y: typeof pubKey.Y === 'bigint' ? pubKey.Y.toString(10) : String(pubKey.Y),
    };
}

function cacheOrgPublicKey(orgId: string, pubKey: PublicKeyNew): void {
    const normalized = normalizePublicKey(pubKey);
    if (!normalized) return;
    orgPublicKeyCache.set(orgId, normalized);
}

function getCachedOrgPublicKey(orgId: string): PublicKeyNew | null {
    const cached = orgPublicKeyCache.get(orgId);
    return cached ? normalizePublicKey(cached) : null;
}

function buildCacheKey(orgId: string, address: string): string {
    return `${orgId}:${address}`;
}

function buildAssignCapsuleUrl(org: OrganizationChoice): string {
    const endpoint = org.assignAPIEndpoint || org.assignNodeUrl || '';
    const base = endpoint ? buildAssignNodeUrl(endpoint) : API_BASE_URL;
    return buildApiUrl(base, API_ENDPOINTS.ASSIGN_CAPSULE_GENERATE(org.groupId));
}

export async function requestCapsuleAddress(accountId: string, address: string): Promise<string> {
    const normalized = normalizeAddress(address);
    if (!isValidAddress(normalized)) {
        throw new Error('地址格式不正确');
    }

    const org = await getOrganization(accountId);
    const inGroup = !!(org && org.groupId && org.groupId.trim());
    const orgId = inGroup ? org!.groupId : COMMITTEE_ORG_ID;
    const cacheKey = buildCacheKey(orgId, normalized);
    const cached = capsuleCache.get(cacheKey);
    if (cached) return cached;

    const requestBody: CapsuleAddressRequest = {
        UserID: inGroup ? accountId : '',
        Address: normalized,
        Timestamp: getCustomEpochTimestamp(),
    };

    if (inGroup) {
        const session = getSessionKey();
        if (!session || session.accountId !== accountId) {
            throw new Error('请先解锁账户私钥');
        }
        requestBody.Sig = signStruct(requestBody as unknown as Record<string, unknown>, session.privKey, ['Sig']);
    } else {
        const addrKey = getSessionAddressKey(address);
        if (!addrKey) {
            throw new Error('请先导入或解锁该地址私钥');
        }
        requestBody.Sig = signStruct(requestBody as unknown as Record<string, unknown>, addrKey, ['Sig']);
    }

    const apiUrl = inGroup
        ? buildAssignCapsuleUrl(org as OrganizationChoice)
        : buildApiUrl(await getComNodeEndpoint(), API_ENDPOINTS.COM_CAPSULE_GENERATE);

    const response = await apiClient.request<CapsuleAddressReply & { error?: string; message?: string }>(apiUrl, {
        method: 'POST',
        body: serializeForBackend(requestBody),
        timeout: DEFAULT_TIMEOUT,
        retries: 0,
    });
    const data = response.data;
    if (!data.Success) {
        throw new Error(data.ErrorMsg || '生成胶囊地址失败');
    }

    capsuleCache.set(cacheKey, data.CapsuleAddr);
    return data.CapsuleAddr;
}

export function isCapsuleAddress(input: string): boolean {
    try {
        parseCapsuleAddress(input);
        return true;
    } catch {
        return false;
    }
}

export function parseCapsuleAddress(input: string): { orgId: string; payload: string } {
    const raw = String(input || '').trim();
    const parts = raw.split('@');
    if (parts.length !== 2) {
        throw new Error('胶囊地址格式不正确');
    }
    const orgId = parts[0].trim();
    const payload = parts[1].trim();
    if (!/^\d{8}$/.test(orgId) || !payload) {
        throw new Error('胶囊地址格式不正确');
    }
    return { orgId, payload };
}

async function fetchOrgPublicKey(orgId: string): Promise<PublicKeyNew> {
    const cached = getCachedOrgPublicKey(orgId);
    if (cached) return cached;

    if (orgId === COMMITTEE_ORG_ID) {
        const comNodeUrl = await getComNodeEndpoint();
        if (!comNodeUrl) {
            throw new Error('ComNode 端点不可用');
        }
        const data = await apiClient.get<OrgPublicKeyResponse>(buildApiUrl(comNodeUrl, API_ENDPOINTS.COM_PUBLIC_KEY), {
            timeout: DEFAULT_TIMEOUT,
            retries: 0,
            useBigIntParsing: true,
        });
        if (!data?.public_key) {
            throw new Error('未返回组织公钥');
        }
        cacheOrgPublicKey(orgId, data.public_key);
        return data.public_key;
    }

    const data = await apiClient.get<OrgPublicKeyResponse>(
        `${API_BASE_URL}${API_ENDPOINTS.ORG_PUBLIC_KEY}?org_id=${encodeURIComponent(orgId)}`,
        {
            timeout: DEFAULT_TIMEOUT,
            retries: 0,
            useBigIntParsing: true,
        }
    );
    if (!data?.public_key) {
        throw new Error('未返回组织公钥');
    }
    cacheOrgPublicKey(orgId, data.public_key);
    return data.public_key;
}

export async function verifyCapsuleAddress(capsule: string): Promise<{ address: string; orgId: string }> {
    const { orgId, payload } = parseCapsuleAddress(capsule);
    const pubKey = await fetchOrgPublicKey(orgId);
    const normalizedPub = normalizePublicKey(pubKey);
    if (!normalizedPub) {
        throw new Error('组织公钥缺失');
    }

    let payloadBytes: Uint8Array;
    try {
        payloadBytes = base58CheckDecode(payload);
    } catch (error) {
        throw new Error('胶囊地址格式不正确');
    }

    if (payloadBytes.length !== CAPSULE_PAYLOAD_LEN) {
        throw new Error('胶囊地址格式不正确');
    }

    const maskedAddr = payloadBytes.slice(0, CAPSULE_MASK_LEN);
    const rBytes = payloadBytes.slice(CAPSULE_MASK_LEN, CAPSULE_MASK_LEN + CAPSULE_SIG_PART_LEN);
    const sBytes = payloadBytes.slice(CAPSULE_MASK_LEN + CAPSULE_SIG_PART_LEN);

    const xHex = bigIntToHex(normalizedPub.X);
    const yHex = bigIntToHex(normalizedPub.Y);
    const sig = {
        r: bytesToHex(rBytes).padStart(64, '0'),
        s: bytesToHex(sBytes).padStart(64, '0'),
    };

    const hashHex = sha256(maskedAddr);
    const key = ec.keyFromPublic({ x: xHex, y: yHex }, 'hex');
    if (!key.verify(hashHex, sig)) {
        throw new Error('胶囊地址校验失败');
    }

    const saltBytes = new TextEncoder().encode(CAPSULE_MASK_SALT);
    const maskData = new Uint8Array([...hexToBytes(xHex), ...hexToBytes(yHex), ...saltBytes]);
    const maskHash = sha256.array(maskData);
    const mask = Uint8Array.from(maskHash.slice(0, CAPSULE_MASK_LEN));

    const realAddrBytes = new Uint8Array(CAPSULE_MASK_LEN);
    for (let i = 0; i < CAPSULE_MASK_LEN; i += 1) {
        realAddrBytes[i] = maskedAddr[i] ^ mask[i];
    }

    const address = bytesToHex(realAddrBytes);
    if (!isValidAddress(address)) {
        throw new Error('胶囊地址校验失败');
    }

    return { address, orgId };
}

export function clearCapsuleCache(): void {
    capsuleCache.clear();
}

export function clearOrgPublicKeyCache(): void {
    orgPublicKeyCache.clear();
}
