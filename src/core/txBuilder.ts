/**
 * Transaction Builder Service
 * 
 * 蹇€熻浆璐︿氦鏄撴瀯閫犳ā鍧?
 * 
 * 鈿狅笍 閲嶈锛氭湰瀹炵幇涓ユ牸瀵归綈鍚庣 Go 缁撴瀯浣撲笌楠岀/搴忓垪鍖栬鍒?
 * 鍙傝€冩枃妗ｏ細docs/04-api-integration.md
 * 
 * 绛惧悕瑙勫垯锛?
 * 1. TXInputNormal.InputSignature锛氫娇鐢ㄣ€愬湴鍧€绉侀挜銆戝 TXOutput 鍝堝笇绛惧悕
 * 2. UserNewTX.Sig锛氫娇鐢ㄣ€愯处鎴风閽ャ€戝鏁翠釜 UserNewTX 绛惧悕锛堟帓闄?Sig, Height锛?
 * 
 * @module services/txBuilder
 */

import { sha256 } from 'js-sha256';
import { ec as EC } from 'elliptic';
import type { User, AddressData } from './txUser';
import {
  UTXOData,
  TxCertificate,
  SignatureEnvelope,
  PublicKeyEnvelope,
  PublicKeyNew as BlockchainPublicKeyNew,
  EcdsaSignature as BlockchainEcdsaSignature,
  TXInputNormal as BlockchainTXInputNormal,
  TXOutput as BlockchainTXOutput,
  Transaction as BlockchainTransaction,
  UserNewTX as BlockchainUserNewTX,
  InterestAssign as BlockchainInterestAssign,
  SubATX as BlockchainSubATX,
  AggregateGTX as BlockchainAggregateGTX
} from './blockchain';
import { isUTXOLocked } from './utxoLock';
import { isAccountPollingActive } from './accountPolling';
import {
  AlgorithmECDSAP256,
  decodeBackendBytes,
  convertHexToPublicKey,
  hashBackendJson,
  publicKeyEnvelopeFromHex,
  serializeForBackend,
  signHashEnvelope,
  signStruct,
  type PublicKeyNew as SignaturePublicKey
} from './signature';
import {
  DefaultSeedChainLength,
  buildSeedSpendArtifacts,
  currentSeed,
  nextAnchor,
  recoverDeterministicSeedChainStateFromPrivateKey
} from './seedChain';
import {
  deriveAddressKeypairFromAddressRootSeed,
  derivePrivateKeyHexFromAddressRootSeed
} from './addressRootSeed';

// 鍒濆鍖?P-256 鏇茬嚎
const ec = new EC('p256');

function backendBytesEqual(left: unknown, right: unknown): boolean {
  const a = decodeBackendBytes(left);
  const b = decodeBackendBytes(right);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ============================================================================
// 绫诲瀷瀹氫箟锛堜弗鏍煎尮閰嶅悗绔?Go 缁撴瀯浣擄級
// ============================================================================

/**
 * ECDSA 绛惧悕锛堝唴閮ㄤ娇鐢?bigint锛?
 */
export interface EcdsaSignature {
  R: bigint;
  S: bigint;
}

/**
 * 鐢ㄤ簬 JSON 搴忓垪鍖栫殑绛惧悕鏍煎紡
 * 
 * 鈿狅笍 閲嶈锛欸o 鐨?*big.Int 搴忓垪鍖栦负 JSON number锛堜笉甯﹀紩鍙凤級
 * 浣?JavaScript 鐨?Number 鏃犳硶绮剧‘琛ㄧず 256 浣嶆暣鏁?
 * 瑙ｅ喅鏂规锛氬唴閮ㄧ敤瀛楃涓插瓨鍌紝搴忓垪鍖栨椂鍘绘帀寮曞彿
 */
export interface EcdsaSignatureJSON extends BlockchainEcdsaSignature {}

/**
 * P-256 鍏挜
 */
export interface PublicKeyNew {
  CurveName: string;  // 鍥哄畾涓?"P256"
  X: bigint;
  Y: bigint;
}


/**
 * 鐢ㄤ簬 JSON 搴忓垪鍖栫殑鍏挜鏍煎紡
 * 
 * 鈿狅笍 閲嶈锛欸o 鐨?*big.Int 搴忓垪鍖栦负 JSON number锛堜笉甯﹀紩鍙凤級
 * 浣?JavaScript 鐨?Number 鏃犳硶绮剧‘琛ㄧず 256 浣嶆暣鏁?
 * 瑙ｅ喅鏂规锛氬唴閮ㄧ敤瀛楃涓插瓨鍌紝搴忓垪鍖栨椂鍘绘帀寮曞彿
 */
export interface PublicKeyNewJSON extends BlockchainPublicKeyNew {
  CurveName: string;
  X: string;  // 鍗佽繘鍒跺瓧绗︿覆锛屽簭鍒楀寲鏃跺幓寮曞彿
  Y: string;  // 鍗佽繘鍒跺瓧绗︿覆锛屽簭鍒楀寲鏃跺幓寮曞彿
}

/**
 * 浜ゆ槗浣嶇疆
 */
export interface TxPosition {
  Blocknum: number;
  IndexX: number;
  IndexY: number;
  IndexZ: number;
}

/**
 * 浜ゆ槗杈撳嚭
 */
export interface TXOutput extends BlockchainTXOutput {
  ToPublicKey: PublicKeyNewJSON;
  Type: number;              // 璐у竵绫诲瀷锛?=PGC, 1=BTC, 2=ETH
  ToPeerID: string;
  IsPayForGas: boolean;
  SeedAnchor?: number[] | string;
  SeedChainStep?: number;
  DefaultSpendAlgorithm?: string;
}

/**
 * UTXO 杈撳叆
 */
/**
 * UTXO 杈撳叆
 * 
 * 鈿狅笍 閲嶈锛氬瓧娈甸『搴忓繀椤讳笌 Go 缁撴瀯浣?core/transaction.go 涓殑 TXInputNormal 涓€鑷达紒
 */
export interface TXInputNormal extends BlockchainTXInputNormal {
  InputSignature: EcdsaSignatureJSON;  // 鍦板潃绉侀挜绛惧悕锛圙o 涓湪 TXOutputHash 鍓嶉潰锛?
  TXOutputHash: number[];              // 琚紩鐢?TXOutput 鐨?SHA256 鍝堝笇锛堝瓧鑺傛暟缁勶級
  InputSignatureV2?: SignatureEnvelope;
  SeedReveal?: number[] | string;
  SeedPublicKeyV2?: PublicKeyEnvelope;
  SeedChainStep?: number;
}

/**
 * 鎵嬬画璐瑰垎閰?
 */
export interface InterestAssign extends BlockchainInterestAssign {}

/**
 * 浜ゆ槗鏈綋
 */
export interface Transaction extends BlockchainTransaction {
  UserSignature: EcdsaSignatureJSON;
  UserSignatureV2?: SignatureEnvelope;
  TXInputsNormal: TXInputNormal[];
  TXInputsCertificate: any[];          // 蹇€熻浆璐﹀～绌烘暟缁?
  TXOutputs: TXOutput[];
  // Go: []byte -> base64 string in JSON
  Data: number[] | string;
}


/**
 * 鐢ㄦ埛鏂颁氦鏄擄紙鎻愪氦缁欏悗绔殑椤跺眰缁撴瀯锛?
 */
export interface UserNewTX extends BlockchainUserNewTX {
  TX: Transaction;
  Sig: EcdsaSignatureJSON;
}

/**
 * 鏋勫缓浜ゆ槗鍙傛暟
 */
export interface BuildTransactionParams {
  /** 鍙戦€佹柟鍦板潃鍒楄〃 */
  fromAddresses: string[];
  /** 鏀舵鏂逛俊鎭?*/
  recipients: Array<{
    address: string;
    amount: number;
    coinType: number;           // 0=PGC, 1=BTC, 2=ETH
    publicKeyX: string;         // hex 鏍煎紡
    publicKeyY: string;         // hex 鏍煎紡
    guarGroupID: string;
    interest?: number;          // 鍒嗛厤鐨勫埄鎭?
    seedAnchor?: number[] | string;
    seedChainStep?: number;
    defaultSpendAlgorithm?: string;
  }>;
  /** 鎵鹃浂鍦板潃锛堟寜甯佺锛?*/
  changeAddresses: Record<number, string>;
  /** Gas 璐?*/
  gas: number;
  /** 鏄惁璺ㄩ摼浜ゆ槗 */
  isCrossChain?: boolean;
  /** 棰濆 PGC 鍏戞崲 Gas 鐨勬暟閲忥紙鐢ㄤ簬鏀粯浜ゆ槗璐癸級 */
  howMuchPayForGas?: number;
  /** 鏄惁浼樺厛浣跨敤 TXCer锛堜富甯佺 0锛?*/
  preferTXCer?: boolean;
}

function normalizeUtxoIdForLockCheck(utxoId: string): { raw: string; normalized: string; backendStyle: string } {
  const raw = String(utxoId || '');
  const normalized = raw.includes(' + ') ? raw.replace(' + ', '_') : raw;
  // txid is hex, so "_" is safe as a separator.
  let backendStyle = raw;
  if (normalized.includes('_')) {
    const parts = normalized.split('_');
    if (parts.length === 2) {
      backendStyle = `${parts[0]} + ${parts[1]}`;
    }
  }
  return { raw, normalized, backendStyle };
}

function isUtxoLockedAnyFormat(utxoId: string): boolean {
  const ids = normalizeUtxoIdForLockCheck(utxoId);
  return isUTXOLocked(ids.raw) || isUTXOLocked(ids.normalized) || isUTXOLocked(ids.backendStyle);
}

// ============================================================================
// 搴忓垪鍖栧伐鍏峰嚱鏁?
// ============================================================================

/**
 * bigint 鏇挎崲鍣紙鐢ㄤ簬 JSON.stringify锛?
 * 灏?bigint 杞负鍗佽繘鍒跺瓧绗︿覆
 */
function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString(10);
  }
  return value;
}

/**
 * 灏嗘暟瀛楁暟缁勶紙瀛楄妭鏁扮粍锛夎浆鎹负 Base64 瀛楃涓?
 * 
 * 鈿狅笍 閲嶈锛欸o 鐨?[]byte 搴忓垪鍖栦负 Base64 瀛楃涓诧紝涓嶆槸鏁扮粍
 * 渚嬪锛歔1, 2, 3] -> "AQID"
 * 
 * @param arr 鏁板瓧鏁扮粍锛堝瓧鑺傛暟缁勶級
 * @returns Base64 瀛楃涓?
 */
function byteArrayToBase64(arr: number[]): string {
  if (!arr || arr.length === 0) {
    return '';
  }
  // 鍒涘缓 Uint8Array 骞惰浆涓?Base64
  const uint8 = new Uint8Array(arr);
  // 浣跨敤 btoa 杩涜 Base64 缂栫爜
  let binary = '';
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

/**
 * 灏嗗璞′腑鐨勫瓧鑺傛暟缁勫瓧娈佃浆鎹负 Base64
 * 閫掑綊澶勭悊宓屽瀵硅薄鍜屾暟缁?
 * 
 * @param obj 瑕佸鐞嗙殑瀵硅薄
 * @param byteArrayFields 瀛楄妭鏁扮粍瀛楁鍚嶅垪琛?
 */
function convertByteArraysToBase64(
  obj: Record<string, unknown>,
  byteArrayFields: string[] = ['TXOutputHash', 'Data', 'SeedReveal', 'SeedAnchor', 'Signature', 'PublicKey']
): void {
  if (!obj || typeof obj !== 'object') return;

  for (const key of Object.keys(obj)) {
    const value = obj[key];

    // 濡傛灉鏄渶瑕佽浆鎹㈢殑瀛楄妭鏁扮粍瀛楁
    if (byteArrayFields.includes(key) && Array.isArray(value)) {
      obj[key] = byteArrayToBase64(value as number[]);
    }
    // 濡傛灉鏄暟缁勶紝閫掑綊澶勭悊姣忎釜鍏冪礌
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          convertByteArraysToBase64(item as Record<string, unknown>, byteArrayFields);
        }
      }
    }
    // 濡傛灉鏄璞★紝閫掑綊澶勭悊
    else if (value && typeof value === 'object') {
      convertByteArraysToBase64(value as Record<string, unknown>, byteArrayFields);
    }
  }
}

/**
 * 灏嗗璞″簭鍒楀寲涓?JSON 瀛楃涓?
 * 
 * 鈿狅笍 閲嶈瑙勫垯锛?
 * 1. 涓嶈鍏ㄥ眬鎺掑簭 key锛屽彧瀵?map 瀛楁鎺掑簭
 * 2. X/Y/R/S 蹇呴』鏄?JSON number锛堜笉甯﹀紩鍙凤級
 * 
 * @param obj 瑕佸簭鍒楀寲鐨勫璞?
 * @param sortMapFields 闇€瑕佹帓搴忕殑 map 瀛楁鍚?
 */
function serializeToJSON(obj: unknown, sortMapFields: string[] = []): string {
  // 娣辨嫹璐濆苟杞崲 bigint
  const copy = JSON.parse(JSON.stringify(obj, bigintReplacer));

  // 鍙鎸囧畾鐨?map 瀛楁鍋?key 鎺掑簭
  for (const field of sortMapFields) {
    if (copy[field] && typeof copy[field] === 'object' && !Array.isArray(copy[field])) {
      const mapValue = copy[field] as Record<string, unknown>;
      const sortedKeys = Object.keys(mapValue).sort();
      const sorted: Record<string, unknown> = {};
      for (const k of sortedKeys) {
        sorted[k] = mapValue[k];
      }
      copy[field] = sorted;
    }
  }

  // JSON 搴忓垪鍖?
  let json = JSON.stringify(copy);

  // 鎶?X/Y/R/S 瀛楁鐨勫紩鍙峰幓鎺夛紝鍙樻垚 JSON number
  json = json.replace(/"(X|Y|R|S)":"(\d+)"/g, '"$1":$2');

  return json;
}


/**
 * 灏嗘帓闄ゅ瓧娈佃缃负闆跺€?
 * 
 * @param obj 瑕佸鐞嗙殑瀵硅薄
 * @param excludeFields 瑕佹帓闄ょ殑瀛楁鍚嶆暟缁?
 */
