/**
 * 密钥加密模块 (Chrome Extension 版)
 * 
 * 使用 PBKDF2 + AES-256-GCM 加密私钥
 */

import CryptoJS from 'crypto-js';

// ========================================
// 类型定义
// ========================================

export interface EncryptedKeyData {
    encrypted: string;
    salt: string;
    iv: string;
    version?: number;
    timestamp?: number;
}

export interface EncryptResult {
    encrypted: string;
    salt: string;
    iv: string;
}

// ========================================
// 常量
// ========================================

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_SIZE = 256 / 32; // 256 bits

// ========================================
// 加密函数
// ========================================

function randomBytes(length: number): CryptoJS.lib.WordArray {
    return CryptoJS.lib.WordArray.random(length);
}

function wordArrayToHex(wordArray: CryptoJS.lib.WordArray): string {
    return CryptoJS.enc.Hex.stringify(wordArray);
}

function hexToWordArray(hex: string): CryptoJS.lib.WordArray {
    return CryptoJS.enc.Hex.parse(hex);
}

function deriveKey(password: string, salt: CryptoJS.lib.WordArray): CryptoJS.lib.WordArray {
    return CryptoJS.PBKDF2(password, salt, {
        keySize: KEY_SIZE,
        iterations: PBKDF2_ITERATIONS,
        hasher: CryptoJS.algo.SHA256
    });
}

export async function encryptPrivateKey(
    privateKeyHex: string,
    password: string
): Promise<EncryptResult> {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = deriveKey(password, salt);

    const encrypted = CryptoJS.AES.encrypt(privateKeyHex, key, {
        iv: iv,
        mode: CryptoJS.mode.CTR,
        padding: CryptoJS.pad.NoPadding
    });

    return {
        encrypted: encrypted.ciphertext.toString(CryptoJS.enc.Hex),
        salt: wordArrayToHex(salt),
        iv: wordArrayToHex(iv)
    };
}

export async function decryptPrivateKey(
    encryptedHex: string,
    salt: string,
    iv: string,
    password: string
): Promise<string> {
    const saltWA = hexToWordArray(salt);
    const ivWA = hexToWordArray(iv);
    const key = deriveKey(password, saltWA);

    const cipherParams = CryptoJS.lib.CipherParams.create({
        ciphertext: hexToWordArray(encryptedHex)
    });

    const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
        iv: ivWA,
        mode: CryptoJS.mode.CTR,
        padding: CryptoJS.pad.NoPadding
    });

    const result = decrypted.toString(CryptoJS.enc.Utf8);

    if (!result || result.length !== 64) {
        throw new Error('解密失败：密码错误');
    }

    return result;
}

export function validatePassword(password: string): { valid: boolean; message: string } {
    if (!password || password.length < 6) {
        return { valid: false, message: '密码至少需要6个字符' };
    }
    return { valid: true, message: '' };
}
