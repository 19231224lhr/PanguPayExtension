function canonicalAmount(value) {
  const raw = String(value ?? '0').trim();
  if (!/^(0|[1-9]\d*)(?:\.\d{1,8})?$/.test(raw)) {
    throw new Error(`invalid fixture amount: ${raw}`);
  }
  const [whole, fraction = ''] = raw.split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

function amountUnits(value) {
  const normalized = canonicalAmount(value);
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0') || '0');
}

const DEFAULT_SEED_CHAIN_LENGTH = 1000;

export function getRealBrowserCommitDelaySeconds(value) {
  const parsed = Number(value ?? 25);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 25;
}

export function buildBackendSmokeArguments({
  smokeScript,
  commitDelaySec,
  holdSeconds,
  readyFile,
  stopFile,
}) {
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    smokeScript,
    '-RunGQNCFlow',
    '-ExternalBusinessFlow',
    '-CommitteeNodeCount',
    '4',
    '-GuarBlockCommitDelaySec',
    String(commitDelaySec),
    '-HoldSeconds',
    String(holdSeconds),
    '-ReadyFile',
    readyFile,
    '-StopFile',
    stopFile,
  ];
}

function fixtureAccount(user, groupID, name) {
  if (!user?.accountID || !user?.accountPrivateKey || !user?.address || !user?.addressPrivateKey) {
    throw new Error(`${name} fixture is incomplete`);
  }
  const accountID = String(user.accountID);
  const accountAddress = String(user.accountAddress || '').toLowerCase();
  const address = String(user.address).toLowerCase();
  const balance = canonicalAmount(user.balance ?? '0');
  const hasBalance = amountUnits(balance) > 0n;
  const seedChainStep = Number(user.seedChainStep ?? 0);
  const seedChainLength = Math.max(DEFAULT_SEED_CHAIN_LENGTH, seedChainStep);
  const addressPublicKey = {
    CurveName: 'P256',
    X: BigInt(`0x${String(user.addressPublicKeyXHex || '0')}`).toString(10),
    Y: BigInt(`0x${String(user.addressPublicKeyYHex || '0')}`).toString(10),
  };
  const value = { totalValue: balance, utxoValue: balance, txCerValue: '0' };

  return {
    accountID,
    account: {
      accountId: accountID,
      mainAddress: accountAddress,
      defaultAddress: address,
      onboardingComplete: true,
      onboardingStep: 'complete',
      organizationId: groupID,
      organizationName: 'Smoke Organization',
      mainAddressRegistered: true,
      totalBalance: { 0: balance, 1: '0', 2: '0' },
      createdAt: Date.now(),
      lastLogin: Date.now(),
      addresses: {
        ...(accountAddress ? {
          [accountAddress]: {
            address: accountAddress,
            type: 0,
            balance: '0',
            utxoCount: 0,
            txCerCount: 0,
            source: 'created',
            value: { totalValue: '0', utxoValue: '0', txCerValue: '0' },
          },
        } : {}),
        [address]: {
          address,
          type: Number(user.addressType ?? 0),
          balance,
          utxoCount: hasBalance ? 1 : 0,
          txCerCount: 0,
          source: 'created',
          registrationState: 'registered',
          privHex: String(user.addressPrivateKey),
          addressRootSeedHex: String(user.addressRootSeedHex || ''),
          pubXHex: String(user.addressPublicKeyXHex || ''),
          pubYHex: String(user.addressPublicKeyYHex || ''),
          publicKeyNew: addressPublicKey,
          signPublicKeyV2: user.signPublicKeyV2,
          seedAnchor: user.seedAnchor,
          seedChainStep,
          defaultSpendAlgorithm: String(user.defaultSpendAlgorithm || 'ecdsa_p256'),
          seedLocalState: {
            mode: 'deterministic_p256',
            chainLength: seedChainLength,
            step: seedChainStep,
            generation: 0,
            source: 'plain',
            available: true,
          },
          value,
        },
      },
    },
  };
}

export function buildExtensionSession(user) {
  return {
    accountId: String(user.accountID),
    privKey: String(user.accountPrivateKey),
    expiresAt: Date.now() + 60 * 60 * 1000,
    addressKeys: { [String(user.address).toLowerCase()]: String(user.addressPrivateKey) },
  };
}

