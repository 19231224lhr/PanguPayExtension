/**
 * ECDSA P-256 签名工具库 (Chrome Extension 版)
 * 
 * 从 TransferAreaInterface 复制，无需修改
 */

import { ec as EC } from 'elliptic';
import { sha256 } from 'js-sha256';

// 初始化 P-256 曲线
const ec = new EC('p256');

// ============================================
// 类型定义
// ============================================

export interface PublicKeyNew {
    CurveName: string;
    X: bigint | string;
    Y: bigint | string;
}

export interface EcdsaSignature {
    R: bigint;
    S: bigint;
}

export interface EcdsaSignatureWire {
    R: string;
    S: string;
}

// ============================================
// 核心签名函数
// ============================================

function applyExcludeZeroValue(obj: Record<string, unknown>, excludeFields: string[]): void {
    for (const field of excludeFields) {
        if (field === 'UserSig' || field === 'Sig' || field === 'GroupSig' || field === 'UserSignature') {
            obj[field] = { R: null, S: null };
        }
    }
}

function sortMapFieldsOnly(obj: Record<string, unknown>): void {
    const mapFields = ['AddressMsg', 'GuarTable'];

    for (const field of mapFields) {
        if (obj[field] && typeof obj[field] === 'object' && !Array.isArray(obj[field])) {
            const mapValue = obj[field] as Record<string, unknown>;
            const sortedKeys = Object.keys(mapValue).sort();
            const sorted: Record<string, unknown> = {};
            for (const k of sortedKeys) {
                sorted[k] = mapValue[k];
            }
            obj[field] = sorted;
        }
    }
}

function bigintReplacer(_key: string, value: unknown): unknown {
    if (typeof value === 'bigint') {
        return value.toString(10);
    }
    return value;
}

export function signStruct(
    data: Record<string, unknown>,
    privateKeyHex: string,
    excludeFields: string[] = []
): EcdsaSignature {
    const copy = JSON.parse(JSON.stringify(data, bigintReplacer));
    applyExcludeZeroValue(copy, excludeFields);
    sortMapFieldsOnly(copy);

    let jsonStr = JSON.stringify(copy);
    jsonStr = jsonStr.replace(/"(X|Y|R|S|D)":"(\d+)"/g, '"$1":$2');

    const hashBytes = sha256.array(jsonStr);
    const key = ec.keyFromPrivate(privateKeyHex, 'hex');
    const signature = key.sign(hashBytes);

    return {
        R: BigInt('0x' + signature.r.toString(16)),
        S: BigInt('0x' + signature.s.toString(16))
    };
}

export function verifyStruct(
    data: Record<string, unknown>,
    signature: EcdsaSignature,
    publicKeyHex: string,
    publicKeyYHex: string,
    excludeFields: string[] = []
): boolean {
    try {
        const copy = JSON.parse(JSON.stringify(data, bigintReplacer));
        applyExcludeZeroValue(copy, excludeFields);
        sortMapFieldsOnly(copy);

        let jsonStr = JSON.stringify(copy);
        jsonStr = jsonStr.replace(/"(X|Y|R|S|D)":"(\d+)"/g, '"$1":$2');

        const hashBytes = sha256.array(jsonStr);
        const key = ec.keyFromPublic({ x: publicKeyHex, y: publicKeyYHex }, 'hex');

        return key.verify(hashBytes, {
            r: signature.R.toString(16),
            s: signature.S.toString(16)
        });
    } catch (error) {
        console.error('[签名] 验证失败:', error);
        return false;
    }
}

// ============================================
// 公钥和地址工具函数
// ============================================

export function getPublicKeyFromPrivate(privateKeyHex: string): PublicKeyNew {
    const key = ec.keyFromPrivate(privateKeyHex, 'hex');
    const pubPoint = key.getPublic();
    return {
        CurveName: 'P256',
        X: BigInt('0x' + pubPoint.getX().toString(16)),
        Y: BigInt('0x' + pubPoint.getY().toString(16))
    };
}

export function getPublicKeyHexFromPrivate(privateKeyHex: string): { x: string; y: string } {
    const key = ec.keyFromPrivate(privateKeyHex, 'hex');
    const pubPoint = key.getPublic();
    return {
        x: pubPoint.getX().toString(16).padStart(64, '0'),
        y: pubPoint.getY().toString(16).padStart(64, '0')
    };
}

export function generateKeyPair(): { privateKey: string; publicKey: PublicKeyNew } {
    const key = ec.genKeyPair();
    return {
        privateKey: key.getPrivate('hex').padStart(64, '0'),
        publicKey: {
            CurveName: 'P256',
            X: BigInt('0x' + key.getPublic().getX().toString(16)),
            Y: BigInt('0x' + key.getPublic().getY().toString(16))
        }
    };
}

export function generateAddress(publicKey: PublicKeyNew): string {
    const xHex = publicKey.X.toString(16).padStart(64, '0');
    const yHex = publicKey.Y.toString(16).padStart(64, '0');
    const pubKeyHex = '04' + xHex + yHex;

    const bytes: number[] = [];
    for (let i = 0; i < pubKeyHex.length; i += 2) {
        bytes.push(parseInt(pubKeyHex.substr(i, 2), 16));
    }

    const hash = sha256(bytes);
    return hash.substring(0, 40);
}

// ============================================
// 时间戳函数
// ============================================

export function getTimestamp(): number {
    return Math.floor(Date.now() / 1000);
}

export function getCustomEpochTimestamp(): number {
    const EPOCH_2020 = new Date('2020-01-01T00:00:00Z').getTime();
    return Math.floor((Date.now() - EPOCH_2020) / 1000);
}

// ============================================
// 序列化函数
// ============================================

export function serializeForBackend(obj: unknown): string {
    let json = JSON.stringify(obj, bigintReplacer);
    json = json.replace(/"(X|Y|R|S|D)":"(\d+)"/g, '"$1":$2');
    return json;
}

export function hexToBigInt(hex: string): bigint {
    const cleanHex = hex.startsWith('0x') ? hex : '0x' + hex;
    return BigInt(cleanHex);
}

export function bigIntToHex(value: bigint | string, padLength: number = 64): string {
    const bi = typeof value === 'string' ? BigInt(value) : value;
    return bi.toString(16).padStart(padLength, '0');
}

export function convertHexToPublicKey(pubXHex: string, pubYHex: string): PublicKeyNew {
    return {
        CurveName: 'P256',
        X: hexToBigInt(pubXHex),
        Y: hexToBigInt(pubYHex)
    };
}

export function convertPublicKeyToHex(publicKey: PublicKeyNew): { x: string; y: string } {
    return {
        x: bigIntToHex(publicKey.X),
        y: bigIntToHex(publicKey.Y)
    };
}

export function signMessage(message: string, privateKeyHex: string): EcdsaSignatureWire {
    const hashBytes = sha256.array(message || '');
    const key = ec.keyFromPrivate(privateKeyHex, 'hex');
    const signature = key.sign(hashBytes);
    return {
        R: signature.r.toString(16),
        S: signature.s.toString(16),
    };
}

// ============================================
// 账户 ID 生成（对齐前端逻辑）
// ============================================

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function generateAccountIdFromPrivate(privateKeyHex: string): string {
    const normalized = String(privateKeyHex)
        .replace(/^0x/i, '')
        .toLowerCase()
        .replace(/^0+/, '');
    const bytes = new TextEncoder().encode(normalized);
    const value = crc32(bytes);
    const num = (value % 90000000) + 10000000;
    return String(num).padStart(8, '0');
}
