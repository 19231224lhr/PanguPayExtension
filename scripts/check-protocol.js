import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function fail(message) {
  console.error(`[check:protocol] ${message}`);
  process.exitCode = 1;
}

const addressSource = read('src/core/address.ts');
const walletCreateSource = read('src/popup/pages/walletCreate.ts');
const walletImportSource = read('src/popup/pages/walletImport.ts');
const contentSource = read('src/content/index.ts');
const backgroundSource = read('src/background/index.ts');
const dappTxRequestSource = read('src/core/dappTxRequest.ts');
const apiSource = read('src/core/api.ts');
const blockchainSource = read('src/core/blockchain.ts');
const signatureSource = read('src/core/signature.ts');
const storageSource = read('src/core/storage.ts');
const accountPollingSource = read('src/core/accountPolling.ts');
const txCerStatusSource = read('src/core/txCerStatus.ts');
const txCerIssuanceProofSource = read('src/core/txCerIssuanceProof.ts');
const txCerIssuanceSource = read('src/core/txCerIssuance.ts');
const protocolDiagnosticsSource = read('src/core/protocolDiagnostics.ts');
const settlementAuthSource = read('src/core/settlementAuth.ts');
const txHashSource = read('src/core/txHash.ts');
const txBuilderSource = read('src/core/txBuilder.ts');
const transferSource = read('src/core/transfer.ts');
const sendPageSource = read('src/popup/pages/send.ts');
const homePageSource = read('src/popup/pages/home.ts');

if (addressSource.includes('accountPrivHex ? getPublicKeyHexFromPrivate(accountPrivHex)')) {
  fail('SignPublicKeyV2 still falls back to address public key when account private key is missing.');
}

