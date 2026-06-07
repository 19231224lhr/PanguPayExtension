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
const accountPollingSource = read('src/core/accountPolling.ts');
const txCerStatusSource = read('src/core/txCerStatus.ts');
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

for (const marker of ['ASSIGN_TXCER_STATUSES', 'ASSIGN_TXCER_STATUS', 'ASSIGN_TXCER_STATUS_CHANGE']) {
  if (!apiSource.includes(marker)) {
    fail(`API config is missing TXCer lifecycle endpoint ${marker}.`);
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

if (!txCerStatusSource.includes("getTXCerStatus(account, txCerID) === 'Active' && !isTXCerLocked(txCerID)")) {
  fail('TXCer spendable helper must require authoritative Active status plus local construction lock.');
}

if (!txCerStatusSource.includes('TXCER_TERMINAL_STATUSES.includes(view.status)')) {
  fail('terminal TXCer lifecycle states must remove TXCer from spendable stores.');
}

if (!txBuilderSource.includes('isTXCerSpendable(user, txCerId)')) {
  fail('txBuilder can still select TXCer without authoritative Active lifecycle status.');
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

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[check:protocol] protocol guard checks passed');