function applyExcludeZeroValue(obj: Record<string, unknown>, excludeFields: string[]): void {
  for (const field of excludeFields) {
    if (!(field in obj)) continue;

    if (field === 'Sig' || field === 'UserSignature' || field === 'InputSignature') {
      // 绛惧悕瀛楁鐨勯浂鍊兼槸 {R: null, S: null}
      obj[field] = { R: null, S: null };
    } else if (field === 'Height' || field === 'Size' || field === 'NewValue' || field === 'TXType') {
      // 鏁板瓧瀛楁鐨勯浂鍊兼槸 0
      obj[field] = 0;
    } else if (field === 'TXID') {
      // 瀛楃涓插瓧娈电殑闆跺€兼槸绌哄瓧绗︿覆
      obj[field] = '';
    } else if (field === 'NewValueDiv') {
      // map 瀛楁鐨勯浂鍊兼槸绌哄璞?
      obj[field] = {};
    }
  }
}

// ============================================================================
// 鍝堝笇璁＄畻鍑芥暟
// ============================================================================

/**
 * 璁＄畻 TXOutput 鐨?SHA256 鍝堝笇
 * 
 * 鍚庣瀹炵幇锛氬 TXOutput 鏁翠釜缁撴瀯浣?JSON 搴忓垪鍖栧悗姹?SHA256
 * 鈿狅笍 娉ㄦ剰锛氬簭鍒楀寲鏃朵笉鎺掗櫎浠讳綍瀛楁
 * 
 * @param output TXOutput 瀵硅薄
 * @returns 32瀛楄妭鍝堝笇鍊硷紙鏁板瓧鏁扮粍锛?
 */
export function getTXOutputHash(output: TXOutput): number[] {
  return getOutputHashCompat(output);
}

/**
 * 璁＄畻浜ゆ槗鍝堝笇锛堢敤浜庣敓鎴?TXID锛?
 * 
 * 鍚庣瀹炵幇閫昏緫锛?
 * 1. 杩囨护鎺?IsGuarMake=true 鐨?Input 鍜?Output
 * 2. 搴忓垪鍖栨椂鎺掗櫎瀛楁锛歍XID, Size, NewValue, UserSignature, TXType
 * 3. SHA256 鍝堝笇
 * 
 * @param tx Transaction 瀵硅薄
 * @returns 32瀛楄妭鍝堝笇鍊?
 */
export function getTXHash(tx: Transaction): number[] {
  // 1. 杩囨护鎺夋媴淇濈粍缁囨瀯閫犵殑 Input 鍜?Output
  const filteredInputs = tx.TXInputsNormal.filter(input => !input.IsGuarMake);
  const filteredOutputs = tx.TXOutputs.filter(output => !output.IsGuarMake);

  // 2. 鍒涘缓涓存椂浜ゆ槗瀵硅薄
  const txForHash = {
    ...tx,
    TXInputsNormal: filteredInputs,
    TXOutputs: filteredOutputs
  };

  const copy = JSON.parse(JSON.stringify(txForHash, bigintReplacer));
  applyExcludeZeroValue(copy, ['TXID', 'Size', 'NewValue', 'UserSignature', 'TXType']);
  return hashBackendJson(copy);
}


/**
 * 璁＄畻 TXID
 * 
 * 鍚庣瀹炵幇锛氬彇浜ゆ槗鍝堝笇鐨勫墠8瀛楄妭锛岃浆涓?6杩涘埗瀛楃涓?
 * 缁撴灉锛?6涓瓧绗︾殑鍗佸叚杩涘埗瀛楃涓?
 * 
 * @param tx Transaction 瀵硅薄
 * @returns TXID锛?6瀛楃 hex锛?
 */
export function calculateTXID(tx: Transaction): string {
  const hash = getTXHash(tx);

  // 鍙栧墠8瀛楄妭锛岃浆涓哄崄鍏繘鍒?
  let txid = '';
  for (let i = 0; i < 8; i++) {
    txid += hash[i].toString(16).padStart(2, '0');
  }

  return txid;
}

// ============================================================================
// 绛惧悕鍑芥暟
// ============================================================================

/**
 * 瀵?TXOutput 绛惧悕锛堢敤浜?TXInputNormal.InputSignature锛?
 * 
 * 娴佺▼锛?
 * 1. 璁＄畻 TXOutput 鐨?SHA256 鍝堝笇
 * 2. 浣跨敤鍦板潃绉侀挜瀵瑰搱甯岀鍚?
 * 
 * @param output 琚紩鐢ㄧ殑 TXOutput
 * @param addressPrivateKeyHex 鍦板潃绉侀挜锛坔ex 鏍煎紡锛?
 * @returns { hash: number[], signature: EcdsaSignature }
 */
export function signTXOutput(
  output: TXOutput,
  addressPrivateKeyHex: string
): { hash: number[]; signature: EcdsaSignature } {
  // [DEBUG] 鎵撳嵃鐢ㄤ簬鍝堝笇鐨?TXOutput
  const jsonForHash = serializeToJSON(output);
  console.log('[signTXOutput] ========== TXOutput 绛惧悕璇︽儏 ==========');
  console.log('[signTXOutput] TXOutput JSON 闀垮害:', jsonForHash.length);
  console.log('[signTXOutput] TXOutput JSON:', jsonForHash);

  // 1. 璁＄畻 TXOutput 鍝堝笇
  const hash = getTXOutputHash(output);

  // [DEBUG] 鎵撳嵃鍝堝笇鍊?
  const hashHex = hash.map(b => b.toString(16).padStart(2, '0')).join('');
  const hashBase64 = btoa(String.fromCharCode(...hash));
  console.log('[signTXOutput] TXOutput Hash (hex):', hashHex);
  console.log('[signTXOutput] TXOutput Hash (base64):', hashBase64);
  console.log('[signTXOutput] ========================================');

  // 2. 浣跨敤鍦板潃绉侀挜绛惧悕
  const key = ec.keyFromPrivate(addressPrivateKeyHex, 'hex');
  const sig = key.sign(hash);

  return {
    hash,
    signature: {
      R: BigInt('0x' + sig.r.toString(16)),
      S: BigInt('0x' + sig.s.toString(16))
    }
  };
}

/**
 * 瀵?UserNewTX 绛惧悕
 * 
 * 鍚庣楠岃瘉閫昏緫锛?
 * 1. 浣跨敤鐢ㄦ埛璐︽埛鍏挜楠岃瘉
 * 2. 鎺掗櫎瀛楁锛歋ig, Height
 * 
 * @param userNewTX UserNewTX 瀵硅薄
 * @param accountPrivateKeyHex 璐︽埛绉侀挜锛坔ex 鏍煎紡锛?
 * @returns EcdsaSignature
 */
export function signUserNewTX(
  userNewTX: UserNewTX,
  accountPrivateKeyHex: string
): EcdsaSignature {
  const sig = signStruct(userNewTX as unknown as Record<string, unknown>, accountPrivateKeyHex, ['Sig', 'Height']);
  return {
    R: BigInt(String(sig.R || '0')),
    S: BigInt(String(sig.S || '0'))
  };
}


// ============================================================================
// TXCer 绛惧悕鍑芥暟
// ============================================================================

/**
 * 璁＄畻 TXCer 鐨?SHA256 鍝堝笇
 * 
 * 鍚庣瀹炵幇锛欸etTXCerHash 鎺掗櫎 GuarGroupSignature 鍜?UserSignature 瀛楁
 * 
 * @param txCer TxCertificate 瀵硅薄
 * @returns 32瀛楄妭鍝堝笇鍊硷紙鏁板瓧鏁扮粍锛?
 */
export function getTXCerHash(txCer: TxCertificate): number[] {
  // 娣辨嫹璐濆苟鎺掗櫎绛惧悕瀛楁锛堣涓洪浂鍊硷級
  const copy = JSON.parse(JSON.stringify(txCer, bigintReplacer));

  // 灏嗙鍚嶅瓧娈佃涓洪浂鍊?{R: null, S: null}
  copy.GuarGroupSignature = { R: null, S: null };
  copy.UserSignature = { R: null, S: null };

  // JSON 搴忓垪鍖栵紝鎶?X/Y/R/S 鐨勫紩鍙峰幓鎺?
  let jsonStr = JSON.stringify(copy);
  jsonStr = jsonStr.replace(/"(X|Y|R|S)":"(\d+)"/g, '"$1":$2');

  console.log('[TXCer绛惧悕] TXCer 鍝堝笇 JSON:', jsonStr.slice(0, 200) + '...');

  // SHA256 鍝堝笇
  return sha256.array(jsonStr);
}

/**
 * 瀵?TXCer 绛惧悕锛堢敤浜?TxCertificate.UserSignature锛?
 * 
 * 鍚庣瀹炵幇锛氫娇鐢ㄦ帴鏀跺湴鍧€鐨勭閽ュ TXCer 鍝堝笇绛惧悕
 * 鍙傝€冿細core.SignStruct(txcer, a.Wallet.AddressMsg[txcer.ToAddress].WPrivateKey, "UserSignature")
 * 
 * @param txCer TxCertificate 瀵硅薄
 * @param addressPrivateKeyHex 鎺ユ敹鍦板潃绉侀挜锛坔ex 鏍煎紡锛?
 * @returns 绛惧悕鍚庣殑 TxCertificate 鍓湰
 */
export function signTXCer(
  txCer: TxCertificate,
  accountPrivateKeyHex: string
): TxCertificate {
  // 娣辨嫹璐?
  const signedTxCer = JSON.parse(JSON.stringify(txCer, bigintReplacer));

  const hash = hashBackendJson({
    ...txCer,
    GuarGroupSignature: { R: null, S: null },
    UserSignature: { R: null, S: null },
    UserSignatureV2: { Algorithm: '', Signature: null }
  });
  signedTxCer.UserSignatureV2 = signHashEnvelope(AlgorithmECDSAP256, hash, accountPrivateKeyHex);

  return signedTxCer;
}


// ============================================================================
// 鍏挜宸ュ叿鍑芥暟
// ============================================================================

/**
 * 浠庣閽ヨ幏鍙栧叕閽?
 * 
 * @param privateKeyHex 绉侀挜锛坔ex 鏍煎紡锛?
 * @returns PublicKeyNew
 */
export function getPublicKeyFromPrivate(privateKeyHex: string): PublicKeyNew {
  const key = ec.keyFromPrivate(privateKeyHex, 'hex');
  const pubPoint = key.getPublic();
  return {
    CurveName: 'P256',
    X: BigInt('0x' + pubPoint.getX().toString(16)),
    Y: BigInt('0x' + pubPoint.getY().toString(16))
  };
}

/**
 * 灏?PublicKeyNew 杞崲涓?JSON 鏍煎紡
 * 
 * @param pubKey PublicKeyNew
 * @returns PublicKeyNewJSON
 */
export function publicKeyToJSON(pubKey: PublicKeyNew): PublicKeyNewJSON {
  return {
    CurveName: pubKey.CurveName,
    X: pubKey.X.toString(10),  // 杞负鍗佽繘鍒跺瓧绗︿覆
    Y: pubKey.Y.toString(10)   // 杞负鍗佽繘鍒跺瓧绗︿覆
  };
}

/**
 * 灏?hex 鏍煎紡鍏挜杞崲涓?JSON 鏍煎紡
 * 
 * @param pubXHex 鍏挜 X 鍧愭爣锛坔ex 鏍煎紡锛?
 * @param pubYHex 鍏挜 Y 鍧愭爣锛坔ex 鏍煎紡锛?
 * @returns PublicKeyNewJSON
 */
export function hexToPublicKeyJSON(pubXHex: string, pubYHex: string): PublicKeyNewJSON {
  // 澶勭悊绌哄瓧绗︿覆鎯呭喌锛堢敤浜?IsPayForGas 杈撳嚭绛変笉闇€瑕佸叕閽ョ殑鍦烘櫙锛?
  const xHex = pubXHex || '0';
  const yHex = pubYHex || '0';

  const x = BigInt('0x' + xHex.replace(/^0x/i, ''));
  const y = BigInt('0x' + yHex.replace(/^0x/i, ''));
  return {
    CurveName: 'P256',
    X: x.toString(10),  // 杞负鍗佽繘鍒跺瓧绗︿覆
    Y: y.toString(10)   // 杞负鍗佽繘鍒跺瓧绗︿覆
  };
}

/**
 * 灏?EcdsaSignature 杞崲涓?JSON 鏍煎紡
 * 
 * @param sig EcdsaSignature
 * @returns EcdsaSignatureJSON
 */
export function signatureToJSON(sig: EcdsaSignature): EcdsaSignatureJSON {
  return {
    R: sig.R.toString(10),  // 杞负鍗佽繘鍒跺瓧绗︿覆
    S: sig.S.toString(10)   // 杞负鍗佽繘鍒跺瓧绗︿覆
  };
}

function normalizeAddress(address: string): string {
  return String(address || '').trim().toLowerCase();
}

function toSignaturePublicKey(publicKey: unknown): SignaturePublicKey {
  const raw = (publicKey && typeof publicKey === 'object') ? publicKey as Record<string, unknown> : {};
  return {
    CurveName: String(raw.CurveName || 'P256'),
    X: String(raw.X || '0'),
    Y: String(raw.Y || '0')
  };
}

function getOutputHashCompat(output: TXOutput): number[] {
  const normalizedOutput: Record<string, unknown> = {
    ...output,
    SeedAnchor: output.SeedAnchor || []
  };
  return hashBackendJson(normalizedOutput);
}

function getAddressPrivateKey(address: string, walletData: Record<string, AddressData>): string {
  const normalized = normalizeAddress(address);
  return walletData[normalized]?.privHex || walletData[address]?.privHex || '';
}

