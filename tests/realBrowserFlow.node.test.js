import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertEvidenceReplay,
  assertMultiRootRecord,
  assertPureTXCerSubmission,
  buildBackendSmokeArguments,
  buildExtensionFixtureStorage,
  getBrowserSuccessWaitAttempts,
  inspectGQNCFailFastState,
  getInitialBrowserCompletionStatus,
  getInitialBrowserHistoryStatus,
  getRealBrowserCommitDelaySeconds,
} from '../scripts/real-browser-flow-helpers.js';

const fixtureUser = (name, accountID, address, balance) => ({
  accountID,
  accountPrivateKey: name === 'alice' ? '1'.repeat(64) : '2'.repeat(64),
  accountAddress: `${name}-account`,
  address,
  addressPrivateKey: name === 'alice' ? '3'.repeat(64) : '4'.repeat(64),
  addressPublicKeyXHex: '5'.repeat(64),
  addressPublicKeyYHex: '6'.repeat(64),
  signPublicKeyV2: { Algorithm: 'ecdsa_p256', PublicKey: [4, 1, 2] },
  seedAnchor: [1, 2, 3],
  seedChainStep: 1000,
  defaultSpendAlgorithm: 'ecdsa_p256',
  balance,
});

const fixture = {
  gatewayBase: 'http://127.0.0.1:39000',
  groupID: '10000000',
  alice: fixtureUser('alice', '90000001', 'a'.repeat(40), 100),
  bob: fixtureUser('bob', '90000002', 'b'.repeat(40), 0),
};

test('real browser backend starts without consuming the browser fixture users first', () => {
  const commitDelaySec = getRealBrowserCommitDelaySeconds();
  const args = buildBackendSmokeArguments({
    smokeScript: 'scripts/dev-backend-smoke.ps1',
    commitDelaySec,
    holdSeconds: 300,
    readyFile: 'ready.json',
    stopFile: 'stop.flag',
  });

  assert.ok(args.includes('-RunGQNCFlow'));
  assert.ok(args.includes('-ExternalBusinessFlow'));
  assert.ok(args.includes('25'));
});

test('real browser commit delay preserves the TXCer through restart and allows overrides', () => {
  assert.equal(getRealBrowserCommitDelaySeconds(), 25);
  assert.equal(getRealBrowserCommitDelaySeconds('75'), 75);
});

test('real browser fixture contains independently usable Alice and Bob accounts', () => {
  const storage = buildExtensionFixtureStorage(fixture, 'http://127.0.0.1:20888');

  assert.deepEqual(Object.keys(storage.pangu_accounts).sort(), ['90000001', '90000002']);
  assert.equal(storage.pangu_active_account, '90000001');
  assert.equal(storage.pangu_accounts['90000001'].totalBalance[0], '100');
  assert.equal(storage.pangu_accounts['90000002'].totalBalance[0], '0');
  assert.equal(storage.pangu_accounts['90000001'].mainAddressRegistered, true);
  assert.equal(storage.pangu_accounts['90000002'].mainAddressRegistered, true);
  assert.equal(storage.pangu_organization['90000002'].assignAPIEndpoint, fixture.gatewayBase);
  assert.equal(storage.pangu_dapp_connections['90000002']['http://127.0.0.1:20888'].address, 'b'.repeat(40));
});

test('real browser fixture keeps the immutable seed chain length when the current step has advanced', () => {
  const advancedFixture = {
    ...fixture,
    bob: {
      ...fixture.bob,
      seedChainStep: 998,
    },
  };
  const storage = buildExtensionFixtureStorage(advancedFixture, 'http://127.0.0.1:20888');
  const seedState = storage.pangu_accounts['90000002'].addresses['b'.repeat(40)].seedLocalState;

  assert.equal(seedState.chainLength, 1000);
  assert.equal(seedState.step, 998);
});

