import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('cross-organization TXCer polling is non-destructive and account-scoped', () => {
  const source = fs.readFileSync('src/core/accountPolling.ts', 'utf8');
  const start = source.indexOf('async function pollCrossOrgTXCers');
  const end = source.indexOf('function startTXCerChangePolling', start);
  const poll = source.slice(start, end);
  assert.match(poll, /consume=false/);
  assert.doesNotMatch(poll, /consume=true/);
  assert.match(poll, /const requestAccountId = activeAccountId/);
  assert.match(poll, /mutateAccount\(requestAccountId/);
});

test('retail GQNC address registration carries no legacy Sig', () => {
  const source = fs.readFileSync('src/core/address.ts', 'utf8');
  const start = source.indexOf('export async function registerAddressOnComNode');
  const end = source.indexOf('export async function queryAddressGroupInfo', start);
  const registration = source.slice(start, end);
  assert.match(registration, /buildRetailAddressRegistrationRequest/);
  assert.doesNotMatch(registration, /requestBody\.Sig\s*=/);
});

test('address registration and evidence refresh patch the latest account atomically', () => {
  const address = fs.readFileSync('src/core/address.ts', 'utf8');
  const polling = fs.readFileSync('src/core/accountPolling.ts', 'utf8');
  const registrationStart = address.indexOf('export async function registerAddressesOnMainEntry');
  assert.match(address.slice(registrationStart), /await mutateAccount\(account\.accountId/);
  assert.doesNotMatch(address.slice(registrationStart), /saveAccount\(account\)/);
  const evidenceStart = polling.indexOf('function scheduleTXCerEvidenceRefresh');
  const evidenceEnd = polling.indexOf('async function schedulePendingTXCerEvidenceRefreshes', evidenceStart);
  assert.match(polling.slice(evidenceStart, evidenceEnd), /await mutateAccount\(accountID/);
});

test('evidence refresh uses the account organization endpoint instead of the global API base', () => {
  const polling = fs.readFileSync('src/core/accountPolling.ts', 'utf8');
  const issuance = fs.readFileSync('src/core/txCerIssuance.ts', 'utf8');
  const evidenceStart = polling.indexOf('function scheduleTXCerEvidenceRefresh');
  const evidenceEnd = polling.indexOf('async function schedulePendingTXCerEvidenceRefreshes', evidenceStart);
  const evidenceRefresh = polling.slice(evidenceStart, evidenceEnd);
  assert.match(evidenceRefresh, /getOrganization\(accountID\)/);
  assert.match(evidenceRefresh, /refreshTXCerIssuanceMetadata\([\s\S]*authorityBaseUrl/);
  assert.match(issuance, /function buildAuthorityUrl/);
  assert.match(issuance, /authorityBaseUrl\?: string/);
  assert.match(issuance, /fetchTXCerIssuanceRecord\([\s\S]*authorityBaseUrl/);
  assert.match(issuance, /resolveTXCerAuthoritySnapshot\([\s\S]*authorityBaseUrl/);
});

test('restart authority outage is intercepted in the popup before navigation', () => {
  const smoke = fs.readFileSync('scripts/check-dapp-tx-approve-browser-smoke.js', 'utf8');
  const openStart = smoke.indexOf('async function openBrowserTarget');
  const openEnd = smoke.indexOf('async function readAccountEvidence', openStart);
  const openTarget = smoke.slice(openStart, openEnd);
  assert.match(openTarget, /Fetch\.enable/);
  assert.match(openTarget, /Fetch\.requestPaused/);
  assert.ok(
    openTarget.indexOf("client.send('Fetch.enable'") < openTarget.indexOf("client.send('Page.navigate'"),
    'authority interception must be enabled before popup navigation',
  );
  const restartStart = smoke.indexOf('async function runRealBackendRestartPhase');
  const restart = smoke.slice(restartStart);
  assert.match(restart, /openBrowserTarget\(popupUrl,\s*\{\s*blockAuthority:\s*true\s*\}\)/);
  assert.match(restart, /restartPopup\.send\('Fetch\.disable'\)/);
});

test('a transfer may spend TXCers protected by its own draft lock only', () => {
  const transfer = fs.readFileSync('src/core/transfer.ts', 'utf8');
  const builder = fs.readFileSync('src/core/txBuilder.ts', 'utf8');
  const status = fs.readFileSync('src/core/txCerStatus.ts', 'utf8');
  const locks = fs.readFileSync('src/core/txCerLockManager.ts', 'utf8');
  const walletSync = fs.readFileSync('src/core/walletSync.ts', 'utf8');

  assert.match(transfer, /const txCerLockOwner = `draft:/);
  assert.match(transfer, /lockTXCers\(\s*txCers,[\s\S]*txCerLockOwner[\s,]*\)/);
  assert.match(transfer, /txCerLockOwner/);
  assert.match(builder, /isTXCerSpendable\(user,\s*txCerId,\s*txCerLockOwner\)/);
  assert.match(status, /isTXCerSpendable\([\s\S]*allowedDraftLockOwner/);
  assert.match(locks, /lock\.mode === 'draft'[\s\S]*lock\.relatedTXID === allowedDraftLockOwner/);
  assert.match(walletSync, /txCerIssuanceRecords:\s*account\.txCerIssuanceRecords/);
});