function getAddressSpendBlockReason(
  address: string,
  addrData: AddressData | undefined,
  options: { requireRegistration?: boolean } = {}
): string | null {
  if (!addrData) return `Address ${address.slice(0, 16)}... is missing wallet metadata`;
  if (addrData.readOnly) return `Address ${address.slice(0, 16)}... is read-only`;
  if (addrData.seedRepairRequired) return `Address ${address.slice(0, 16)}... requires local seed repair`;
  if (addrData.pendingSeedStep || addrData.pendingNextSeedStep) {
    return `Address ${address.slice(0, 16)}... has an unconfirmed seed step`;
  }
  if (!addrData.privHex) return `Address ${address.slice(0, 16)}... private key is locked or missing`;
  if (!addrData.signPublicKeyV2) return `Address ${address.slice(0, 16)}... is missing SignPublicKeyV2`;
  if (!addrData.seedAnchor || Number(addrData.seedChainStep || 0) <= 0) {
    return `Address ${address.slice(0, 16)}... is missing seed metadata`;
  }
  if (!String(addrData.defaultSpendAlgorithm || '').trim()) {
    return `Address ${address.slice(0, 16)}... is missing DefaultSpendAlgorithm`;
  }
  if (options.requireRegistration && addrData.registrationState !== 'registered') {
    return `Retail address ${address.slice(0, 16)}... is not registered`;
  }
  return null;
}

function assertAddressSpendable(
  address: string,
  addrData: AddressData | undefined,
  options: { requireRegistration?: boolean } = {}
): void {
  const reason = getAddressSpendBlockReason(address, addrData, options);
  if (reason) throw new Error(reason);
}

function getAddressSeedStateForOutput(address: string, walletData: Record<string, AddressData>): {
  seedAnchor: number[] | string;
  seedChainStep: number;
  defaultSpendAlgorithm: string;
} {
  const normalized = normalizeAddress(address);
  const addrData = walletData[normalized] || walletData[address];
  const blockReason = getAddressSpendBlockReason(address, addrData, { requireRegistration: false });
  if (blockReason) throw new Error(blockReason);
  if (!addrData?.seedAnchor || !addrData?.seedChainStep) {
    throw new Error(`Address ${address.slice(0, 16)}... is missing local seed metadata`);
  }
  return {
    seedAnchor: addrData.seedAnchor,
    seedChainStep: Number(addrData.seedChainStep),
    defaultSpendAlgorithm: addrData.defaultSpendAlgorithm || AlgorithmECDSAP256
  };
}

function resolveRecipientSeedStateForOutput(
  recipient: {
    address: string;
    seedAnchor?: number[] | string;
    seedChainStep?: number;
    defaultSpendAlgorithm?: string;
  },
  walletData: Record<string, AddressData>
): {
  seedAnchor?: number[] | string;
  seedChainStep: number;
  defaultSpendAlgorithm: string;
} {
  if (recipient.seedAnchor && Number(recipient.seedChainStep || 0) > 0) {
    return {
      seedAnchor: recipient.seedAnchor,
      seedChainStep: Number(recipient.seedChainStep),
      defaultSpendAlgorithm: recipient.defaultSpendAlgorithm || AlgorithmECDSAP256
    };
  }
  const normalized = normalizeAddress(recipient.address);
  const addrData = walletData[normalized] || walletData[recipient.address];
  if (addrData?.seedAnchor && Number(addrData.seedChainStep || 0) > 0) {
    return {
      seedAnchor: addrData.seedAnchor,
      seedChainStep: Number(addrData.seedChainStep),
      defaultSpendAlgorithm: addrData.defaultSpendAlgorithm || AlgorithmECDSAP256
    };
  }
  return {
    seedAnchor: undefined,
    seedChainStep: 0,
    defaultSpendAlgorithm: recipient.defaultSpendAlgorithm || AlgorithmECDSAP256
  };
}

function getReferencedOutputForUTXO(utxoData: UTXOData): TXOutput | null {
  const position = utxoData?.Position;
  const indexZ = position?.IndexZ ?? 0;
  const outputs = utxoData?.UTXO?.TXOutputs || [];
  if (indexZ < 0 || indexZ >= outputs.length) {
    return null;
  }
  return outputs[indexZ] as TXOutput;
}

function buildSeedSweepSelection(
  address: string,
  utxoKey: string,
  utxoData: UTXOData,
  walletData: Record<string, AddressData>
): Array<{
  address: string;
  utxoKey: string;
  utxoData: UTXOData;
  coinType: number;
}> | null {
  const normalizedAddress = normalizeAddress(address);
  const addrData = walletData[normalizedAddress] || walletData[address];
  if (!addrData) {
    return null;
  }

  const baseOutput = getReferencedOutputForUTXO(utxoData);
  const baseStep = Number(baseOutput?.SeedChainStep || 0);
  const coinType = Number(addrData.type || utxoData.Type || 0);

  if (!baseOutput?.SeedAnchor || baseStep <= 0) {
    return [{
      address: normalizedAddress,
      utxoKey,
      utxoData,
      coinType
    }];
  }

  const group: Array<{
    address: string;
    utxoKey: string;
    utxoData: UTXOData;
    coinType: number;
  }> = [];

  for (const [candidateKey, candidateData] of Object.entries(addrData.utxos || {})) {
    if (!candidateData || candidateData.Value <= 0) {
      continue;
    }
    const candidateOutput = getReferencedOutputForUTXO(candidateData);
    const candidateStep = Number(candidateOutput?.SeedChainStep || 0);
    if (!candidateOutput?.SeedAnchor || candidateStep !== baseStep) {
      continue;
    }
    if (!backendBytesEqual(candidateOutput.SeedAnchor, baseOutput.SeedAnchor)) {
      continue;
    }
    if (candidateKey !== utxoKey && isUtxoLockedAnyFormat(candidateKey)) {
      return null;
    }
    group.push({
      address: normalizedAddress,
      utxoKey: candidateKey,
      utxoData: candidateData,
      coinType
    });
  }

  if (group.length === 0) {
    return [{
      address: normalizedAddress,
      utxoKey,
      utxoData,
      coinType
    }];
  }

  return group;
}

function recoverSeedStateForSpend(address: string, addrData: AddressData, referencedOutput: TXOutput) {
  const normalizedAddress = normalizeAddress(address);
  const seedStep = Number(referencedOutput.SeedChainStep || 0);
  if (!referencedOutput.SeedAnchor || seedStep <= 0) {
    throw new Error(`Address ${address.slice(0, 16)}... is missing valid seed metadata`);
  }
  const chainLength = Number(addrData.seedLocalState?.chainLength || DefaultSeedChainLength) || DefaultSeedChainLength;
  const attemptedPrivKeys: string[] = [];

  const tryRecover = (privHex: string) => {
    const normalized = String(privHex || '').trim();
    if (!normalized) {
      return null;
    }
    attemptedPrivKeys.push(normalized);
    try {
      return recoverDeterministicSeedChainStateFromPrivateKey(
        normalized,
        chainLength,
        seedStep,
        referencedOutput.SeedAnchor
      );
    } catch (error) {
      return { error };
    }
  };

  const directResult = tryRecover(addrData?.privHex || '');
  if (directResult && !('error' in directResult)) {
    return directResult;
  }

  const addressType = Number(addrData?.type ?? referencedOutput.Type ?? 0) || 0;
  if (addrData?.addressRootSeedHex) {
    const candidateTypes = [addressType, 0, 1, 2].filter((value, index, array) => array.indexOf(value) === index);
    for (const candidateType of candidateTypes) {
      const derivedCandidate = deriveAddressKeypairFromAddressRootSeed(addrData.addressRootSeedHex, candidateType);
      const candidateAddress = normalizeAddress(derivedCandidate.address);
      const rootSeedResult = tryRecover(derivedCandidate.privHex);
      if (rootSeedResult && !('error' in rootSeedResult)) {
        if ((addrData.privHex || '') !== derivedCandidate.privHex) {
          console.warn(`[浜ゆ槗鏋勯€燷 鍦板潃 ${address.slice(0, 16)}... 鐨勭紦瀛樼閽ヤ笌 AddressRootSeed 娲剧敓缁撴灉涓嶄竴鑷达紝宸蹭娇鐢?root-seed 娲剧敓绉侀挜鎭㈠ seed state`);
        }
        if (candidateType !== addressType && candidateAddress === normalizedAddress) {
          console.warn(`[浜ゆ槗鏋勯€燷 鍦板潃 ${address.slice(0, 16)}... 鐨勬湰鍦板竵绉嶇被鍨嬩负 ${addressType}锛屼絾 AddressRootSeed 鏇村尮閰?type=${candidateType}锛屽凡鑷姩閲囩敤鍖归厤绫诲瀷鎭㈠`);
        }
        return rootSeedResult;
      }
      if (candidateAddress === normalizedAddress && rootSeedResult && 'error' in rootSeedResult) {
        console.warn(`[浜ゆ槗鏋勯€燷 鍦板潃 ${address.slice(0, 16)}... 鐨?AddressRootSeed 宸插尮閰嶅綋鍓嶅湴鍧€锛屼絾 seed 鎭㈠浠嶅け璐?`, rootSeedResult.error);
      }
    }
  }

  const lastError = directResult && 'error' in directResult
    ? directResult.error
    : new Error(`鍦板潃 ${address.slice(0, 16)}... 缂哄皯绉侀挜`);
  const attempted = attemptedPrivKeys.length > 0 ? `; attempted keys=${attemptedPrivKeys.length}` : '';
  throw new Error(`${lastError instanceof Error ? lastError.message : String(lastError)}${attempted}`);
}

// ============================================================================
// UTXO 閫夋嫨
// ============================================================================

/**
 * 閫夋嫨 UTXO 浠ユ弧瓒宠浆璐﹂渶姹?
 * 
 * @param addresses 鍙敤鍦板潃鍒楄〃
 * @param walletData 閽卞寘鏁版嵁
 * @param requiredAmounts 鍚勫竵绉嶉渶瑕佺殑閲戦
 * @returns 閫変腑鐨?UTXO 鍒楄〃
 */
function selectUTXOs(
  addresses: string[],
  walletData: Record<string, AddressData>,
  requiredAmounts: Record<number, number>,
  options: { requireRegistration?: boolean } = {}
): Array<{
  address: string;
  utxoKey: string;
  utxoData: UTXOData;
  coinType: number;
}> {
  const selected: Array<{
    address: string;
    utxoKey: string;
    utxoData: UTXOData;
    coinType: number;
  }> = [];
  const consumedKeys = new Set<string>();

  // 鎸夊竵绉嶇粺璁″凡鏀堕泦閲戦
  const collected: Record<number, number> = { 0: 0, 1: 0, 2: 0 };

  console.log('[UTXO閫夋嫨] 鍙敤鍦板潃:', addresses);
  console.log('[UTXO閫夋嫨] 闇€瑕侀噾棰?', requiredAmounts);
  console.log('[UTXO閫夋嫨] 閽卞寘鏁版嵁鍦板潃鍒楄〃:', Object.keys(walletData));

  for (const address of addresses) {
    const addrData = walletData[address];
    if (!addrData) {
      console.warn('[UTXO閫夋嫨] 鍦板潃涓嶅瓨鍦ㄤ簬閽卞寘鏁版嵁涓?', address.slice(0, 16) + '...');
      continue;
    }

    const coinType = addrData.type || 0;
    const utxos = addrData.utxos || {};
    const utxoKeys = Object.keys(utxos);

    console.log(`[UTXO閫夋嫨] 鍦板潃 ${address.slice(0, 16)}...`);
    console.log(`  - 甯佺: ${coinType}`);
    console.log(`  - UTXO 鏁伴噺: ${utxoKeys.length}`);
    console.log(`  - 鏈夌閽? ${!!addrData.privHex}`);

    // 妫€鏌ヨ甯佺鏄惁杩橀渶瑕佹洿澶?
    const needed = requiredAmounts[coinType] || 0;
    if (collected[coinType] >= needed) {
      console.log(`  - 甯佺 ${coinType} 宸叉弧瓒抽渶姹傦紝璺宠繃`);
      continue;
    }
    assertAddressSpendable(address, addrData, options);

    // 閬嶅巻璇ュ湴鍧€鐨?UTXO
    for (const [utxoKey, utxoData] of Object.entries(utxos)) {
      if (consumedKeys.has(utxoKey)) continue;
      if (isUtxoLockedAnyFormat(utxoKey)) {
        console.log(`  - UTXO ${utxoKey.slice(0, 16)}... is locked, skipped`);
        continue;
      }
      if (!utxoData) {
        console.log(`  - UTXO ${utxoKey}: 鏁版嵁涓虹┖`);
        continue;
      }

      if (utxoData.Value <= 0) {
        console.log(`  - UTXO ${utxoKey}: 閲戦涓?鎴栬礋鏁?(${utxoData.Value})`);
        continue;
      }

      // 妫€鏌?UTXO 鏁版嵁瀹屾暣鎬?
      const hasUTXO = !!utxoData.UTXO;
      const hasTXOutputs = !!(utxoData.UTXO?.TXOutputs?.length);

      console.log(`  - UTXO ${utxoKey.slice(0, 16)}...:`);
      console.log(`    - 閲戦: ${utxoData.Value}`);
      console.log(`    - 鏈?UTXO 瀛楁: ${hasUTXO}`);
      console.log(`    - 鏈?TXOutputs: ${hasTXOutputs}`);
      console.log(`    - Position: ${JSON.stringify(utxoData.Position)}`);

      if (!hasUTXO || !hasTXOutputs) {
        console.warn(`  - UTXO ${utxoKey.slice(0, 16)}... 鏁版嵁涓嶅畬鏁达紝璺宠繃`);
        continue;
      }

      const sweepGroup = buildSeedSweepSelection(address, utxoKey, utxoData, walletData);
      if (!sweepGroup) {
        console.log(`  - UTXO ${utxoKey.slice(0, 16)}... 鎵€鍦?seed step 宸茶閮ㄥ垎閿佸畾锛岃烦杩囨暣涓?step`);
        continue;
      }

      console.log(`  - 閫変腑 seed 缁? ${sweepGroup.map(item => item.utxoKey.slice(0, 16) + '...').join(', ')}`);
      for (const item of sweepGroup) {
        if (consumedKeys.has(item.utxoKey)) continue;
        selected.push(item);
        consumedKeys.add(item.utxoKey);
        collected[item.coinType] += item.utxoData.Value;
      }

      // 妫€鏌ユ槸鍚﹀凡婊¤冻闇€姹?
      if (collected[coinType] >= needed) break;
    }
  }

  console.log('[UTXO閫夋嫨] 鏈€缁堟敹闆?', collected);
  console.log('[UTXO閫夋嫨] 閫変腑 UTXO 鏁伴噺:', selected.length);

  // 楠岃瘉鏄惁婊¤冻鎵€鏈夐渶姹?
  for (const [coinTypeStr, needed] of Object.entries(requiredAmounts)) {
    const coinType = Number(coinTypeStr);
    if (needed > 0 && collected[coinType] < needed) {
      const errMsg = `浣欓涓嶈冻锛氶渶瑕?${needed} 绫诲瀷${coinType}锛屽彧鏈?${collected[coinType]}`;
      console.error('[UTXO閫夋嫨]', errMsg);
      throw new Error(errMsg);
    }
  }

  return selected;
}

