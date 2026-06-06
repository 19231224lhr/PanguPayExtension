import assert from 'node:assert/strict';
import { normalizeDappTxRequest } from '../src/core/dappTxRequest.ts';

const single = normalizeDappTxRequest({
  toAddress: '  abc123  ',
  amount: '12.5',
  coinType: '1',
  transferMode: 'quick',
  gas: '2',
  howMuchPayForGas: '3',
  recipientPublicKey: 'aa,bb',
  recipientOrgId: '20250601',
  transferGas: '0.25',
  SeedAnchor: [1, '2', 'bad'],
  SeedChainStep: '7',
  DefaultSpendAlgorithm: 'ECDSA_P256',
});

assert.equal(single.to, 'abc123');
assert.equal(single.amount, 12.5);
assert.equal(single.coinType, 1);
assert.equal(single.mode, 'quick');
assert.equal(single.gas, 2);
assert.equal(single.extraGas, 3);
assert.equal(single.publicKey, 'aa,bb');
assert.equal(single.orgId, '20250601');
assert.equal(single.transferGas, 0.25);
assert.deepEqual(single.seedAnchor, [1, 2]);
assert.equal(single.seedChainStep, 7);
assert.equal(single.defaultSpendAlgorithm, 'ECDSA_P256');
assert.equal(single.recipients.length, 1);
assert.deepEqual(single.recipients[0], {
  to: 'abc123',
  amount: 12.5,
  coinType: 1,
  publicKey: 'aa,bb',
  orgId: '20250601',
  transferGas: 0.25,
  seedAnchor: [1, 2],
  seedChainStep: 7,
  defaultSpendAlgorithm: 'ECDSA_P256',
});

const multi = normalizeDappTxRequest({
  coinType: 2,
  recipientPublicKey: 'root-public-key',
  recipientOrgId: '87654321',
  recipients: [
    { toAddress: 'first', amount: 1 },
    {
      address: 'second',
      amount: '2',
      publicKey: { X: '11', Y: '22' },
      orgId: '12345678',
      transferGas: 4,
      seedAnchor: 'base64-anchor',
      seedChainStep: 9,
      defaultSpendAlgorithm: 'ECDSA_P256',
    },
  ],
});

assert.equal(multi.mode, 'normal');
assert.equal(multi.recipients.length, 2);
assert.equal(multi.recipients[0].to, 'first');
assert.equal(multi.recipients[0].coinType, 2);
assert.equal(multi.recipients[0].publicKey, undefined);
assert.equal(multi.recipients[0].orgId, undefined);
assert.equal(multi.recipients[1].publicKey, '11,22');
assert.equal(multi.recipients[1].orgId, '12345678');
assert.equal(multi.recipients[1].transferGas, 4);
assert.equal(multi.recipients[1].seedAnchor, 'base64-anchor');
assert.equal(multi.recipients[1].seedChainStep, 9);

const filtered = normalizeDappTxRequest({
  recipients: [
    { to: '', amount: 10 },
    { to: 'zero', amount: 0 },
    { to: 'ok', value: 1 },
  ],
});

assert.equal(filtered.recipients.length, 1);
assert.equal(filtered.recipients[0].to, 'ok');

console.log('[check:dapp] DApp tx request normalization checks passed');
