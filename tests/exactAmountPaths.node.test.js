import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function findInputTag(source, marker) {
  return source.match(new RegExp(`<input\\b[^>]*${marker}[^>]*>`, 's'))?.[0] || '';
}

test('extension keeps CFAA asynchronous and quarantines failed fast evidence', () => {
  const txCerStatus = read('src/core/txCerStatus.ts');
  assert.match(txCerStatus, /fastEvidenceStatus\s*===\s*['\"]Failed['\"]/);
  assert.match(txCerStatus, /!metadata\?\.security\s*&&\s*metadata\?\.proofStatus\s*===\s*['\"]invalid['\"]/);
  assert.doesNotMatch(txCerStatus, /cfaaAuditStatus\s*===\s*['\"]Failed['\"]/);
});

test('extension TXCer details expose exact identity and independent safety states', () => {
  const home = read('src/popup/pages/home.ts');
  for (const marker of ['txcer-full-id', 'FastEvidence', 'CFAA', 'ExposureShares']) {
    assert.match(home, new RegExp(marker));
  }
});

test('extension login and TXCer caches keep protocol amounts exact', () => {
  const auth = read('src/core/auth.ts');
  const storage = read('src/core/storage.ts');
  const blockchain = read('src/core/blockchain.ts');
  const history = read('src/popup/pages/history.ts');
  const polling = read('src/core/accountPolling.ts');
  const status = read('src/core/txCerStatus.ts');
  const transfer = read('src/core/transfer.ts');
  const utxoLock = read('src/core/utxoLock.ts');
  const home = read('src/popup/pages/home.ts');

  assert.match(auth, /txCers:\s*Record<string,\s*AmountDecimal>/);
  assert.doesNotMatch(auth, /Number\(txCer\.Value/);
  assert.doesNotMatch(auth, /numericValue\s*=\s*Number/);
  assert.match(storage, /txCers\?:\s*Record<string,\s*AmountDecimal>/);
  assert.match(blockchain, /value:\s*ProtocolAmount/);
  assert.match(history, /formatAmount\(parseAmount\(amount\)\)/);
  assert.doesNotMatch(history, /toAmountNumber\(amount\)/);
  assert.match(status, /value:\s*formatAmount\(parseAmount\(value\)\)/);
  assert.doesNotMatch(polling, /Math\.abs\([^\n]*amount/);
  assert.match(polling, /amount:\s*normalizeStoredAmount\(utxo\.Value/);
  assert.doesNotMatch(transfer, /const value = Number\(utxoData\?\.Value/);
  assert.match(utxoLock, /value:\s*AmountDecimal/);
  assert.match(utxoLock, /value:\s*formatAmount\(parseAmount\(utxo\.value\)\)/);
  const homeTotals = home.slice(home.indexOf('function getAvailableTotals'), home.indexOf('function attachAccountUpdateListener'));
  const homeSnapshot = home.slice(home.indexOf('function getAddressBalanceSnapshot'), home.indexOf('function copyAddress'));
  for (const source of [homeTotals, homeSnapshot]) {
    assert.match(source, /parseAmount\(/);
    assert.doesNotMatch(source, /Number\([^\n]*(raw|\.Value|\.value|balance|txCer)|parseFloat\(|\.toFixed\(/i);
  }
});

test('extension storage, polling, login and wallet sync keep aggregate amounts exact', () => {
  const storage = read('src/core/storage.ts');
  const polling = read('src/core/accountPolling.ts');
  const auth = read('src/core/auth.ts');
  const walletSync = read('src/core/walletSync.ts');
  const txUser = read('src/core/txUser.ts');

  assert.match(storage, /balance:\s*AmountDecimal/);
  assert.match(storage, /totalBalance:\s*Record<number,\s*AmountDecimal>/);
  assert.match(txUser, /interface AddressValue[\s\S]*totalValue:\s*AmountDecimal[\s\S]*utxoValue:\s*AmountDecimal[\s\S]*txCerValue:\s*AmountDecimal/);

  const recalcAddress = polling.match(/function recalcAddressBalance[\s\S]*?\n}\n/)?.[0] || '';
  const recalcTotal = polling.match(/function recalcTotals[\s\S]*?\n}\n/)?.[0] || '';
  for (const source of [recalcAddress, recalcTotal]) {
    assert.match(source, /parseAmount\(/);
    assert.match(source, /formatAmount\(/);
    assert.doesNotMatch(source, /toAmountNumber\(|Number\([^\n]*(totalValue|utxoValue|txCerValue|txCers)/);
  }

  assert.doesNotMatch(auth, /Number\([^\n]*(TotalValue|totalValue|UTXOValue|utxoValue|TXCerValue|txCerValue)/);
  assert.doesNotMatch(walletSync, /Number\([^\n]*(totalValue|utxoValue|txCerValue|txCers)/);
});

test('extension startup preserves TXCer evidence and forces cached verification replay', () => {
  const storage = read('src/core/storage.ts');
  const main = read('src/popup/main.ts');
  assert.doesNotMatch(main, /clearStaleTxCerData/);
  assert.doesNotMatch(storage, /export async function clearStaleTxCerData/);
  assert.match(storage, /markTXCerEvidenceForReverification/);
  assert.match(storage, /fastEvidenceStatus:[^\n]*'Failed'[^\n]*'Pending'/);
  assert.match(storage, /cfaaAuditStatus:[^\n]*'Failed'[^\n]*'Pending'/);
});

test('extension persists the same unified TXCer client record', () => {
  const blockchain = read('src/core/blockchain.ts');
  const issuance = read('src/core/txCerIssuance.ts');
  assert.match(blockchain, /export interface TXCerClientRecord/);
  assert.match(blockchain, /txCer\?:\s*TxCertificate/);
  assert.match(blockchain, /lifecycleStatus\?:/);
  assert.match(issuance, /txCer:\s*protocolRecord\.TXCer/);
  assert.match(issuance, /lifecycleStatus/);
});

test('extension restart verification never promotes cached evidence when authority fetch is blocked', () => {
  const issuance = read('src/core/txCerIssuance.ts');
  const refresh = issuance.slice(
    issuance.indexOf('export async function refreshTXCerIssuanceMetadata'),
    issuance.indexOf('export async function refreshTXCerIssuanceMetadata') + 3500,
  );
  assert.doesNotMatch(refresh, /catch\s*\{\s*detail\s*=\s*current/);
  assert.match(refresh, /authority replay unavailable/);
  assert.match(refresh, /fastEvidenceStatus:[^\n]*['"]Failed['"][^\n]*['"]Pending['"]/);
});

test('extension cross-org TXCer delivery keeps polling while account SSE is active', () => {
  const polling = read('src/core/accountPolling.ts');
  const pollCrossOrg = polling.slice(
    polling.indexOf('async function pollCrossOrgTXCers'),
    polling.indexOf('function stopCrossOrgTXCerPolling'),
  );
  const startCrossOrg = polling.slice(
    polling.indexOf('function startCrossOrgTXCerPolling'),
    polling.indexOf('function stopAllPolling'),
  );

  assert.doesNotMatch(
    pollCrossOrg,
    /if\s*\(!force\s*&&\s*isAccountPollingActive\(\)\)/,
    'generic account SSE cannot suppress retries for the independent cross-org TXCer queue',
  );
  assert.match(startCrossOrg, /pollCrossOrgTXCers\(true\)/);
  assert.match(startCrossOrg, /setInterval\(pollCrossOrgTXCers,/);
});

test('extension monetary inputs preserve decimal text for exact bigint parsing', () => {
  const send = read('src/popup/pages/send.ts');
  const tags = [
    findInputTag(send, 'id="extraGasPGC"'),
    findInputTag(send, 'id="txGasInput"'),
    findInputTag(send, 'data-recipient-field="amount"'),
    findInputTag(send, 'data-recipient-field="transferGas"'),
  ];

  for (const tag of tags) {
    assert.ok(tag, 'expected monetary input to exist');
    assert.match(tag, /type="text"/);
    assert.match(tag, /inputmode="decimal"/);
    assert.doesNotMatch(tag, /type="number"/);
  }
});