/**
 * 閫夋嫨 UTXO锛堜笉鎶涘嚭閿欒锛屽敖鍙兘澶氭敹闆嗭級
 * 
 * 鐢ㄤ簬 TXCer 琛ヨ冻鍦烘櫙锛屽嵆浣?UTXO 涓嶈冻涔熶笉鎶ラ敊
 * 
 * @param addresses 鍙敤鍦板潃鍒楄〃
 * @param walletData 閽卞寘鏁版嵁
 * @param requiredAmounts 鍚勫竵绉嶉渶瑕佺殑閲戦
 * @returns 閫変腑鐨?UTXO 鍒楄〃
 */
function selectUTXOsPartial(
  addresses: string[],
  walletData: Record<string, AddressData>,
  requiredAmounts: Record<number, number>,
  options: { requireRegistration?: boolean } = {}
): Array<{
  address: string;
  utxoKey: string;
  utxoData: UTXOData;
  coinType: number;
}> {
  const selected: Array<{
    address: string;
    utxoKey: string;
    utxoData: UTXOData;
    coinType: number;
  }> = [];
  const consumedKeys = new Set<string>();

  // 鎸夊竵绉嶇粺璁″凡鏀堕泦閲戦
  const collected: Record<number, number> = { 0: 0, 1: 0, 2: 0 };

  for (const address of addresses) {
    const addrData = walletData[address];
    if (!addrData) continue;

    const coinType = addrData.type || 0;
    const utxos = addrData.utxos || {};

    // 妫€鏌ヨ甯佺鏄惁杩橀渶瑕佹洿澶?
    const needed = requiredAmounts[coinType] || 0;
    if (collected[coinType] >= needed) continue;
    assertAddressSpendable(address, addrData, options);

    // 閬嶅巻璇ュ湴鍧€鐨?UTXO
    for (const [utxoKey, utxoData] of Object.entries(utxos)) {
      if (consumedKeys.has(utxoKey)) continue;
      if (isUtxoLockedAnyFormat(utxoKey)) continue;
      if (!utxoData || utxoData.Value <= 0) continue;
      if (!utxoData.UTXO || !utxoData.UTXO.TXOutputs?.length) continue;

      const sweepGroup = buildSeedSweepSelection(address, utxoKey, utxoData, walletData);
      if (!sweepGroup) continue;
      for (const item of sweepGroup) {
        if (consumedKeys.has(item.utxoKey)) continue;
        selected.push(item);
        consumedKeys.add(item.utxoKey);
        collected[item.coinType] += item.utxoData.Value;
      }
      if (collected[coinType] >= needed) break;
    }
  }

  // 涓嶉獙璇佹槸鍚︽弧瓒抽渶姹傦紝鐩存帴杩斿洖宸叉敹闆嗙殑
  return selected;
}


// ============================================================================
// 涓绘瀯閫犲嚱鏁?
// ============================================================================

/**
 * 鏋勫缓蹇€熻浆璐︿氦鏄?
 * 
 * 瀹屾暣娴佺▼锛?
 * 1. 閫夋嫨 UTXO
 * 2. 鏋勯€?TXInputNormal锛堝寘鍚?InputSignature锛?
 * 3. 鏋勯€?TXOutput
 * 4. 鏋勯€?Transaction
 * 5. 璁＄畻 TXID
 * 6. 鏋勯€?UserNewTX 骞剁鍚?
 * 
 * @param params 鏋勫缓鍙傛暟
 * @param user 鐢ㄦ埛鏁版嵁
 * @returns UserNewTX
 */