test('second browser payment is accepted only when it is a pure TXCer spend', () => {
  const body = {
    TX: {
      TXID: 'a'.repeat(64),
      TXType: 1,
      TXInputsNormal: [],
      TXInputsCertificate: [{
        TXCerID: 'b'.repeat(64),
        SettlementAuth: {
          TXCerID: 'b'.repeat(64),
          ConsumeIntentHash: [1],
          UserSignatureV2: { Algorithm: 'ecdsa_p256', Signature: [2] },
        },
      }],
    },
  };

  assert.doesNotThrow(() => assertPureTXCerSubmission(body));
  assert.throws(
    () => assertPureTXCerSubmission({ TX: { ...body.TX, TXType: 0 } }),
    /TXType=1/,
  );
  assert.throws(
    () => assertPureTXCerSubmission({ TX: { ...body.TX, TXInputsNormal: [{}] } }),
    /TXInputsNormal/,
  );
  assert.throws(
    () => assertPureTXCerSubmission({ TX: { ...body.TX, TXInputsCertificate: [] } }),
    /TXInputsCertificate/,
  );
  assert.throws(
    () => assertPureTXCerSubmission({
      TX: {
        ...body.TX,
        TXInputsCertificate: [{
          ...body.TX.TXInputsCertificate[0],
          SettlementAuth: {
            ...body.TX.TXInputsCertificate[0].SettlementAuth,
            UserSignatureV2: { Algorithm: '', Signature: null },
          },
        }],
      },
    }),
    /SettlementAuth/,
  );
});

test('restart evidence must pass through Pending before authority replay verifies it', () => {
  assert.doesNotThrow(() => assertEvidenceReplay([
    { fastEvidenceStatus: 'Verified' },
    { fastEvidenceStatus: 'Pending' },
    { fastEvidenceStatus: 'Verified' },
  ]));
  assert.throws(
    () => assertEvidenceReplay([
      { fastEvidenceStatus: 'Verified' },
      { fastEvidenceStatus: 'Verified' },
    ]),
    /Pending/,
  );
});

test('real restart flow hands off on submitted before GQNC converts the TXCer', () => {
  assert.equal(getInitialBrowserCompletionStatus({ realBackend: true, restartFlow: true }), 'submitted');
  assert.equal(getInitialBrowserHistoryStatus({ realBackend: true, restartFlow: true }), 'pending');
  assert.equal(getInitialBrowserCompletionStatus({ realBackend: true, restartFlow: false }), 'success');
  assert.equal(getInitialBrowserHistoryStatus({ realBackend: true, restartFlow: false }), 'success');
  assert.equal(getInitialBrowserCompletionStatus({ realBackend: false, restartFlow: true }), 'success');
  assert.equal(getInitialBrowserHistoryStatus({ realBackend: false, restartFlow: true }), 'success');
});

test('browser UI waits stay bounded and do not mask backend finality failures', () => {
  assert.equal(getBrowserSuccessWaitAttempts({ realBackend: false }), 240);
  assert.equal(getBrowserSuccessWaitAttempts({ realBackend: true }), 240);
});

test('GQNC polling fails fast on new action rejection and safety freeze', () => {
  const rejected = inspectGQNCFailFastState({
    statusReply: { status: { certifiedHeight: 6 } },
    safetyReply: { safety: { safetyStatus: '' } },
    actionsReply: {
      actions: [
        { actionID: 'old', status: 'Rejected' },
        { actionID: 'new', status: 'Rejected', reason: 'state root mismatch' },
      ],
    },
    baselineRejectedActionIDs: ['old'],
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'GQNC_SYSTEM_ACTION_REJECTED');
  assert.equal(rejected.diagnostic.rejected[0].actionID, 'new');

  const frozen = inspectGQNCFailFastState({
    statusReply: { status: { safetyStatus: 'WAIT_EXTERNAL_RECOVERY' } },
    safetyReply: { safety: {} },
    actionsReply: { actions: [] },
  });
  assert.equal(frozen.ok, false);
  assert.equal(frozen.reason, 'WAIT_EXTERNAL_RECOVERY');
});

test('multi-root evidence requires distinct roots and exact share conservation', () => {
  const record = {
    TXCer: {
      Value: '12',
      ExposureShares: [
        { RootID: 'root-a', Amount: '7' },
        { RootID: 'root-b', Amount: '5' },
      ],
    },
  };
  assert.doesNotThrow(() => assertMultiRootRecord(record));
  assert.throws(
    () => assertMultiRootRecord({
      TXCer: { ...record.TXCer, ExposureShares: [{ RootID: 'root-a', Amount: '11' }] },
    }),
    /two distinct RootID/,
  );
  assert.throws(
    () => assertMultiRootRecord({
      TXCer: { ...record.TXCer, ExposureShares: [
        { RootID: 'root-a', Amount: '7' },
        { RootID: 'root-b', Amount: '4' },
      ] },
    }),
    /share amount sum/,
  );
});