export function buildExtensionFixtureStorage(fixture, origin) {
  if (!fixture?.gatewayBase || !fixture?.groupID || !fixture?.alice || !fixture?.bob) {
    throw new Error('real backend fixture is incomplete');
  }
  const groupID = String(fixture.groupID);
  const gatewayBase = String(fixture.gatewayBase).replace(/\/$/, '');
  const alice = fixtureAccount(fixture.alice, groupID, 'Alice');
  const bob = fixtureAccount(fixture.bob, groupID, 'Bob');
  const accounts = [alice, bob];
  const organizations = {};
  const connections = {};
  for (const item of accounts) {
    const user = item.accountID === alice.accountID ? fixture.alice : fixture.bob;
    organizations[item.accountID] = {
      groupId: groupID,
      groupName: 'Smoke Organization',
      name: 'Smoke Organization',
      assignAPIEndpoint: gatewayBase,
      assignNodeUrl: gatewayBase,
      aggrAPIEndpoint: gatewayBase,
      aggrNodeUrl: gatewayBase,
      pledgeAddress: String(fixture.pledgeAddress || 'pledge-real-browser-smoke'),
      joinedAt: Date.now(),
    };
    connections[item.accountID] = {
      [origin]: {
        accountId: item.accountID,
        origin,
        address: String(user.address).toLowerCase(),
        connectedAt: Date.now(),
        title: 'PanguPay real browser flow',
        icon: '',
      },
    };
  }
  return {
    pangu_accounts: Object.fromEntries(accounts.map((item) => [item.accountID, item.account])),
    pangu_active_account: alice.accountID,
    pangu_session: buildExtensionSession(fixture.alice),
    pangu_organization: organizations,
    pangu_dapp_connections: connections,
  };
}

export function assertPureTXCerSubmission(body) {
  const tx = body?.TX;
  if (!tx || tx.TXType !== 1) throw new Error('second payment must use TXType=1');
  if (!Array.isArray(tx.TXInputsNormal) || tx.TXInputsNormal.length !== 0) {
    throw new Error('pure TXCer payment requires empty TXInputsNormal');
  }
  if (!Array.isArray(tx.TXInputsCertificate) || tx.TXInputsCertificate.length === 0) {
    throw new Error('pure TXCer payment requires non-empty TXInputsCertificate');
  }
  if (!/^[0-9a-f]{64}$/i.test(String(tx.TXID || ''))) {
    throw new Error('pure TXCer payment requires a 64-hex TXID');
  }
  for (const input of tx.TXInputsCertificate) {
    const auth = input?.SettlementAuth;
    if (
      !auth
      || !auth.TXCerID
      || auth.TXCerID !== input.TXCerID
      || !auth.ConsumeIntentHash
      || !auth.UserSignatureV2?.Algorithm
      || !auth.UserSignatureV2?.Signature
    ) {
      throw new Error('pure TXCer payment requires complete SettlementAuth');
    }
  }
  return tx;
}

export function assertEvidenceReplay(snapshots) {
  const states = (snapshots || []).map((item) => item?.fastEvidenceStatus);
  if (states[0] !== 'Verified') throw new Error('evidence must be Verified before restart');
  if (!states.slice(1, -1).includes('Pending')) throw new Error('restart evidence must enter Pending');
  if (states.at(-1) !== 'Verified') throw new Error('authority replay must restore Verified');
}

export function getInitialBrowserCompletionStatus({ realBackend, restartFlow }) {
  return realBackend && restartFlow ? 'submitted' : 'success';
}

export function getInitialBrowserHistoryStatus(options) {
  return getInitialBrowserCompletionStatus(options) === 'submitted' ? 'pending' : 'success';
}

export function getBrowserSuccessWaitAttempts({ realBackend }) {
  return 240;
}

export function inspectGQNCFailFastState({
  statusReply,
  safetyReply,
  actionsReply,
  baselineRejectedActionIDs = [],
}) {
  const status = statusReply?.status || {};
  const safety = safetyReply?.safety || {};
  const safetyStatus = String(safety.safetyStatus || status.safetyStatus || '');
  if (safetyStatus === 'WAIT_EXTERNAL_RECOVERY' || safetyStatus === 'SAFETY_BREACH') {
    return {
      ok: false,
      reason: safetyStatus,
      diagnostic: { status, safety },
    };
  }

  const baseline = new Set((baselineRejectedActionIDs || []).map(String));
  const rejected = (actionsReply?.actions || []).filter(
    (action) => String(action?.status || '') === 'Rejected'
      && !baseline.has(String(action?.actionID || '')),
  );
  if (rejected.length > 0) {
    return {
      ok: false,
      reason: 'GQNC_SYSTEM_ACTION_REJECTED',
      diagnostic: { status, safety, rejected },
    };
  }
  return {
    ok: true,
    certifiedHeight: Number(status.certifiedHeight || 0),
  };
}

export function assertMultiRootRecord(record) {
  const txCer = record?.TXCer || record?.txCer;
  const shares = txCer?.ExposureShares || txCer?.exposureShares;
  if (!Array.isArray(shares) || shares.length < 2) {
    throw new Error('multi-root record requires at least two distinct RootID values');
  }
  const roots = new Set(shares.map((share) => String(share?.RootID || share?.rootID || '')));
  if (roots.has('') || roots.size < 2) {
    throw new Error('multi-root record requires at least two distinct RootID values');
  }
  const sum = shares.reduce(
    (total, share) => total + amountUnits(share?.Amount ?? share?.Value ?? share?.amount ?? '0'),
    0n,
  );
  const expected = amountUnits(txCer?.Value ?? txCer?.value ?? '0');
  if (sum !== expected) {
    throw new Error(`share amount sum ${sum} does not equal TXCer value ${expected}`);
  }
  return { rootIDs: [...roots].sort(), shareCount: shares.length };
}