export async function buildTransaction(
  params: BuildTransactionParams,
  user: User
): Promise<UserNewTX> {
  console.log('[浜ゆ槗鏋勯€燷 寮€濮嬫瀯寤轰氦鏄?..');
  console.log('[浜ゆ槗鏋勯€燷 鍙傛暟:', JSON.stringify(params, null, 2));

  const {
    fromAddresses,
    recipients,
    changeAddresses,
    gas,
    isCrossChain = false,
    howMuchPayForGas = 0,
    preferTXCer = false
  } = params;

  // 鑾峰彇閽卞寘鏁版嵁
  const walletData = user.wallet?.addressMsg || {};
  const guarGroupID = user.orgNumber || user.guarGroup?.groupID || '';
  const userID = user.accountId || '';

  console.log('[浜ゆ槗鏋勯€燷 鐢ㄦ埛ID:', userID);
  console.log('[浜ゆ槗鏋勯€燷 鎷呬繚缁勭粐ID:', guarGroupID);
  console.log('[浜ゆ槗鏋勯€燷 閽卞寘鍦板潃鏁伴噺:', Object.keys(walletData).length);
  console.log('[浜ゆ槗鏋勯€燷 鍙戦€佸湴鍧€:', fromAddresses);

  if (!guarGroupID) {
    throw new Error('User is not in a guarantor group');
  }

  if (!userID) {
    throw new Error('User ID is missing');
  }

  // 鑾峰彇璐︽埛绉侀挜
  const accountPrivKey = user.keys?.privHex || user.privHex || '';
  if (!accountPrivKey) {
    throw new Error('Account private key is missing');
  }
  console.log('[浜ゆ槗鏋勯€燷 璐︽埛绉侀挜瀛樺湪:', !!accountPrivKey);

  // ========== Step 1: 璁＄畻鍚勫竵绉嶉渶瑕佺殑閲戦 ==========
  const requiredAmounts: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
  for (const recipient of recipients) {
    requiredAmounts[recipient.coinType] = (requiredAmounts[recipient.coinType] || 0) + recipient.amount;
  }

  // 棰濆鍏戞崲 Gas 鐨?PGC 涔熼渶瑕佷粠 UTXO 涓墸闄わ紙甯佺 0 = PGC锛?
  if (howMuchPayForGas > 0) {
    requiredAmounts[0] += howMuchPayForGas;
    console.log('[浜ゆ槗鏋勯€燷 鍖呭惈棰濆 Gas 鍏戞崲:', howMuchPayForGas, 'PGC');
  }

  console.log('[浜ゆ槗鏋勯€燷 闇€瑕侀噾棰?', requiredAmounts);

  // ========== Step 2: 閫夋嫨 UTXO 鍜?TXCer ==========
  console.log('[浜ゆ槗鏋勯€燷 寮€濮嬮€夋嫨 UTXO...');

  // 鍏堝皾璇曚粎浣跨敤 UTXO锛堟垨鎸?preferTXCer 瑙勫垯浼樺厛浣跨敤 TXCer锛?
  let selectedUTXOs: Array<{
    address: string;
    utxoKey: string;
    utxoData: UTXOData;
    coinType: number;
  }> = [];

  let selectedTXCers: Array<{
    txCerId: string;
    txCer: TxCertificate;
    address: string;
  }> = [];

  let txType = 0; // 0 = 鏅€氳浆璐︼紝1 = 浣跨敤浜?TXCer

  const buildAvailableTXCers = (): Array<{ txCerId: string; txCer: TxCertificate; address: string; value: number }> => {
    const availableTXCers: Array<{ txCerId: string; txCer: TxCertificate; address: string; value: number }> = [];
    for (const address of fromAddresses) {
      const addrData = walletData[address];
      if (!addrData) continue;
      if ((addrData.type || 0) !== 0) continue; // TXCer only for main currency
      const txCerIds = addrData.txCers || {};
      const totalTXCers = user.wallet?.totalTXCers || {};
      for (const [txCerId, value] of Object.entries(txCerIds)) {
        const txCer = totalTXCers[txCerId];
        if (txCer && typeof value === 'number' && value > 0) {
          availableTXCers.push({ txCerId, txCer, address, value });
        }
      }
    }
    console.log('[浜ゆ槗鏋勯€燷 鍙敤 TXCer 鏁伴噺:', availableTXCers.length);
    return availableTXCers;
  };

  const selectTXCersForMainCurrency = (
    availableTXCers: Array<{ txCerId: string; txCer: TxCertificate; address: string; value: number }>,
    needed: number
  ) => {
    let remainingNeeded = needed;
    for (const txCerInfo of availableTXCers) {
      if (remainingNeeded <= 0) break;
      selectedTXCers.push({ txCerId: txCerInfo.txCerId, txCer: txCerInfo.txCer, address: txCerInfo.address });
      remainingNeeded -= txCerInfo.value;
      console.log('[浜ゆ槗鏋勯€燷 閫変腑 TXCer:', txCerInfo.txCerId.slice(0, 8) + '...', '閲戦:', txCerInfo.value);
    }
    return remainingNeeded;
  };

  if (preferTXCer) {
    console.log('[浜ゆ槗鏋勯€燷 preferTXCer=true锛屼富甯佺浼樺厛浣跨敤 TXCer');
    if (isCrossChain) {
      throw new Error('璺ㄩ摼浜ゆ槗涓嶈兘浣跨敤 TXCer');
    }
    const availableTXCers = buildAvailableTXCers();
    const mainCurrencyNeeded = requiredAmounts[0] || 0;
    const remainingMain = selectTXCersForMainCurrency(availableTXCers, mainCurrencyNeeded);

    const requiredAfterTXCer: Record<number, number> = { ...requiredAmounts };
    requiredAfterTXCer[0] = Math.max(0, remainingMain);

    // 涓诲竵绉嶄粛涓嶈冻锛屾垨鑰呭瓨鍦ㄩ潪涓诲竵绉嶉渶姹傦紝鍒欒ˉ鍏呴€夋嫨 UTXO
    if (requiredAfterTXCer[0] > 0 || (requiredAfterTXCer[1] || 0) > 0 || (requiredAfterTXCer[2] || 0) > 0) {
      try {
        selectedUTXOs = selectUTXOs(fromAddresses, walletData, requiredAfterTXCer);
      } catch {
        selectedUTXOs = selectUTXOsPartial(fromAddresses, walletData, requiredAfterTXCer);
      }
    }

    // 鏍￠獙涓诲竵绉嶆槸鍚﹁冻澶燂紙UTXO+TXCer锛?
    let mainCollected = 0;
    for (const { utxoData, coinType } of selectedUTXOs) {
      if (coinType === 0) mainCollected += utxoData.Value;
    }
    let txCerCollected = 0;
    for (const { txCer } of selectedTXCers) txCerCollected += txCer.Value;
    const stillNeed = mainCurrencyNeeded - (mainCollected + txCerCollected);
    if (stillNeed > 0.00000001) {
      throw new Error(`Insufficient balance: UTXO + TXCer still missing ${stillNeed.toFixed(4)} main coin`);
    }

    if (selectedTXCers.length > 0) {
      txType = 1;
      console.log('[浜ゆ槗鏋勯€燷 preferTXCer 妯″紡锛歍XType 璁句负 1');
    }
  } else {
    try {
      selectedUTXOs = selectUTXOs(fromAddresses, walletData, requiredAmounts);
      console.log('[浜ゆ槗鏋勯€燷 UTXO 瓒冲锛岄€変腑鏁伴噺:', selectedUTXOs.length);
    } catch (utxoError) {
      // UTXO 涓嶈冻锛屽皾璇曚娇鐢?TXCer 琛ヨ冻锛堜粎涓昏揣甯侊級
      console.log('[浜ゆ槗鏋勯€燷 UTXO 涓嶈冻锛屽皾璇曚娇鐢?TXCer 琛ヨ冻...');

      // 妫€鏌ユ潯浠讹細TXCer 鍙兘鐢ㄤ簬涓昏揣甯侊紙type=0锛夛紝涓斾笉鑳界敤浜庤川鎶间氦鏄撳拰璺ㄩ摼浜ゆ槗
      if (isCrossChain) {
        throw new Error('璺ㄩ摼浜ゆ槗涓嶈兘浣跨敤 TXCer');
      }

      // 妫€鏌ユ槸鍚﹀彧娑夊強涓昏揣甯?
      const hasNonMainCurrency = [1, 2].some(t => (requiredAmounts[t] || 0) > 0);
      if (hasNonMainCurrency) {
        // 闈炰富璐у竵浜ゆ槗锛岄噸鏂版姏鍑?UTXO 涓嶈冻閿欒
        throw utxoError;
      }

      const availableTXCers = buildAvailableTXCers();

      // 閲嶆柊灏濊瘯閫夋嫨 UTXO锛堜笉鎶涘嚭閿欒锛?
      try {
        selectedUTXOs = selectUTXOs(fromAddresses, walletData, requiredAmounts);
      } catch {
        // 蹇界暐閿欒锛宻electedUTXOs 淇濇寔涓虹┖鏁扮粍
        selectedUTXOs = selectUTXOsPartial(fromAddresses, walletData, requiredAmounts);
      }

      // 璁＄畻 UTXO 宸叉敹闆嗙殑閲戦
      let utxoCollected = 0;
      for (const { utxoData, coinType } of selectedUTXOs) {
        if (coinType === 0) {
          utxoCollected += utxoData.Value;
        }
      }

      // 璁＄畻杩橀渶瑕佸灏戜富璐у竵
      const mainCurrencyNeeded = requiredAmounts[0] || 0;
      let remainingNeeded = mainCurrencyNeeded - utxoCollected;

      console.log('[浜ゆ槗鏋勯€燷 UTXO 宸叉敹闆?', utxoCollected, '杩橀渶:', remainingNeeded);

      remainingNeeded = selectTXCersForMainCurrency(availableTXCers, remainingNeeded);

      if (remainingNeeded > 0.00000001) {
        throw new Error(`Insufficient balance: UTXO + TXCer still missing ${remainingNeeded.toFixed(4)} main coin`);
      }

      // 鏍囪涓轰娇鐢ㄤ簡 TXCer
      if (selectedTXCers.length > 0) {
        txType = 1;
        console.log('[浜ゆ槗鏋勯€燷 灏嗕娇鐢?TXCer 琛ヨ冻锛孴XType 璁句负 1');
      }
    }
  }
  console.log('[浜ゆ槗鏋勯€燷 閫変腑 UTXO 鏁伴噺:', selectedUTXOs.length);
  console.log('[浜ゆ槗鏋勯€燷 閫変腑 TXCer 鏁伴噺:', selectedTXCers.length);

  // 璁＄畻鍚勫竵绉嶆敹闆嗙殑鎬婚锛堝寘鍚?TXCer锛?
  const collectedAmounts: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
  for (const { utxoData, coinType } of selectedUTXOs) {
    collectedAmounts[coinType] += utxoData.Value;
  }
  // TXCer 鍙兘鏄富璐у竵
  for (const { txCer } of selectedTXCers) {
    collectedAmounts[0] += txCer.Value;
  }
  console.log('[浜ゆ槗鏋勯€燷 鏀堕泦閲戦锛堝惈TXCer锛?', collectedAmounts);

  const advancedOutputMeta = new Map<string, {
    seedAnchor: number[] | string;
    seedChainStep: number;
    defaultSpendAlgorithm: string;
  }>();

  for (const { address, utxoData } of selectedUTXOs) {
    const normalizedAddress = normalizeAddress(address);
    if (advancedOutputMeta.has(normalizedAddress)) {
      continue;
    }
    const addrData = walletData[normalizedAddress] || walletData[address];
    if (!addrData?.privHex) {
      continue;
    }
    const position = utxoData.Position;
    const referencedOutput = utxoData.UTXO?.TXOutputs?.[position?.IndexZ || 0] as TXOutput | undefined;
    if (!referencedOutput?.SeedAnchor || !referencedOutput?.SeedChainStep) {
      continue;
    }
    const spendState = recoverSeedStateForSpend(normalizedAddress, addrData, referencedOutput);
    if (spendState.step <= 1) {
      throw new Error(`Address ${normalizedAddress.slice(0, 16)}... seed chain is exhausted`);
    }
    advancedOutputMeta.set(normalizedAddress, {
      seedAnchor: nextAnchor(spendState),
      seedChainStep: spendState.step - 1,
      defaultSpendAlgorithm: addrData.defaultSpendAlgorithm || AlgorithmECDSAP256
    });
  }

  // ========== Step 3: 鏋勯€?TXOutput ==========
  const txOutputs: TXOutput[] = [];

  // 3.1 鏀舵杈撳嚭
  for (const recipient of recipients) {
    const recipientSeedMeta = isCrossChain
      ? { seedAnchor: [], seedChainStep: 0, defaultSpendAlgorithm: '' }
      : resolveRecipientSeedStateForOutput(recipient, walletData);
    if (!isCrossChain && (!recipientSeedMeta.seedAnchor || !recipientSeedMeta.seedChainStep)) {
      throw new Error(`Recipient ${recipient.address.slice(0, 16)}... is missing seed metadata`);
    }
    txOutputs.push({
      ToAddress: recipient.address,
      ToValue: recipient.amount,
      ToGuarGroupID: recipient.guarGroupID,
      ToPublicKey: convertHexToPublicKey(recipient.publicKeyX, recipient.publicKeyY) as unknown as PublicKeyNewJSON,
      ToInterest: recipient.interest || 0,
      Type: recipient.coinType,
      ToPeerID: '',
      IsPayForGas: false,
      // 鈿狅笍 閲嶈锛氬瓧娈甸『搴忓繀椤讳笌 Go 缁撴瀯浣撲竴鑷达紙IsCrossChain 鍦?IsGuarMake 鍓嶏級
      IsCrossChain: isCrossChain,
      IsGuarMake: false,
      SeedAnchor: isCrossChain ? [] : recipientSeedMeta.seedAnchor,
      SeedChainStep: isCrossChain ? 0 : recipientSeedMeta.seedChainStep,
      DefaultSpendAlgorithm: isCrossChain ? '' : recipientSeedMeta.defaultSpendAlgorithm
    });
  }

  // 3.2 鎵鹃浂杈撳嚭
  for (const [coinTypeStr, collected] of Object.entries(collectedAmounts)) {
    const coinType = Number(coinTypeStr);
    const required = requiredAmounts[coinType] || 0;
    const change = collected - required;

    if (change > 0.00000001) {  // 鏈夋壘闆?
      const changeAddr = changeAddresses[coinType];
      if (!changeAddr) {
        throw new Error(`缂哄皯甯佺 ${coinType} 鐨勬壘闆跺湴鍧€`);
      }

      const changeAddrData = walletData[changeAddr];
      if (!changeAddrData) {
        throw new Error(`Change address ${changeAddr} does not exist`);
      }

      // 鑾峰彇鎵鹃浂鍦板潃鐨勫叕閽?
      const changePubX = changeAddrData.pubXHex || '';
      const changePubY = changeAddrData.pubYHex || '';
      if (!changePubX || !changePubY) {
        throw new Error(`鎵鹃浂鍦板潃 ${changeAddr} 缂哄皯鍏挜`);
      }
      const normalizedChangeAddr = normalizeAddress(changeAddr);
      const changeSeedMeta = advancedOutputMeta.get(normalizedChangeAddr) || getAddressSeedStateForOutput(normalizedChangeAddr, walletData);

      txOutputs.push({
        ToAddress: changeAddr,
        ToValue: change,
        ToGuarGroupID: guarGroupID,
        ToPublicKey: convertHexToPublicKey(changePubX, changePubY) as unknown as PublicKeyNewJSON,
        ToInterest: 0,
        Type: coinType,
        ToPeerID: '',
        IsPayForGas: false,
        IsCrossChain: false,
        IsGuarMake: false,
        SeedAnchor: changeSeedMeta.seedAnchor,
        SeedChainStep: changeSeedMeta.seedChainStep,
        DefaultSpendAlgorithm: changeSeedMeta.defaultSpendAlgorithm
      });
    }
  }

  // 3.3 棰濆 PGC 鍏戞崲 Gas 杈撳嚭锛圛sPayForGas: true锛?
  // 鐢ㄤ簬灏嗛澶栫殑 PGC 鍏戞崲涓?Gas锛屽悗绔細灏嗘杈撳嚭閲戦鍔犲埌鍙敤鍒╂伅涓?
  if (howMuchPayForGas > 0) {
    console.log('[浜ゆ槗鏋勯€燷 鍒涘缓棰濆 Gas 杈撳嚭, 閲戦:', howMuchPayForGas);
    txOutputs.push({
      ToAddress: '',
      ToValue: howMuchPayForGas,
      ToGuarGroupID: '',
      ToPublicKey: hexToPublicKeyJSON('', ''),  // 浣跨敤绌哄瓧绗︿覆鐢熸垚闆跺€煎叕閽ワ紙涓庡叾浠栬緭鍑烘牸寮忎竴鑷达級
      ToInterest: 0,
      Type: 0, // PGC
      ToPeerID: '',
      IsPayForGas: true,  // 鍏抽敭鏍囪锛氭爣璇嗘杈撳嚭鐢ㄤ簬鏀粯 Gas
      IsCrossChain: false,
      IsGuarMake: false,
      SeedAnchor: [],
      SeedChainStep: 0,
      DefaultSpendAlgorithm: ''
    });
  }


  // ========== Step 4: 鏋勯€?TXInputNormal ==========
  console.log('[浜ゆ槗鏋勯€燷 寮€濮嬫瀯閫?TXInputNormal...');
  const txInputs: TXInputNormal[] = [];

  for (const { address, utxoKey, utxoData } of selectedUTXOs) {
    console.log(`[浜ゆ槗鏋勯€燷 澶勭悊鍦板潃 ${address.slice(0, 8)}... 鐨?UTXO`);

    // 鑾峰彇鍦板潃绉侀挜
    const addrData = walletData[address];
    const addrPrivKey = addrData?.privHex || '';
    if (!addrPrivKey) {
      const errMsg = `鍦板潃 ${address.slice(0, 16)}... 缂哄皯绉侀挜`;
      console.error('[浜ゆ槗鏋勯€燷', errMsg);
      throw new Error(errMsg);
    }
    console.log('[浜ゆ槗鏋勯€燷 鍦板潃绉侀挜瀛樺湪:', !!addrPrivKey);

    // 鑾峰彇琚紩鐢ㄧ殑 TXOutput
    const position = utxoData.Position;
    let indexZ = position?.IndexZ || 0;

    // 棰勫鐞嗭細妫€鏌?TXID 鏄惁鍖呭惈鏃ф牸寮忥紙鍖呭惈 " + IndexZ" 鍚庣紑锛?
    // 濡傛灉鏄紝闇€瑕佷粠涓彁鍙栫湡姝ｇ殑 IndexZ
    let rawTXID = utxoData.UTXO?.TXID || utxoData.TXID || '';
    if (rawTXID.includes(' + ')) {
      const parts = rawTXID.split(' + ');
      const extractedIndexZ = parseInt(parts[1]?.trim() || '0', 10);
      // 濡傛灉 Position.IndexZ 涓?0 浣?TXID 涓湁 IndexZ锛屼娇鐢?TXID 涓殑鍊?
      if (indexZ === 0 && extractedIndexZ > 0) {
        indexZ = extractedIndexZ;
        console.warn(`[浜ゆ槗鏋勯€燷 浠庢棫鏍煎紡 TXID 涓彁鍙?IndexZ: ${extractedIndexZ}`);
      }
    }

    console.log('[浜ゆ槗鏋勯€燷 UTXO Position:', JSON.stringify(position));
    console.log('[浜ゆ槗鏋勯€燷 鏈€缁堜娇鐢ㄧ殑 IndexZ:', indexZ);
    console.log('[浜ゆ槗鏋勯€燷 UTXO.UTXO 瀛樺湪:', !!utxoData.UTXO);
    console.log('[浜ゆ槗鏋勯€燷 UTXO.UTXO.TXOutputs 瀛樺湪:', !!(utxoData.UTXO?.TXOutputs));
    console.log('[浜ゆ槗鏋勯€燷 UTXO.UTXO.TXOutputs 闀垮害:', utxoData.UTXO?.TXOutputs?.length || 0);

    // [DEBUG] 鎵撳嵃瀹屾暣鐨?UTXO 鏁版嵁锛岀敤浜庤瘖鏂?TXOutputHash 涓嶅尮閰嶉棶棰?
    console.log('[浜ゆ槗鏋勯€燷 ========== UTXO 瀹屾暣鏁版嵁 ==========');
    console.log('[浜ゆ槗鏋勯€燷 UTXO Key:', utxoKey);
    console.log('[浜ゆ槗鏋勯€燷 UTXOData.Value:', utxoData.Value);
    console.log('[浜ゆ槗鏋勯€燷 UTXOData.Type:', utxoData.Type);
    console.log('[浜ゆ槗鏋勯€燷 UTXOData.UTXO.TXID:', utxoData.UTXO?.TXID);
    if (utxoData.UTXO?.TXOutputs) {
      console.log('[浜ゆ槗鏋勯€燷 TXOutputs 璇︽儏:');
      utxoData.UTXO.TXOutputs.forEach((output: any, idx: number) => {
        console.log(`[浜ゆ槗鏋勯€燷   [${idx}] ToAddress=${output.ToAddress?.slice(0, 16)}..., ToValue=${output.ToValue}, Type=${output.Type || output.ToCoinType}`);
      });
    }
    console.log('[浜ゆ槗鏋勯€燷 =====================================');

    // 妫€鏌?UTXO 鏁版嵁瀹屾暣鎬?
    if (!utxoData.UTXO) {
      const errMsg = 'UTXO data is incomplete: missing source transaction';
      console.error('[浜ゆ槗鏋勯€燷', errMsg);
      console.error('[浜ゆ槗鏋勯€燷 UTXO 鏁版嵁:', JSON.stringify(utxoData, null, 2));
      throw new Error(errMsg);
    }

    if (!utxoData.UTXO.TXOutputs || utxoData.UTXO.TXOutputs.length === 0) {
      const errMsg = `UTXO data is incomplete: missing TXOutputs, TXID=${utxoData.UTXO.TXID || 'unknown'}`;
      console.error('[浜ゆ槗鏋勯€燷', errMsg);
      console.error('[浜ゆ槗鏋勯€燷 UTXO.UTXO:', JSON.stringify(utxoData.UTXO, null, 2));
      throw new Error(errMsg);
    }

    const referencedOutput = utxoData.UTXO.TXOutputs[indexZ];

    if (!referencedOutput) {
      const errMsg = `Cannot resolve referenced UTXO output: IndexZ=${indexZ} is out of TXOutputs range (length=${utxoData.UTXO.TXOutputs.length})`;
      console.error('[浜ゆ槗鏋勯€燷', errMsg);
      throw new Error(errMsg);
    }
    console.log('[浜ゆ槗鏋勯€燷 琚紩鐢ㄧ殑 TXOutput:', JSON.stringify(referencedOutput, null, 2));

    // 鏋勯€?TXOutput 鐢ㄤ簬鍝堝笇璁＄畻
    // 澶勭悊鍏挜鏍煎紡杞崲
    const refPubKey = referencedOutput.ToPublicKey;
    let toPublicKey: PublicKeyNewJSON;
    if (refPubKey && typeof refPubKey === 'object') {
      // 灏嗗叕閽ュ潗鏍囪浆涓哄崄杩涘埗瀛楃涓?
      const xVal = (refPubKey as any).X;
      const yVal = (refPubKey as any).Y;
      toPublicKey = {
        CurveName: (refPubKey as any).CurveName || 'P256',
        X: typeof xVal === 'bigint' ? xVal.toString(10) : String(xVal || '0'),
        Y: typeof yVal === 'bigint' ? yVal.toString(10) : String(yVal || '0')
      };
    } else {
      toPublicKey = { CurveName: 'P256', X: '0', Y: '0' };
    }

    const outputForHash: TXOutput = {
      ToAddress: referencedOutput.ToAddress || '',
      ToValue: referencedOutput.ToValue || 0,
      ToGuarGroupID: referencedOutput.ToGuarGroupID || '',
      ToPublicKey: toPublicKey,
      ToInterest: referencedOutput.ToInterest || 0,
      Type: referencedOutput.Type ?? referencedOutput.ToCoinType ?? 0,
      ToPeerID: referencedOutput.ToPeerID || '',
      IsPayForGas: referencedOutput.IsPayForGas || false,
      IsCrossChain: referencedOutput.IsCrossChain || false,
      IsGuarMake: referencedOutput.IsGuarMake || false,
      SeedAnchor: referencedOutput.SeedAnchor || [],
      SeedChainStep: Number(referencedOutput.SeedChainStep || 0),
      DefaultSpendAlgorithm: referencedOutput.DefaultSpendAlgorithm || AlgorithmECDSAP256
    };
    console.log('[浜ゆ槗鏋勯€燷 鐢ㄤ簬鍝堝笇鐨?TXOutput:', outputForHash);

    // 璁＄畻 TXOutput 鍝堝笇骞剁鍚?
    const { hash, signature } = signTXOutput(outputForHash, addrPrivKey);
    const seedState = recoverSeedStateForSpend(address, addrData as AddressData, outputForHash);
    const spendArtifacts = buildSeedSpendArtifacts(hash, currentSeed(seedState));
    console.log('[浜ゆ槗鏋勯€燷 TXOutput 鍝堝笇闀垮害:', hash.length);
    console.log('[浜ゆ槗鏋勯€燷 InputSignature R:', signature.R.toString().slice(0, 20) + '...');

    // 浠?UTXO 鏁版嵁涓幏鍙栨纭殑 TXID
    // 娉ㄦ剰锛歶txoData.UTXO.TXID 搴旇鏄函 TXID锛屼笉鍖呭惈 " + IndexZ" 鍚庣紑
    // 浣嗗鏋滄棫鏁版嵁涓寘鍚簡鍚庣紑锛岄渶瑕佽嚜鍔ㄤ慨澶?
    let fromTXID = utxoData.UTXO?.TXID || utxoData.TXID || '';
    let effectiveIndexZ = indexZ;

    // 鑷姩淇锛氬鏋?TXID 鍖呭惈 " + " 鍚庣紑锛堟棫鏍煎紡缂撳瓨鏁版嵁锛夛紝闇€瑕佸垎鍓?
    if (fromTXID.includes(' + ')) {
      const parts = fromTXID.split(' + ');
      fromTXID = parts[0].trim();
      // 濡傛灉 Position.IndexZ 涓?0锛屼娇鐢ㄤ粠 TXID 涓В鏋愮殑 IndexZ
      if (indexZ === 0 && parts[1]) {
        effectiveIndexZ = parseInt(parts[1].trim(), 10);
      }
      console.warn(`[浜ゆ槗鏋勯€燷 妫€娴嬪埌鏃ф牸寮?TXID锛屽凡鑷姩淇: "${utxoData.UTXO?.TXID}" => TXID="${fromTXID}", IndexZ=${effectiveIndexZ}`);
    }

    console.log(`[浜ゆ槗鏋勯€燷 FromTXID="${fromTXID}", IndexZ=${effectiveIndexZ}`);
    console.log(`[浜ゆ槗鏋勯€燷 灏嗙敓鎴?UTXO 鏍囪瘑绗? "${fromTXID} + ${effectiveIndexZ}"`);

    txInputs.push({
      FromTXID: fromTXID,
      FromTxPosition: {
        Blocknum: position?.Blocknum || 0,
        IndexX: position?.IndexX || 0,
        IndexY: position?.IndexY || 0,
        IndexZ: effectiveIndexZ
      },
      FromAddress: address,
      IsGuarMake: false,
      IsCommitteeMake: false,
      IsCrossChain: false, // 蹇呴』涓?false锛氳繖鏄?UTXO -> Light 浜ゆ槗锛孖nput 娑堣€楃殑鏄湰鍦?UTXO锛屼笉鏄法閾鹃摳甯?
      // 鈿狅笍 閲嶈锛氬瓧娈甸『搴忓繀椤讳笌 Go 缁撴瀯浣撲竴鑷达紒
      // Go: InputSignature 鍦?TXOutputHash 鍓嶉潰
      InputSignature: signatureToJSON(signature),
      TXOutputHash: hash,
      InputSignatureV2: spendArtifacts.inputSignatureV2,
      SeedReveal: spendArtifacts.seedReveal,
      SeedPublicKeyV2: spendArtifacts.seedPublicKeyV2,
      SeedChainStep: seedState.step
    });
  }

  // ========== Step 4.5: 澶勭悊 TXCer 杈撳叆锛堝鏋滄湁锛?==========
  const txInputsCertificate: TxCertificate[] = [];

  if (selectedTXCers.length > 0) {
    console.log('[浜ゆ槗鏋勯€燷 寮€濮嬪鐞?TXCer 杈撳叆...');

    for (const { txCerId, txCer, address } of selectedTXCers) {
      console.log(`[浜ゆ槗鏋勯€燷 澶勭悊 TXCer ${txCerId.slice(0, 8)}...`);

      // 瀵?TXCer 鍋?V2 鐢ㄦ埛绛惧悕锛堣处鎴风閽ワ級
      const signedTxCer = signTXCer(txCer, accountPrivKey);
      txInputsCertificate.push(signedTxCer);

      console.log(`[浜ゆ槗鏋勯€燷 TXCer ${txCerId.slice(0, 8)}... 绛惧悕瀹屾垚`);
    }
  }

  // ========== Step 5: 鏋勯€?Transaction ==========
  // 璁＄畻鎬昏浆璐﹂噾棰濓紙鎸夋眹鐜囨崲绠楋級
  const exchangeRates: Record<number, number> = { 0: 1, 1: 1000000, 2: 1000 };
  let totalValue = 0;
  for (const [coinTypeStr, amount] of Object.entries(requiredAmounts)) {
    const coinType = Number(coinTypeStr);
    totalValue += amount * (exchangeRates[coinType] || 1);
  }
  const cleanValueDivision = Object.fromEntries(
    Object.entries(requiredAmounts).filter(([, amount]) => Number(amount) > 0)
  ) as Record<number, number>;

  // 鏋勯€犲埄鎭洖閫€鍒嗛厤
  const backAssign: Record<string, number> = {};
  if (fromAddresses.length > 0) {
    backAssign[fromAddresses[0]] = 1.0;  // 鍒╂伅鍥為€€缁欑涓€涓彂閫佸湴鍧€
  }

  const transaction: Transaction = {
    TXID: '',
    Size: 0,   // 鍚庣浼氶噸鏂拌绠?
    Version: 1.0,
    GuarantorGroup: guarGroupID,
    TXType: isCrossChain ? 6 : txType,  // 6=璺ㄩ摼, 0=鏅€氳浆璐? 1=浣跨敤浜員XCer
    Value: totalValue,
    ValueDivision: cleanValueDivision,
    NewValue: 0,
    NewValueDiv: {},
    InterestAssign: {
      Gas: gas,
      Output: recipients.reduce((sum, r) => sum + (r.interest || 0), 0),
      BackAssign: backAssign
    },
    UserSignature: { R: null, S: null },
    UserSignatureV2: { Algorithm: '', Signature: null },
    TXInputsNormal: txInputs,
    TXInputsCertificate: txInputsCertificate,
    TXOutputs: txOutputs,
    Data: []
  };

  transaction.UserSignatureV2 = signHashEnvelope(
    AlgorithmECDSAP256,
    hashBackendJson({
      ...transaction,
      TXID: '',
      Size: 0,
      NewValue: 0,
      UserSignature: { R: null, S: null },
      UserSignatureV2: { Algorithm: '', Signature: null },
      TXType: 0
    }),
    accountPrivKey
  );

  transaction.TXID = calculateTXID(transaction);
  console.log('[浜ゆ槗鏋勯€燷 TXID:', transaction.TXID);

  // ========== Step 7: 鏋勯€?UserNewTX 骞剁鍚?==========
  const userNewTX: UserNewTX = {
    TX: transaction,
    UserID: userID,
    Height: 0,  // 鍓嶇濉?0锛屽悗绔細瑕嗙洊
    Sig: { R: null, S: null }  // 鍏堢疆闆跺€?
  };

  // 浣跨敤璐︽埛绉侀挜绛惧悕锛堟帓闄?Sig 鍜?Height锛?
  const sig = signUserNewTX(userNewTX, accountPrivKey);
  userNewTX.Sig = signatureToJSON(sig);
  console.log('[浜ゆ槗鏋勯€燷 UserNewTX 绛惧悕瀹屾垚');

  return userNewTX;
}

