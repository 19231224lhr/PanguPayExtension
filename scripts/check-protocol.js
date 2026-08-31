import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function requireMarkers(source, markers, scope) {
  for (const marker of markers) {
    if (!source.includes(marker)) {
      throw new Error(`${scope} is missing ${marker}`);
    }
  }
}

function forbid(source, pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

const address = read('src/core/address.ts');
const api = read('src/core/api.ts');
const blockchain = read('src/core/blockchain.ts');
const signature = read('src/core/signature.ts');
const storage = read('src/core/storage.ts');
const txBuilder = read('src/core/txBuilder.ts');
const txCerStatus = read('src/core/txCerStatus.ts');
const transfer = read('src/core/transfer.ts');
const settlementAuth = read('src/core/settlementAuth.ts');
const txHash = read('src/core/txHash.ts');
const walletStore = read('src/minimal/walletStore.ts');
const messages = read('src/minimal/messages.ts');
const content = read('src/content/index.ts');
const background = read('src/background/index.ts');

forbid(
  address,
  /accountPrivHex \? getPublicKeyHexFromPrivate\(accountPrivHex\)/,
  'SignPublicKeyV2 must not fall back to an address public key.',
);

requireMarkers(walletStore, [
  'await saveAccount(account)',
  'await setActiveAccount(account.accountId)',
  'await saveOrganization(account.accountId, bundle.organization)',
  'setSessionSecretsInMemory',
], 'minimal wallet import');

requireMarkers(content, [
  'isPublicPageMessage',
  "'accountChanged'",
  "'disconnect'",
  "'txStatus'",
], 'content bridge');
forbid(content, /PANGU_UI_(?:APPROVE|REJECT)/, 'content bridge must not forward private approval messages.');

requireMarkers(messages, [
  "'PANGU_CONNECT'",
  "'PANGU_GET_ACCOUNT'",
  "'PANGU_SEND_TRANSACTION'",
  "'PANGU_DISCONNECT'",
  'resolveSenderOrigin',
  'isTrustedUiSender',
], 'message boundary');

requireMarkers(background, [
  'queryAddressGroupInfo',
  'buildAndSubmitTransfer',
  'queryTXStatus',
  "mode: 'quick'",
  'coinType: 0',
  "gas: '0'",
  "status: 'submitted'",
  "'PANGU_UI_APPROVE'",
  "'PANGU_UI_REJECT'",
], 'minimal transaction closure');

requireMarkers(api, [
  "const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3001'",
  'VITE_PANGU_API_BASE_URL',
  'ASSIGN_SUBMIT_TX',
  'ASSIGN_TX_STATUS',
  'COM_QUERY_ADDRESS',
  'COM_QUERY_ADDRESS_GROUP',
], 'API contract');

requireMarkers(txCerStatus, [
  "getTXCerStatus(account, txCerID) === 'Active'",
  "fastEvidenceStatus === 'Failed'",
  'isTXCerLocked(txCerID, allowedDraftLockOwner)',
  'TXCER_TERMINAL_STATUSES.includes(view.status)',
], 'TXCer lifecycle guard');
forbid(
  storage,
  /account\.txCerIssuanceRecords\s*=\s*\{\s*\}/,
  'TXCer cleanup must preserve issuance metadata.',
);

requireMarkers(txBuilder, [
  'isTXCerSpendable(user, txCerId, txCerLockOwner)',
  'buildApiUrl(baseUrl, API_ENDPOINTS.ASSIGN_SUBMIT_TX(groupID))',
  'buildApiUrl(baseUrl, API_ENDPOINTS.ASSIGN_TX_STATUS(groupID, txID))',
  'attachSettlementAuths(transaction, accountPrivKey);',
], 'transaction builder');
requireMarkers(transfer, ['isTXCerSpendable(account, id)'], 'transfer locking');

requireMarkers(blockchain, [
  'export interface SettlementAuth',
  'SourcePledgeAddress',
  'SettlementAuth?: SettlementAuth',
  'export interface CommitteeReceipt',
  'export interface PenaltyRecord',
], 'protocol types');
requireMarkers(signature, [
  "'ConsumeIntentHash'",
  "'LeafHash'",
  "'MerkleRoot'",
  "field === 'Signature'",
], 'Go-compatible signature serialization');
requireMarkers(settlementAuth, [
  'zeroSettlementAuth',
  'getSettlementIntentHash',
  'buildSettlementAuth',
  'attachSettlementAuths',
], 'SettlementAuth');
requireMarkers(txHash, ['computeTransactionHashV2', 'computeTransactionIDV2'], 'TXID adapter');

const tests = spawnSync(process.execPath, ['--test', 'tests/protocolV2.node.test.js'], {
  cwd: root,
  encoding: 'utf8',
});
if (tests.stdout) process.stdout.write(tests.stdout);
if (tests.stderr) process.stderr.write(tests.stderr);
if (tests.status !== 0) process.exit(tests.status ?? 1);

console.log('[check:protocol] minimal bridge and protocol-v2 guard checks passed');