if (/registerAddressOnComNode\s*\(\s*(?:\r?\n\s*)?(?!\{)/.test(walletCreateSource + walletImportSource)) {
  fail('wallet create/import must call registerAddressOnComNode with explicit object parameters.');
}

if (!/accountPrivHex:\s*session[!.]?\.(privKey)/.test(walletCreateSource + walletImportSource)) {
  fail('wallet create/import retail registration must pass the active account private key.');
}

for (const field of ['txId', 'status', 'mode', 'error']) {
  if (!contentSource.includes(`${field}: message.${field}`)) {
    fail(`content script does not forward DApp event field ${field}.`);
  }
}

if (!backgroundSource.includes('saveDappTxWatch')) {
  fail('background does not record DApp tx watches after transaction approval.');
}

if (/if\s*\(\s*org\?\.groupId\s*&&\s*submitResult\.txId\s*\)\s*\{\s*await\s+saveDappTxWatch/s.test(backgroundSource)) {
  fail('DApp tx watches are still gated by organization membership.');
}

for (const marker of [
  'consumeDappTxWatches',
  'getDappTxWatches',
  'scheduleBackgroundDappTxStatusWatch',
  'pollSavedDappTxWatches',
  'DAPP_TX_STATUS_ALARM',
  'queryTXStatus',
  'handleBackgroundDappTxStatus',
]) {
  if (!backgroundSource.includes(marker)) {
    fail(`background DApp tx status watcher is missing ${marker}.`);
  }
}

for (const marker of ['seedAnchor', 'seedChainStep', 'defaultSpendAlgorithm']) {
  if (!(backgroundSource + dappTxRequestSource).includes(marker)) {
    fail(`DApp tx normalization does not preserve ${marker}.`);
  }
}

for (const marker of ['transferMode', 'toAddress', 'recipientPublicKey', 'recipientOrgId', 'transferGas', 'howMuchPayForGas']) {
  if (!dappTxRequestSource.includes(marker)) {
    fail(`DApp tx normalization does not accept frontend field ${marker}.`);
  }
}

if (!dappTxRequestSource.includes('readDappPublicKey(entry)')) {
  fail('DApp recipient normalization does not preserve recipient public keys.');
}

if (!backgroundSource.includes('useRequestWideMeta ? request.publicKey')) {
  fail('DApp recipient enrichment does not apply request-wide metadata for single-recipient requests.');
}

for (const marker of [
  'ASSIGN_TXCER_STATUSES',
  'ASSIGN_TXCER_STATUS',
  'ASSIGN_TXCER_STATUS_CHANGE',
  'ASSIGN_SCHEDULER_STATS',
  'ASSIGN_SCHEDULER_DAG_RECORDS',
  'ASSIGN_SCHEDULER_DAG_EVENTS',
  'AGGR_TXCER_ISSUANCE_RECORDS',
  'AGGR_TXCER_ISSUANCE_RECORD',
  'AGGR_TXCER_ISSUANCE_BATCH',
  'ASSIGN_AUDIT_EVENTS',
  'ASSIGN_CHALLENGES',
  'ASSIGN_PENALTIES',
  'ASSIGN_CERTIFIERS',
  'AGGR_AUDIT_EVENTS',
  'AGGR_CHALLENGES',
  'AGGR_CERTIFIERS',
  'AGGR_CERTIFIER_STATS',
  'AGGR_CERTIFIER_PENDING_REQUESTS',
  'COM_CHALLENGES',
]) {
  if (!apiSource.includes(marker)) {
    fail(`API config is missing TXCer endpoint ${marker}.`);
  }
}

for (const marker of ['VITE_PANGU_API_BASE_URL', 'getBuildTimeApiBaseUrl', 'normalizeBaseUrl']) {
  if (!apiSource.includes(marker)) {
    fail(`API config is missing service-worker build-time API override marker ${marker}.`);
  }
}

for (const marker of ['ASSIGN_TXCER_CHANGE', 'ASSIGN_TXCER_STATUSES', 'ASSIGN_TXCER_STATUS_CHANGE']) {
  if (!accountPollingSource.includes(marker)) {
    fail(`account polling is missing TXCer lifecycle/compatibility sync marker ${marker}.`);
  }
}

if (!accountPollingSource.includes("addEventListener('txcer_status_change'")) {
  fail('account polling SSE does not listen for txcer_status_change events.');
}

if (!accountPollingSource.includes('applyTXCerStatus')) {
  fail('account polling does not write authoritative lifecycle status into local account state.');
}

if (!txCerStatusSource.includes("getTXCerStatus(account, txCerID) === 'Active'") || !txCerStatusSource.includes("proofStatus !== 'invalid'") || !txCerStatusSource.includes('!isTXCerLocked(txCerID)')) {
  fail('TXCer spendable helper must require authoritative Active status, non-invalid proof, and local construction lock.');
}

if (!txCerStatusSource.includes('TXCER_TERMINAL_STATUSES.includes(view.status)')) {
  fail('terminal TXCer lifecycle states must remove TXCer from spendable stores.');
}

if (txCerStatusSource.includes('delete account.txCerIssuanceRecords?.[txCerID]')) {
  fail('terminal TXCer removal must preserve issuance metadata for audit/history.');
}

if (/account\.txCerIssuanceRecords\s*=\s*\{\s*\}/.test(storageSource)) {
  fail('stale TXCer cleanup must preserve issuance metadata for audit/history.');
}

for (const marker of [
  'buildTXCerIssueKey',
  'buildTXCerIssuanceRecordID',
  'buildTXCerIssueLeaf',
  'computeDirectionalMerkleRoot',
  'verifyTXCerIssueProof',
  "['Signature', 'RecordIDs', 'CreatedAt']",
  'certifier mismatch',
]) {
  if (!txCerIssuanceProofSource.includes(marker)) {
    fail(`TXCer issuance proof helper is missing ${marker}.`);
  }
}

for (const marker of [
  'fetchTXCerIssuanceRecords',
  'fetchTXCerIssuanceRecord',
  'fetchTXCerIssuanceBatch',
  'fetchAggrCertifiers',
  'fetchAssignCertifiers',
  'fetchAggrCertifierStats',
  'fetchAggrCertifierPendingRequests',
  'certifierPublicKeyFromRegistry',
  'buildTXCerIssuanceMetadataFromRegistry',
  'buildTXCerIssuanceMetadata',
  'evaluateTXCerIssueProof',
]) {
  if (!txCerIssuanceSource.includes(marker)) {
    fail(`TXCer issuance query helper is missing ${marker}.`);
  }
}

for (const marker of [
  'export interface TxTaskDAGEvent',
  'export interface TxTaskDAGRecord',
  'export interface SchedulerStatsResponse',
  'export interface CertifierIssueBatchRequest',
]) {
  if (!blockchainSource.includes(marker)) {
    fail(`blockchain types are missing scheduler/certifier marker ${marker}.`);
  }
}

for (const marker of [
  'fetchAssignSchedulerStats',
  'fetchAssignSchedulerDAGRecords',
  'fetchAssignSchedulerDAGEvents',
  'fetchAssignAuditEvents',
  'fetchAggrAuditEvents',
  'fetchAssignChallenges',
  'fetchAggrChallenges',
  'fetchComChallenges',
  'fetchAssignPenalties',
]) {
  if (!protocolDiagnosticsSource.includes(marker)) {
    fail(`protocol diagnostics helper is missing ${marker}.`);
  }
}

if (!txBuilderSource.includes('isTXCerSpendable(user, txCerId)')) {
  fail('txBuilder can still select TXCer without authoritative Active lifecycle status.');
}

if (
  txBuilderSource.includes('baseUrl + API_ENDPOINTS.ASSIGN_SUBMIT_TX') ||
  txBuilderSource.includes('baseUrl + API_ENDPOINTS.ASSIGN_TX_STATUS')
) {
  fail('txBuilder must use buildApiUrl for AssignNode submit/status URLs to avoid double-slash empty JSON responses.');
}

for (const marker of [
  'buildApiUrl(baseUrl, API_ENDPOINTS.ASSIGN_SUBMIT_TX(groupID))',
  'buildApiUrl(baseUrl, API_ENDPOINTS.ASSIGN_TX_STATUS(groupID, txID))',
]) {
  if (!txBuilderSource.includes(marker)) {
    fail(`txBuilder AssignNode URL construction is missing ${marker}.`);
  }
}

if (!transferSource.includes('isTXCerSpendable(account, id)')) {
  fail('transfer locking can still lock/spend TXCer without authoritative Active lifecycle status.');
}

if (!sendPageSource.includes('sumSpendableTXCerValue(account, txCers)')) {
  fail('send page balance does not use authoritative TXCer lifecycle availability.');
}

if (!homePageSource.includes('sumSpendableTXCerValue(account')) {
  fail('home page balance does not use authoritative TXCer lifecycle availability.');
}

for (const marker of ['export interface SettlementAuth', 'SourcePledgeAddress', 'SettlementAuth?: SettlementAuth']) {
  if (!blockchainSource.includes(marker)) {
    fail(`blockchain types are missing ${marker}.`);
  }
}

for (const marker of ['export interface CommitteeReceipt', 'export interface PenaltyRecord', "'PendingGovernance'", "'TXCerIssuanceBatch'"]) {
  if (!blockchainSource.includes(marker)) {
    fail(`blockchain types are missing committee/penalty marker ${marker}.`);
  }
}

for (const marker of ["'ConsumeIntentHash'", "'LeafHash'", "'MerkleRoot'", "'Hash'", "'Root'"]) {
  if (!signatureSource.includes(marker)) {
    fail(`${marker} must be serialized as a Go []byte/base64 field.`);
  }
}

if (!signatureSource.includes("field === 'Signature'")) {
  fail('Signature must be zeroed as ECDSA signature when excluded for TXCer issuance batch verification.');
}

for (const marker of ['zeroSettlementAuth', 'getSettlementIntentHash', 'buildSettlementAuth', 'attachSettlementAuths']) {
  if (!settlementAuthSource.includes(marker)) {
    fail(`settlementAuth helper module is missing TXCer SettlementAuth helper ${marker}.`);
  }
}

if (!settlementAuthSource.includes('SettlementAuth: buildSettlementAuth')) {
  fail('settlementAuth helper module does not attach SettlementAuth to consumed TXCers.');
}

if (!txHashSource.includes("obj.UserSignatureV2 = { Algorithm: '', Signature: null }")) {
  fail('TXID hashing must exclude transaction UserSignatureV2.');
}
if (!txHashSource.includes('TXInputsNormal: filteredInputs')) {
  fail('TXID hashing must mirror Go GetTXHash canonical empty-slice behavior.');
}

const attachIndex = txBuilderSource.indexOf('attachSettlementAuths(transaction, accountPrivKey);');
const signIndex = txBuilderSource.indexOf('transaction.UserSignatureV2 = signHashEnvelope', attachIndex);
const txidIndex = txBuilderSource.indexOf('transaction.TXID = calculateTXID(transaction)', signIndex);
if (attachIndex < 0 || signIndex <= attachIndex || txidIndex <= signIndex) {
  fail('TXCer SettlementAuth must be attached before transaction UserSignatureV2 and TXID calculation.');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[check:protocol] protocol guard checks passed');