// ============================================================================
// 搴忓垪鍖栦负鍚庣鏍煎紡
// ============================================================================

/**
 * 灏?UserNewTX 搴忓垪鍖栦负鍚庣鍙帴鍙楃殑 JSON 鏍煎紡
 * 
 * 鈿狅笍 閲嶈锛歑/Y/R/S 蹇呴』鏄?JSON number锛堜笉甯﹀紩鍙凤級
 * 
 * @param userNewTX UserNewTX 瀵硅薄
 * @returns JSON 瀛楃涓?
 */
export function serializeUserNewTX(userNewTX: UserNewTX): string {
  return serializeForBackend(userNewTX);
}

/**
 * Serialize AggregateGTX for submit (convert []byte fields to Base64).
 */
export function serializeAggregateGTX(atx: AggregateGTXForSubmit): string {
  return serializeForBackend(atx);
}

// ============================================================================
// 浜ゆ槗鐘舵€佹煡璇?
// ============================================================================

/**
 * 浜ゆ槗鐘舵€佺被鍨?
 */
export type TXStatusType = 'pending' | 'success' | 'failed' | 'not_found';

/**
 * 浜ゆ槗鐘舵€佸搷搴?
 */
export interface TXStatusResponse {
  tx_id: string;
  status: TXStatusType;
  receive_result: boolean;
  result: boolean;
  error_reason: string;
  guar_id: string;
  user_id: string;
  block_height: number;
}

/**
 * 鏌ヨ浜ゆ槗鐘舵€?
 * 
 * @param txID 浜ゆ槗ID
 * @param groupID 鎷呬繚缁勭粐ID
 * @param assignNodeUrl AssignNode URL锛堝彲閫夛級
 * @returns 浜ゆ槗鐘舵€佸搷搴?
 */
export async function queryTXStatus(
  txID: string,
  groupID: string,
  assignNodeUrl?: string
): Promise<TXStatusResponse> {
  const { API_BASE_URL, API_ENDPOINTS } = await import('./api');

  const baseUrl = assignNodeUrl || API_BASE_URL;
  const url = baseUrl + API_ENDPOINTS.ASSIGN_TX_STATUS(groupID, txID);

  console.log('[浜ゆ槗鐘舵€佹煡璇 URL:', url);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  // Treat 404 as a legitimate "not_found" state (common if the tx is dropped/rejected
  // or status indexing hasn't happened yet).
  if (response.status === 404) {
    return {
      tx_id: txID,
      status: 'not_found',
      receive_result: false,
      result: false,
      error_reason: 'transaction not found',
      guar_id: '',
      user_id: '',
      block_height: 0
    };
  }

  if (!response.ok) {
    throw new Error(`鏌ヨ浜ゆ槗鐘舵€佸け璐? ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  console.log('[浜ゆ槗鐘舵€佹煡璇 缁撴灉:', result);

  return result;
}

/**
 * 绛夊緟浜ゆ槗纭鐨勯厤缃?
 */
export interface WaitForConfirmationOptions {
  /** 杞闂撮殧锛堟绉掞級锛岄粯璁?2000 */
  pollInterval?: number;
  /** 鏈€澶х瓑寰呮椂闂达紙姣锛夛紝榛樿 60000 */
  maxWaitTime?: number;
  /** 鐘舵€佸彉鍖栧洖璋?*/
  onStatusChange?: (status: TXStatusResponse) => void;
  minBlockHeight?: number;
}

/**
 * 绛夊緟浜ゆ槗纭缁撴灉
 */
export interface WaitForConfirmationResult {
  /** 鏄惁鎴愬姛 */
  success: boolean;
  /** 鏈€缁堢姸鎬?*/
  status: TXStatusType;
  /** 閿欒鍘熷洜锛堝鏋滃け璐ワ級 */
  errorReason?: string;
  /** 鏄惁瓒呮椂 */
  timeout: boolean;
  /** 瀹屾暣鐨勭姸鎬佸搷搴?*/
  response?: TXStatusResponse;
}

/**
 * 绛夊緟浜ゆ槗纭
 * 
 * 杞鏌ヨ浜ゆ槗鐘舵€侊紝鐩村埌浜ゆ槗琚‘璁わ紙鎴愬姛鎴栧け璐ワ級鎴栬秴鏃?
 * 
 * @param txID 浜ゆ槗ID
 * @param groupID 鎷呬繚缁勭粐ID
 * @param assignNodeUrl AssignNode URL锛堝彲閫夛級
 * @param options 閰嶇疆閫夐」
 * @returns 纭缁撴灉
 */
export function waitForTXConfirmation(
  txID: string,
  groupID: string,
  assignNodeUrl?: string,
  options: WaitForConfirmationOptions = {}
): Promise<WaitForConfirmationResult> {
  const {
    pollInterval = 5000,
    maxWaitTime = 60000,
    onStatusChange,
    minBlockHeight = 0
  } = options;

  console.log(`[绛夊緟浜ゆ槗纭] 寮€濮嬬洃鍚?TXID=${txID} (SSE + Backup Poll)`);

  return new Promise((resolve) => {
    let hasResolved = false;
    let lastStatus: TXStatusType | null = null;
    let timeoutTimer: any = null;
    let pollTimer: any = null;
    let pollStartTimer: any = null;
    let sseHandler: any = null;
    let pollInFlight = false;
    let ssePreferredUntil = 0;

    const cleanup = () => {
      hasResolved = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (pollTimer) clearInterval(pollTimer);
      if (pollStartTimer) clearTimeout(pollStartTimer);
      if (sseHandler) window.removeEventListener('pangu_tx_status', sseHandler);
    };

    const handleStatusResponse = (response: TXStatusResponse) => {
      if (hasResolved) return;

      if (
        response.status === 'success' &&
        minBlockHeight > 0 &&
        (response.block_height || 0) <= minBlockHeight
      ) {
        console.log(
          `[绛夊緟浜ゆ槗纭] 宸查獙璇佷絾鏈笂閾撅紝绛夊緟鍖哄潡纭 (block_height=${response.block_height}, min=${minBlockHeight})`
        );
        if (lastStatus !== 'pending') {
          lastStatus = 'pending';
          if (onStatusChange) {
            onStatusChange({
              ...response,
              status: 'pending',
              result: false
            });
          }
        }
        return;
      }

      if (response.status !== lastStatus) {
        lastStatus = response.status;
        console.log(`[绛夊緟浜ゆ槗纭] 鐘舵€佸彉鍖? ${response.status}`);
        if (onStatusChange) {
          onStatusChange(response);
        }
      }

      if (response.status === 'success') {
        console.log('[绛夊緟浜ゆ槗纭] 浜ゆ槗鎴愬姛纭 (via ' + (response.guar_id ? 'Poll' : 'SSE') + ')');
        cleanup();
        resolve({
          success: true,
          status: 'success',
          timeout: false,
          response
        });
      } else if (response.status === 'failed') {
        console.log('[绛夊緟浜ゆ槗纭] 浜ゆ槗楠岃瘉澶辫触:', response.error_reason);
        cleanup();
        resolve({
          success: false,
          status: 'failed',
          errorReason: response.error_reason,
          timeout: false,
          response
        });
      }
    };

    // 1. Setup Timeout
    timeoutTimer = setTimeout(() => {
      if (!hasResolved) {
        console.log('[绛夊緟浜ゆ槗纭] 瓒呮椂');
        cleanup();
        resolve({
          success: false,
          status: lastStatus || 'pending',
          timeout: true
        });
      }
    }, maxWaitTime);

    // 3. Setup SSE Listener
    sseHandler = (event: CustomEvent) => {
      if (hasResolved) return;
      const data = event.detail;
      if (data && data.tx_id === txID) {
        // Construct compatible response from SSE data
        const response: TXStatusResponse = {
          tx_id: data.tx_id,
          status: data.status as TXStatusType,
          receive_result: true,
          result: data.status === 'success',
          error_reason: data.error_reason || '',
          guar_id: '', // SSE doesn't carry this, unimportant for status check
          user_id: '',
          block_height: data.block_height || 0
        };
        handleStatusResponse(response);
      }
    };
    window.addEventListener('pangu_tx_status', sseHandler as EventListener);

    const runPoll = async () => {
      if (hasResolved || pollInFlight) return;
      pollInFlight = true;
      try {
        const res = await queryTXStatus(txID, groupID, assignNodeUrl);
        if (
          ssePreferredUntil > 0 &&
          (res.status === 'success' || res.status === 'failed') &&
          Date.now() < ssePreferredUntil
        ) {
          return;
        }
        handleStatusResponse(res);
      } catch (err) {
        console.warn('[绛夊緟浜ゆ槗纭] 杞鏌ヨ澶辫触 (蹇界暐):', err);
      } finally {
        pollInFlight = false;
      }
    };

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(runPoll, pollInterval);
      runPoll();
    };

    const sseActiveAtStart = isAccountPollingActive();
    if (sseActiveAtStart) {
      pollStartTimer = setTimeout(() => {
        if (!hasResolved) {
          console.warn('[绛夊緟浜ゆ槗纭] SSE 鏈帹閫侊紝鍚敤杞鍏滃簳');
          startPolling();
        }
      }, 6000);
    } else {
      startPolling();
    }

    // 4. Initial Check (Only once, to catch if already confirmed)
    queryTXStatus(txID, groupID, assignNodeUrl)
      .then((res) => {
        if (res.status === 'success' || res.status === 'failed') {
          ssePreferredUntil = Date.now() + 3000;
          // 寤惰繜浣跨敤鏌ヨ缁撴灉锛屼紭鍏堢瓑寰?SSE 鎺ㄩ€佷互楠岃瘉 SSE 鍔熻兘
          console.log('[绛夊緟浜ゆ槗纭] 鍒濆鏌ヨ宸茬‘璁?(status=' + res.status + '). 绛夊緟 3绉?鐪嬫槸鍚︽敹鍒?SSE 浠ラ獙璇佽鍔ㄦ帹閫?..');
          setTimeout(() => {
            if (!hasResolved) {
              console.log('[绛夊緟浜ゆ槗纭] SSE 鏈埌杈炬垨閿欒繃浜嗙獥鍙? 浣跨敤鍒濆鏌ヨ缁撴灉浣滀负鍏滃簳');
              handleStatusResponse(res);
            }
          }, 3000);
        } else {
          console.log('[绛夊緟浜ゆ槗纭] 鍒濆鏌ヨ鏈‘璁わ紝绛夊緟 SSE 鎺ㄩ€?..');
        }
      })
      .catch((err) => {
        // Initial poll failed, but we still wait for SSE.
        console.warn('[绛夊緟浜ゆ槗纭] 鍒濆鏌ヨ澶辫触 (蹇界暐):', err);
      });
  });
}

// ============================================================================
// 鎻愪氦浜ゆ槗
// ============================================================================

/**
 * 鎻愪氦浜ゆ槗鍒板悗绔?
 * 
 * @param userNewTX UserNewTX 瀵硅薄
 * @param groupID 鎷呬繚缁勭粐 ID
 * @returns 鍚庣鍝嶅簲
 */
export async function submitTransaction(
  userNewTX: UserNewTX,
  groupID: string,
  assignNodeUrl?: string
): Promise<{ success: boolean; tx_id?: string; error?: string; errorCode?: string }> {
  const { API_BASE_URL, API_ENDPOINTS } = await import('./api');

  // 濡傛灉鎻愪緵浜?AssignNode URL锛屽垯浣跨敤瀹冿紱鍚﹀垯浣跨敤榛樿鐨?API_BASE_URL
  const baseUrl = assignNodeUrl || API_BASE_URL;
  const url = baseUrl + API_ENDPOINTS.ASSIGN_SUBMIT_TX(groupID);
  const body = serializeUserNewTX(userNewTX);

  console.log('[浜ゆ槗鎻愪氦] AssignNode URL:', assignNodeUrl || '(using default API_BASE_URL)');
  console.log('[浜ゆ槗鎻愪氦] Full URL:', url);
  console.log('[浜ゆ槗鎻愪氦] Body:', body);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body
  });

  const result = await response.json();

  if (result.success) {
    console.log('[浜ゆ槗鎻愪氦] 鎴愬姛锛孴XID:', result.tx_id);
  } else {
    console.error('[浜ゆ槗鎻愪氦] 澶辫触:', result.error);

    // Parse specific error messages and add error codes for better handling
    const errorMsg = result.error || '';

    // User not in organization - this typically means:
    // 1. User imported an address that belongs to an org but never successfully joined
    // 2. User's join request failed but frontend saved org info anyway
    // 3. User was removed from the organization
    if (errorMsg.includes('user is not in the guarantor') ||
      errorMsg.includes('user not found in group') ||
      errorMsg.includes('not in the guarantor organization')) {
      console.warn('[submitTransaction] User is not in guarantor group');
      result.errorCode = 'USER_NOT_IN_ORG';
    }

    // Address revoked - address was unbound
    if (errorMsg.includes('address revoked') || errorMsg.includes('already revoked')) {
      result.errorCode = 'ADDRESS_REVOKED';
    }

    // Signature verification failed
    if (errorMsg.includes('signature verification')) {
      result.errorCode = 'SIGNATURE_FAILED';
    }

    // UTXO already spent
    if (errorMsg.includes('utxo already spent') || errorMsg.includes('double spend')) {
      result.errorCode = 'UTXO_SPENT';
    }

    if (errorMsg.includes('missing UserSignatureV2') || errorMsg.includes('V2 user signature')) {
      result.errorCode = 'TX_V2_SIGNATURE_FAILED';
    }

    if (
      errorMsg.includes('missing V2 input signature') ||
      errorMsg.includes('seed chain') ||
      errorMsg.includes('seed step') ||
      errorMsg.includes('seed sweep required') ||
      errorMsg.includes('SeedReveal') ||
      errorMsg.includes('SignPublicKeyV2')
    ) {
      result.errorCode = 'SEED_PROTOCOL_FAILED';
    }
  }

  return result;
}


// ============================================================================
// 閫傞厤鍑芥暟锛氫粠鏃ф牸寮忚浆鎹?
// ============================================================================

/**
 * 鏃х増 BuildTXInfo 鏍煎紡锛堝吋瀹圭幇鏈変唬鐮侊級
 */
export interface LegacyBuildTXInfo {
  Value?: number;
  ValueDivision: Record<number, number>;
  Bill: Record<string, {
    MoneyType: number;
    Value: number;
    GuarGroupID?: string;
    PublicKey?: { XHex: string; YHex: string };
    ToInterest?: number;
    SeedAnchor?: number[] | string;
    SeedChainStep?: number;
    DefaultSpendAlgorithm?: string;
  }>;
  UserAddress: string[];
  PriUseTXCer: boolean;
  ChangeAddress: Record<number, string>;
  IsPledgeTX: boolean;
  HowMuchPayForGas: number;
  IsCrossChainTX: boolean;
  Data?: string | Uint8Array;
  InterestAssign: {
    Gas: number;
    Output: number;
    BackAssign: Record<string, number>;
  };
}

/**
 * 浠庢棫鐗?BuildTXInfo 鏍煎紡杞崲涓烘柊鐗?BuildTransactionParams
 * 
 * @param buildInfo 鏃х増鏋勫缓淇℃伅
 * @returns 鏂扮増鏋勫缓鍙傛暟
 */
export function convertLegacyBuildInfo(buildInfo: LegacyBuildTXInfo): BuildTransactionParams {
  const recipients: BuildTransactionParams['recipients'] = [];

  for (const [address, bill] of Object.entries(buildInfo.Bill)) {
    recipients.push({
      address,
      amount: bill.Value,
      coinType: bill.MoneyType,
      publicKeyX: bill.PublicKey?.XHex || '',
      publicKeyY: bill.PublicKey?.YHex || '',
      guarGroupID: bill.GuarGroupID || '',
      interest: bill.ToInterest || 0,
      seedAnchor: bill.SeedAnchor,
      seedChainStep: bill.SeedChainStep,
      defaultSpendAlgorithm: bill.DefaultSpendAlgorithm
    });
  }

  return {
    fromAddresses: buildInfo.UserAddress,
    recipients,
    changeAddresses: buildInfo.ChangeAddress,
    gas: buildInfo.InterestAssign.Gas,
    isCrossChain: buildInfo.IsCrossChainTX,
    howMuchPayForGas: buildInfo.HowMuchPayForGas || 0,
    preferTXCer: !!buildInfo.PriUseTXCer
  };
}

/**
 * 浣跨敤鏃х増 BuildTXInfo 鏍煎紡鏋勫缓浜ゆ槗
 * 
 * 杩欐槸涓€涓吋瀹瑰嚱鏁帮紝鍏佽鐜版湁浠ｇ爜鏃犵紳杩佺Щ鍒版柊鐨勪氦鏄撴瀯閫犲櫒
 * 
 * @param buildInfo 鏃х増鏋勫缓淇℃伅
 * @param user 鐢ㄦ埛鏁版嵁
 * @returns UserNewTX
 */
export async function buildTransactionFromLegacy(
  buildInfo: LegacyBuildTXInfo,
  user: User
): Promise<UserNewTX> {
  console.log('[buildTransactionFromLegacy] 寮€濮嬭浆鎹?..');
  console.log('[buildTransactionFromLegacy] buildInfo:', JSON.stringify(buildInfo, null, 2));

  const params = convertLegacyBuildInfo(buildInfo);
  console.log('[buildTransactionFromLegacy] 杞崲鍚庣殑 params:', JSON.stringify(params, null, 2));

  return buildTransaction(params, user);
}

// ============================================================================
// AggregateGTX 鏋勯€狅紙鏅€氳浆璐?- 鏁ｆ埛浜ゆ槗锛?
// ============================================================================

/**
 * SubATX 缁撴瀯锛堣仛鍚堜氦鏄撲腑鐨勫瓙浜ゆ槗锛?
 */
export interface SubATXForSubmit extends BlockchainSubATX {
  Version: number;
  GuarantorGroup: string;
  Value: number;
  ValueDivision: Record<number, number>;
  NewValue: number;
  NewValueDiv: Record<number, number>;
  TXInputsNormal: TXInputNormal[];
  TXInputsCertificate: any[];
  TXOutputs: TXOutput[];
  InterestAssign: InterestAssign;
  UserSignatureV2?: SignatureEnvelope;
}

/**
 * AggregateGTX 缁撴瀯锛堢敤浜庢彁浜ゅ埌 ComNode锛?
 */
export interface AggregateGTXForSubmit extends BlockchainAggregateGTX {
  GuarantorGroupSig: EcdsaSignatureJSON;
  AllTransactions: SubATXForSubmit[];
}

/**
 * 璁＄畻 AggregateGTX 鐨勫搱甯屽€?
 * 
 * 妯℃嫙鍚庣 GetATXHash锛?
 * 1. 鎺掗櫎瀛楁锛欸uarantorGroupSig, TXHash, TXSize
 * 2. JSON 搴忓垪鍖?
 * 3. SHA-256 鍝堝笇
 * 4. 杩斿洖 Base64 缂栫爜
 * 
 * @param atx AggregateGTX 瀵硅薄锛堜笉鍚?TXHash锛?
 * @returns Base64 缂栫爜鐨勫搱甯屽€?
 */
export function calculateATXHash(atx: Omit<AggregateGTXForSubmit, 'TXHash' | 'TXSize' | 'GuarantorGroupSig'>): string {
  const hashBytes = hashBackendJson(atx);
  let binary = '';
  for (const value of hashBytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

/**
 * 灏?Transaction 杞崲涓?SubATX 鏍煎紡
 * 
 * @param tx Transaction 瀵硅薄
 * @returns SubATX 鏍煎紡
 */
function transactionToSubATX(tx: Transaction): SubATXForSubmit {
  return {
    TXID: tx.TXID,
    TXType: tx.TXType,
    Version: tx.Version,
    GuarantorGroup: tx.GuarantorGroup,
    Value: tx.Value,
    ValueDivision: tx.ValueDivision,
    NewValue: tx.NewValue,
    NewValueDiv: tx.NewValueDiv,
    TXInputsNormal: tx.TXInputsNormal,
    TXInputsCertificate: tx.TXInputsCertificate || [],
    TXOutputs: tx.TXOutputs,
    InterestAssign: tx.InterestAssign,
    ExTXCerID: [],
    Data: tx.Data || [],
    UserSignatureV2: tx.UserSignatureV2
  };
}

/**
 * 鏋勫缓 AggregateGTX锛堢敤浜庢櫘閫氳浆璐?鏁ｆ埛浜ゆ槗锛?
 * 
 * @param tx Transaction 瀵硅薄锛圱XType 搴旇鏄?8锛?
 * @returns AggregateGTX 瀵硅薄
 */
export function buildAggregateGTX(tx: Transaction): AggregateGTXForSubmit {
  console.log('[buildAggregateGTX] 寮€濮嬫瀯寤?AggregateGTX...');

  // 鏋勫缓鍩虹缁撴瀯锛堜笉鍚?TXHash锛?
  const subATX = transactionToSubATX(tx);

  const atxBase = {
    AggrTXType: 2,           // 鏁ｆ埛浜ゆ槗鑱氬悎
    IsGuarCommittee: false,
    IsNoGuarGroupTX: true,
    GuarantorGroupID: '',
    TXNum: 1,
    TotalGas: tx.InterestAssign?.Gas || 0,
    Version: 1.0,
    AllTransactions: [subATX]
  };

  // 璁＄畻鍝堝笇
  const txHash = calculateATXHash(atxBase);

  // 鏋勫缓瀹屾暣鐨?AggregateGTX
  const atx: AggregateGTXForSubmit = {
    ...atxBase,
    GuarantorGroupSig: { R: null, S: null },  // 鏁ｆ埛浜ゆ槗涓嶉渶瑕佹媴淇濈鍚?
    TXHash: txHash,
    TXSize: 0  // 鐢卞悗绔绠?
  };

  console.log('[buildAggregateGTX] 鏋勫缓瀹屾垚锛孴XHash:', txHash);

  return atx;
}

/**
 * 鏋勫缓鏅€氳浆璐︿氦鏄擄紙鏁ｆ埛妯″紡锛屾湭鍔犲叆鎷呬繚缁勭粐锛?
 * 
 * 涓?buildTransaction 鐨勫尯鍒細
 * 1. TXType = 8锛堟暎鎴蜂氦鏄擄級
 * 2. 涓嶉渶瑕佹媴淇濈粍缁?ID
 * 3. 杩斿洖 AggregateGTX 鑰岄潪 UserNewTX
 * 4. 鎻愪氦鍒?ComNode 鑰岄潪 AssignNode
 * 
 * @param params 鏋勫缓鍙傛暟
 * @param user 鐢ㄦ埛鏁版嵁
 * @returns AggregateGTX
 */
export async function buildNormalTransaction(
  params: BuildTransactionParams,
  user: User
): Promise<AggregateGTXForSubmit> {
  console.log('[鏅€氳浆璐 寮€濮嬫瀯寤轰氦鏄?..');
  console.log('[鏅€氳浆璐 鍙傛暟:', JSON.stringify(params, null, 2));

  const {
    fromAddresses,
    recipients,
    changeAddresses,
    gas,
    howMuchPayForGas = 0
  } = params;

  // 鑾峰彇閽卞寘鏁版嵁
  const walletData = user.wallet?.addressMsg || {};
  const userID = user.accountId || '';

  console.log('[鏅€氳浆璐 鐢ㄦ埛ID:', userID);
  console.log('[鏅€氳浆璐 閽卞寘鍦板潃鏁伴噺:', Object.keys(walletData).length);
  console.log('[鏅€氳浆璐 鍙戦€佸湴鍧€:', fromAddresses);

  if (!userID) {
    throw new Error('User ID is missing');
  }

  // 鑾峰彇璐︽埛绉侀挜
  const accountPrivKey = user.keys?.privHex || user.privHex || '';
  if (!accountPrivKey) {
    throw new Error('Account private key is missing');
  }

  // ========== Step 1: 璁＄畻鍚勫竵绉嶉渶瑕佺殑閲戦 ==========
  const requiredAmounts: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
  for (const recipient of recipients) {
    requiredAmounts[recipient.coinType] = (requiredAmounts[recipient.coinType] || 0) + recipient.amount;
  }

  // 棰濆鍏戞崲 Gas 鐨?PGC
  if (howMuchPayForGas > 0) {
    requiredAmounts[0] += howMuchPayForGas;
  }

  console.log('[鏅€氳浆璐 闇€瑕侀噾棰?', requiredAmounts);

  // ========== Step 2: 閫夋嫨 UTXO锛堟暎鎴峰彧鑳戒娇鐢?UTXO锛屼笉鑳界敤 TXCer锛?=========
  let selectedUTXOs: Array<{
    address: string;
    utxoKey: string;
    utxoData: UTXOData;
    coinType: number;
  }> = [];
  selectedUTXOs = selectUTXOs(fromAddresses, walletData, requiredAmounts, { requireRegistration: true });

  const collectedAmounts: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
  for (const { utxoData, coinType } of selectedUTXOs) {
    collectedAmounts[coinType] += utxoData.Value;
  }

  console.log('[normal tx] selected UTXOs:', selectedUTXOs.length);

  const advancedOutputMeta = new Map<string, {
    seedAnchor: number[] | string;
    seedChainStep: number;
    defaultSpendAlgorithm: string;
  }>();

  for (const { address, utxoData } of selectedUTXOs) {
    const normalizedAddress = normalizeAddress(address);
    if (advancedOutputMeta.has(normalizedAddress)) {
      continue;
    }
    const addrData = walletData[normalizedAddress] || walletData[address];
    if (!addrData?.privHex) {
      continue;
    }
    const referencedOutput = utxoData.UTXO?.TXOutputs?.[utxoData.Position?.IndexZ || 0] as TXOutput | undefined;
    if (!referencedOutput?.SeedAnchor || !referencedOutput?.SeedChainStep) {
      continue;
    }
    const spendState = recoverSeedStateForSpend(normalizedAddress, addrData, referencedOutput);
    if (spendState.step <= 1) {
      throw new Error(`Address ${normalizedAddress.slice(0, 16)}... seed chain is exhausted`);
    }
    advancedOutputMeta.set(normalizedAddress, {
      seedAnchor: nextAnchor(spendState),
      seedChainStep: spendState.step - 1,
      defaultSpendAlgorithm: addrData.defaultSpendAlgorithm || AlgorithmECDSAP256
    });
  }

  // ========== Step 3: 鏋勯€?TXInputNormal ==========
  const txInputs: TXInputNormal[] = [];

  for (const utxoItem of selectedUTXOs) {
    const { address, utxoData } = utxoItem;
    const addrData = walletData[address];
    if (!addrData) continue;

    // 鑾峰彇鍦板潃绉侀挜
    const addrPrivKey = addrData.privHex || '';
    if (!addrPrivKey) {
      throw new Error(`Address ${address} private key is missing`);
    }

    // 鑾峰彇琚紩鐢ㄧ殑 TXOutput
    const position = utxoData.Position;
    const utxoTx = utxoData.UTXO;
    if (!utxoTx || !utxoTx.TXOutputs || utxoTx.TXOutputs.length <= position.IndexZ) {
      throw new Error(`UTXO 鏁版嵁涓嶅畬鏁? ${utxoItem.utxoKey}`);
    }

    const referencedOutput = utxoTx.TXOutputs[position.IndexZ];

    // 璁＄畻 TXOutput 鍝堝笇骞剁鍚?
    // Cast to any to handle type difference between blockchain.TXOutput and txBuilder.TXOutput
    const { hash: outputHash, signature: inputSigRaw } = signTXOutput(referencedOutput as any, addrPrivKey);
    const seedState = recoverSeedStateForSpend(address, addrData as AddressData, referencedOutput as any);
    const spendArtifacts = buildSeedSpendArtifacts(outputHash, currentSeed(seedState));
    const inputSig: EcdsaSignatureJSON = {
      R: inputSigRaw.R.toString(10),
      S: inputSigRaw.S.toString(10)
    };

    const input: TXInputNormal = {
      FromTXID: utxoTx.TXID,
      FromTxPosition: position,
      FromAddress: address,
      IsGuarMake: false,
      IsCommitteeMake: false,
      IsCrossChain: false,
      InputSignature: inputSig,
      TXOutputHash: outputHash,
      InputSignatureV2: spendArtifacts.inputSignatureV2,
      SeedReveal: spendArtifacts.seedReveal,
      SeedPublicKeyV2: spendArtifacts.seedPublicKeyV2,
      SeedChainStep: seedState.step
    };

    txInputs.push(input);
  }

  // ========== Step 4: 鏋勯€?TXOutputs ==========
  const txOutputs: TXOutput[] = [];

  // 鏀舵鏂硅緭鍑?
  for (const recipient of recipients) {
    const recipientSeedMeta = resolveRecipientSeedStateForOutput(recipient, walletData);
    if (!recipientSeedMeta.seedAnchor || !recipientSeedMeta.seedChainStep) {
      throw new Error(`Recipient ${recipient.address.slice(0, 16)}... is missing seed metadata`);
    }
    const output: TXOutput = {
      ToAddress: recipient.address,
      ToValue: recipient.amount,
      ToGuarGroupID: recipient.guarGroupID || '',
      ToPublicKey: convertHexToPublicKey(recipient.publicKeyX, recipient.publicKeyY) as unknown as PublicKeyNewJSON,
      ToInterest: recipient.interest || 0,
      Type: recipient.coinType,
      ToPeerID: '',
      IsPayForGas: false,
      IsCrossChain: false,
      IsGuarMake: false,
      SeedAnchor: recipientSeedMeta.seedAnchor,
      SeedChainStep: recipientSeedMeta.seedChainStep,
      DefaultSpendAlgorithm: recipientSeedMeta.defaultSpendAlgorithm
    };
    txOutputs.push(output);
  }

  // 鎵鹃浂杈撳嚭
  for (const coinType of [0, 1, 2]) {
    const changeAmount = collectedAmounts[coinType] - requiredAmounts[coinType];
    if (changeAmount > 0 && changeAddresses[coinType]) {
      const changeAddr = changeAddresses[coinType];
      const changeAddrData = walletData[changeAddr];
      const normalizedChangeAddr = normalizeAddress(changeAddr);
      const changeSeedMeta = advancedOutputMeta.get(normalizedChangeAddr) || getAddressSeedStateForOutput(normalizedChangeAddr, walletData);

      const output: TXOutput = {
        ToAddress: changeAddr,
        ToValue: changeAmount,
        ToGuarGroupID: '',
        ToPublicKey: changeAddrData
          ? (convertHexToPublicKey(changeAddrData.pubXHex || '', changeAddrData.pubYHex || '') as unknown as PublicKeyNewJSON)
          : { CurveName: 'P256', X: '0', Y: '0' },
        ToInterest: 0,
        Type: coinType,
        ToPeerID: '',
        IsPayForGas: false,
        IsCrossChain: false,
        IsGuarMake: false,
        SeedAnchor: changeSeedMeta.seedAnchor,
        SeedChainStep: changeSeedMeta.seedChainStep,
        DefaultSpendAlgorithm: changeSeedMeta.defaultSpendAlgorithm
      };
      txOutputs.push(output);
    }
  }

  // Gas 杈撳嚭
  if (howMuchPayForGas > 0) {
    const gasOutput: TXOutput = {
      ToAddress: '',
      ToValue: howMuchPayForGas,
      ToGuarGroupID: '',
      ToPublicKey: { CurveName: 'P256', X: '0', Y: '0' },
      ToInterest: 0,
      Type: 0,
      ToPeerID: '',
      IsPayForGas: true,
      IsCrossChain: false,
      IsGuarMake: false,
      SeedAnchor: [],
      SeedChainStep: 0,
      DefaultSpendAlgorithm: ''
    };
    txOutputs.push(gasOutput);
  }

  // ========== Step 5: 鏋勯€?InterestAssign ==========
  const backAssign: Record<string, number> = {};
  const addressCount = fromAddresses.length;
  for (const addr of fromAddresses) {
    backAssign[addr] = 1 / addressCount;
  }

  const interestAssign: InterestAssign = {
    Gas: gas,
    Output: 0,
    BackAssign: backAssign
  };

  // ========== Step 6: 鏋勯€?Transaction ==========
  const valueDivision: Record<number, number> = {};
  for (const recipient of recipients) {
    valueDivision[recipient.coinType] = (valueDivision[recipient.coinType] || 0) + recipient.amount;
  }
  if (howMuchPayForGas > 0) {
    valueDivision[0] = (valueDivision[0] || 0) + howMuchPayForGas;
  }

  const tx: Transaction = {
    TXID: '',
    Size: 0,
    Version: 1.0,
    GuarantorGroup: '',  // 鏁ｆ埛娌℃湁鎷呬繚缁勭粐
    TXType: 8,           // 鏁ｆ埛浜ゆ槗绫诲瀷
    Value: Object.values(valueDivision).reduce((a, b) => a + b, 0),
    ValueDivision: valueDivision,
    NewValue: 0,
    NewValueDiv: {},
    InterestAssign: interestAssign,
    UserSignature: { R: null, S: null },
    UserSignatureV2: { Algorithm: '', Signature: null },
    TXInputsNormal: txInputs,
    TXInputsCertificate: [],
    TXOutputs: txOutputs,
    Data: []
  };

  tx.UserSignatureV2 = signHashEnvelope(
    AlgorithmECDSAP256,
    hashBackendJson({
      ...tx,
      TXID: '',
      Size: 0,
      NewValue: 0,
      UserSignature: { R: null, S: null },
      UserSignatureV2: { Algorithm: '', Signature: null },
      TXType: 0
    }),
    accountPrivKey
  );

  tx.TXID = calculateTXID(tx);
  console.log('[鏅€氳浆璐 TXID:', tx.TXID);

  // ========== Step 7: 鏋勫缓 AggregateGTX ==========
  const atx = buildAggregateGTX(tx);

  console.log('[鏅€氳浆璐 浜ゆ槗鏋勫缓瀹屾垚');

  return atx;
}

