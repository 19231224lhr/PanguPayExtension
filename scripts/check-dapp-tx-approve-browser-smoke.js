import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import {
  assertEvidenceReplay,
  assertPureTXCerSubmission,
  buildExtensionFixtureStorage,
  buildExtensionSession,
  getInitialBrowserCompletionStatus,
  getInitialBrowserHistoryStatus,
  inspectGQNCFailFastState,
} from './real-browser-flow-helpers.js';

const require = createRequire(import.meta.url);
const { ec: EC } = require('elliptic');
const { sha256 } = require('js-sha256');

const ec = new EC('p256');
const root = process.cwd();
const extensionDir = path.join(root, 'dist');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pangupay-dapp-tx-approve-flow-'));
const debugPort = Number(process.env.PANGUPAY_EDGE_DEBUG_PORT || (10800 + Math.floor(Math.random() * 500)));
const dappPort = Number(process.env.PANGUPAY_DAPP_TX_APPROVE_SMOKE_PORT || (20000 + Math.floor(Math.random() * 1000)));
const realBackendFixture = loadRealBackendFixture();
const isRealBackendMode = Boolean(realBackendFixture);
const fixtureAlice = realBackendFixture?.alice || {};
const fixtureBob = realBackendFixture?.bob || {};
const accountId = String(fixtureAlice.accountID || '90000003');
const bobAccountId = String(fixtureBob.accountID || '90000004');
const groupId = String(realBackendFixture?.groupID || '10000000');
const mainAddress = String(fixtureAlice.accountAddress || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').toLowerCase();
const walletAddress = String(fixtureAlice.address || 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb').toLowerCase();
const recipientAddress = String(fixtureBob.address || 'cccccccccccccccccccccccccccccccccccccccc').toLowerCase();
const bobMainAddress = String(fixtureBob.accountAddress || 'dddddddddddddddddddddddddddddddddddddddd').toLowerCase();
const mockBaseUrl = String(realBackendFixture?.gatewayBase || 'http://127.0.0.1:39999').replace(/\/$/, '');
const accountPrivKey = String(fixtureAlice.accountPrivateKey || '3'.repeat(64));
const addressPrivKey = String(fixtureAlice.addressPrivateKey || '4'.repeat(64));
const recipientPrivKey = String(fixtureBob.addressPrivateKey || '5'.repeat(64));
const transferAmount = Number(process.env.PANGUPAY_DAPP_APPROVE_AMOUNT || 12);
const returnAmount = String(process.env.PANGUPAY_DAPP_RETURN_AMOUNT || '5');
const txId = 'dapp-approve-smoke-tx-0001';
const sourceTxId = 'dapp-approve-source-utxo-0001';
const now = Date.now();
const textEncoder = new TextEncoder();
const expectedApiHost = String(process.env.PANGUPAY_EXPECT_API_HOST || '').trim().toLowerCase();

function loadRealBackendFixture() {
  const fixturePath = String(process.env.PANGUPAY_REAL_BACKEND_FIXTURE || '').trim();
  if (!fixturePath) return null;
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed?.gatewayBase || !parsed?.groupID || !parsed?.alice?.accountID || !parsed?.alice?.address) {
    throw new Error(`Invalid real backend fixture: ${fixturePath}`);
  }
  if (!parsed?.alice?.accountPrivateKey || !parsed?.alice?.addressPrivateKey) {
    throw new Error(`Real backend fixture is missing Alice private keys: ${fixturePath}`);
  }
  if (!parsed?.bob?.address || !parsed?.bob?.addressPrivateKey) {
    throw new Error(`Real backend fixture is missing Bob address/private key: ${fixturePath}`);
  }
  return parsed;
}

function findEdgePath() {
  const candidates = [
    process.env.PANGUPAY_EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function readCrossOrgQueue(userId) {
  const url = `${mockBaseUrl}/api/v1/${groupId}/assign/poll-cross-org-txcers?userID=${encodeURIComponent(userId)}&limit=10&consume=false`;
  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`cross-org queue diagnostic failed: ${response.status} ${body}`);
  }
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* diagnostic only */ }
  const messages = parsed?.messages || parsed?.txcers || parsed?.data || [];
  return {
    url,
    status: response.status,
    messageCount: Array.isArray(messages) ? messages.length : undefined,
    body: body.slice(0, 1200),
  };
}

async function readGQNCCheckpoint() {
  const [statusReply, safetyReply, actionsReply] = await Promise.all([
    getJson(`${mockBaseUrl}/api/v1/committee/gqnc/status`),
    getJson(`${mockBaseUrl}/api/v1/committee/gqnc/safety`),
    getJson(`${mockBaseUrl}/api/v1/committee/gqnc/actions`),
  ]);
  return {
    statusReply,
    safetyReply,
    actionsReply,
    certifiedHeight: Number(statusReply?.status?.certifiedHeight || 0),
    rejectedActionIDs: (actionsReply?.actions || [])
      .filter((action) => String(action?.status || '') === 'Rejected')
      .map((action) => String(action?.actionID || '')),
  };
}

async function waitForGQNCCertifiedTransactions({
  txIDs,
  baselineHeight,
  baselineRejectedActionIDs,
  timeoutMs = Number(process.env.PANGUPAY_GQNC_CERTIFIED_TIMEOUT_MS || 120000),
}) {
  const wanted = new Set((txIDs || []).map((value) => String(value || '')).filter(Boolean));
  const found = new Map();
  let nextHeight = Number(baselineHeight || 0) + 1;
  let lastCheckpoint = null;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    lastCheckpoint = await readGQNCCheckpoint();
    const health = inspectGQNCFailFastState({
      ...lastCheckpoint,
      baselineRejectedActionIDs,
    });
    if (!health.ok) {
      throw new Error(`GQNC failed before transaction certification: ${JSON.stringify({
        reason: health.reason,
        diagnostic: health.diagnostic,
        wanted: [...wanted],
        found: [...found.entries()],
      })}`);
    }

    while (nextHeight <= lastCheckpoint.certifiedHeight) {
      const blockReply = await getJson(
        `${mockBaseUrl}/api/v1/committee/gqnc/certified-block/${nextHeight}`,
      );
      const encoded = JSON.stringify(blockReply?.envelope || {});
      for (const txID of wanted) {
        if (!found.has(txID) && encoded.includes(txID)) {
          found.set(txID, {
            height: nextHeight,
            qcID: String(blockReply?.envelope?.QC?.QCID || ''),
            observedAt: Date.now(),
          });
        }
      }
      nextHeight += 1;
    }
    if (found.size === wanted.size) {
      return {
        startedAt,
        completedAt: Date.now(),
        elapsedMs: Date.now() - startedAt,
        transactions: Object.fromEntries(found),
        certifiedHeight: lastCheckpoint.certifiedHeight,
      };
    }
    await sleep(500);
  }
  throw new Error(`Timeout waiting for exact GQNC transaction certification: ${JSON.stringify({
    wanted: [...wanted],
    found: [...found.entries()],
    baselineHeight,
    lastCheckpoint,
  })}`);
}

async function waitForDevTools() {
  for (let i = 0; i < 100; i += 1) {
    try {
      return await getJson(`http://127.0.0.1:${debugPort}/json/list`);
    } catch {
      await sleep(250);
    }
  }
  throw new Error('Edge DevTools endpoint did not become ready.');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const events = [];
    const listeners = new Map();

    ws.addEventListener('open', () => {
      resolve({
        events,
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { res, rej, method }));
        },
        close() {
          try {
            ws.close();
          } catch {
            // ignore cleanup errors
          }
        },
        on(method, listener) {
          const registered = listeners.get(method) || [];
          registered.push(listener);
          listeners.set(method, registered);
        },
      });
    });

    ws.addEventListener('message', (message) => {
      const data = JSON.parse(message.data);
      if (data.id && pending.has(data.id)) {
        const entry = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) entry.rej(new Error(`${entry.method}: ${data.error.message}`));
        else entry.res(data.result);
      } else {
        events.push(data);
        for (const listener of listeners.get(data.method) || []) {
          Promise.resolve()
            .then(() => listener(data.params || {}))
            .catch(() => {});
        }
      }
    });

    ws.addEventListener('error', reject);
  });
}

async function evaluateTarget(target, expression) {
  const client = await connect(target.webSocketDebuggerUrl);
  try {
    await client.send('Runtime.enable');
    const result = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  } finally {
    client.close();
  }
}

async function evaluatePage(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

async function waitFor(client, predicateSource, label, attempts = 240) {
  for (let i = 0; i < attempts; i += 1) {
    const ok = await evaluatePage(
      client,
      `(() => {
        try {
          return Boolean((${predicateSource})());
        } catch {
          return false;
        }
      })()`
    );
    if (ok) return;
    await sleep(250);
  }
  const snapshot = await evaluatePage(
    client,
    `(() => ({
      href: location.href,
      title: document.title,
      text: (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 700),
      currentPage: window.__currentPage || null,
      result: window.__panguTxResult || null,
      error: window.__panguTxError || null,
      events: window.__panguTxEvents || [],
    }))()`
  );
  throw new Error(`Timeout waiting for ${label}. Snapshot=${JSON.stringify(snapshot)}`);
}

function hexToBytes(hex) {
  const normalized = String(hex || '').replace(/^0x/i, '').toLowerCase();
  const out = [];
  for (let i = 0; i < normalized.length; i += 2) {
    out.push(parseInt(normalized.slice(i, i + 2), 16));
  }
  return out;
}

function pad32(bytes) {
  if (bytes.length >= 32) return bytes.slice(bytes.length - 32);
  return [...new Array(32 - bytes.length).fill(0), ...bytes];
}

function hashBytes(bytes) {
  return Array.from(sha256.array(Array.from(bytes)));
}

function buildSeedMeta(privateKeyHex) {
  const scalarBytes = pad32(hexToBytes(privateKeyHex));
  const domain = Array.from(textEncoder.encode('pangu-seedchain-v2:0:'));
  const masterSeed = hashBytes([...domain, ...scalarBytes]);
  const chain = new Array(1001);
  chain[0] = hashBytes(masterSeed);
  for (let index = 1; index <= 1000; index += 1) {
    chain[index] = hashBytes(chain[index - 1]);
  }
  return {
    seedAnchor: hashBytes(chain[1000]),
    seedChainStep: 1000,
    defaultSpendAlgorithm: 'ecdsa_p256',
    seedLocalState: {
      mode: 'deterministic_p256',
      chainLength: 1000,
      step: 1000,
      generation: 0,
      source: 'plain',
      available: true,
    },
  };
}

function publicKeyFromPrivate(privateKeyHex) {
  const key = ec.keyFromPrivate(String(privateKeyHex || '').padStart(64, '0'), 'hex');
  return {
    xHex: key.getPublic().getX().toString(16).padStart(64, '0'),
    yHex: key.getPublic().getY().toString(16).padStart(64, '0'),
  };
}

function publicKeyEnvelope(pub) {
  return {
    Algorithm: 'ecdsa_p256',
    PublicKey: hexToBytes(`04${pub.xHex}${pub.yHex}`),
  };
}

function publicKeyNew(pub) {
  return {
    CurveName: 'P256',
    X: BigInt(`0x${pub.xHex}`).toString(10),
    Y: BigInt(`0x${pub.yHex}`).toString(10),
  };
}

const accountPub = publicKeyFromPrivate(accountPrivKey);
const addressPub = publicKeyFromPrivate(addressPrivKey);
const recipientPub = publicKeyFromPrivate(recipientPrivKey);
const addressSeedMeta = buildSeedMeta(addressPrivKey);
const recipientSeedMeta = buildSeedMeta(recipientPrivKey);
const accountSignPublicKeyV2 = publicKeyEnvelope(accountPub);

function sourceOutput(address, pub, seedMeta, value) {
  return {
    ToAddress: address,
    ToValue: value,
    ToGuarGroupID: groupId,
    ToPublicKey: publicKeyNew(pub),
    ToInterest: 0,
    Type: 0,
    ToCoinType: 0,
    ToPeerID: '',
    IsPayForGas: false,
    IsCrossChain: false,
    IsGuarMake: false,
    SeedAnchor: seedMeta.seedAnchor,
    SeedChainStep: seedMeta.seedChainStep,
    DefaultSpendAlgorithm: seedMeta.defaultSpendAlgorithm,
  };
}

function mockQueryAddressResponse() {
  return {
    FromGroupID: groupId,
    AddressData: {
      [walletAddress]: {
        Value: 100,
        Type: 0,
        Interest: 0,
        GroupID: groupId,
        PublicKeyNew: publicKeyNew(addressPub),
        SignPublicKeyV2: accountSignPublicKeyV2,
        SeedAnchor: addressSeedMeta.seedAnchor,
        SeedChainStep: addressSeedMeta.seedChainStep,
        DefaultSpendAlgorithm: addressSeedMeta.defaultSpendAlgorithm,
        UTXO: {
          [`${sourceTxId} + 0`]: {
            Value: 100,
            Type: 0,
            Time: now,
            Position: { Blocknum: 1, IndexX: 0, IndexY: 0, IndexZ: 0 },
            IsTXCerUTXO: false,
            UTXO: {
              TXID: sourceTxId,
              TXType: 0,
              TXInputsNormal: [],
              TXInputsCertificate: [],
              TXOutputs: [sourceOutput(walletAddress, addressPub, addressSeedMeta, 100)],
              InterestAssign: { Gas: 0, Output: 0, BackAssign: {} },
              ExTXCerID: [],
              Data: [],
            },
          },
        },
        LastHeight: 1,
      },
    },
    Sig: { R: 0, S: 0 },
  };
}

function mockQueryAddressGroupResponse() {
  return {
    UserID: accountId,
    Addresstogroup: {
      [recipientAddress]: {
        GroupID: groupId,
        Type: 0,
        PublicKey: publicKeyNew(recipientPub),
        SignPublicKeyV2: accountSignPublicKeyV2,
        SeedAnchor: recipientSeedMeta.seedAnchor,
        SeedChainStep: recipientSeedMeta.seedChainStep,
        DefaultSpendAlgorithm: recipientSeedMeta.defaultSpendAlgorithm,
      },
      [walletAddress]: {
        GroupID: groupId,
        Type: 0,
        PublicKey: publicKeyNew(addressPub),
        SignPublicKeyV2: accountSignPublicKeyV2,
        SeedAnchor: addressSeedMeta.seedAnchor,
        SeedChainStep: addressSeedMeta.seedChainStep,
        DefaultSpendAlgorithm: addressSeedMeta.defaultSpendAlgorithm,
      },
    },
  };
}

function createDappServer() {
  const server = http.createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    const requestURL = new URL(request.url || '/', `http://127.0.0.1:${dappPort}`);
    const isReturnPayment = requestURL.searchParams.get('phase') === '2';
    const targetAddress = isReturnPayment ? walletAddress : recipientAddress;
    const targetPub = isReturnPayment ? addressPub : recipientPub;
    const targetSeedMeta = isReturnPayment ? addressSeedMeta : recipientSeedMeta;
    const amount = isReturnPayment ? returnAmount : String(transferAmount);
    const mode = isReturnPayment ? 'quick' : 'normal';
    const html = `<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <title>PanguPay DApp TX Approve Browser Smoke</title>
      </head>
      <body>
        <h1>PanguPay DApp TX Approve Browser Smoke</h1>
        <button id="send">Send Transaction</button>
        <pre id="status">idle</pre>
        <script>
          window.__panguTxResult = null;
          window.__panguTxError = null;
          window.__panguTxEvents = [];
          function setStatus(value) {
            document.getElementById('status').textContent = value;
          }
          async function waitPangu() {
            if (window.pangu) return;
            await new Promise((resolve) => window.addEventListener('panguReady', resolve, { once: true }));
          }
          document.getElementById('send').addEventListener('click', async () => {
            try {
              await waitPangu();
              window.pangu.on('txStatus', (event) => {
                window.__panguTxEvents.push(event);
              });
              setStatus('submitting');
              const result = await window.pangu.sendTransaction({
                mode: '${mode}',
                coinType: 0,
                gas: 0,
                recipients: [{
                  to: '${targetAddress}',
                  amount: '${amount}',
                  coinType: 0,
                  publicKey: '${targetPub.xHex},${targetPub.yHex}',
                  orgId: '${groupId}',
                  seedAnchor: ${JSON.stringify(targetSeedMeta.seedAnchor)},
                  seedChainStep: ${targetSeedMeta.seedChainStep},
                  defaultSpendAlgorithm: '${targetSeedMeta.defaultSpendAlgorithm}'
                }]
              });
              window.__panguTxResult = result;
              setStatus('submitted ' + JSON.stringify(result));
            } catch (error) {
              window.__panguTxError = error && error.message ? error.message : String(error);
              setStatus('error ' + window.__panguTxError);
            }
          });
        </script>
      </body>
    </html>`;

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(dappPort, '127.0.0.1', () => resolve(server));
  });
}

function smokeStoragePayload(origin) {
  if (isRealBackendMode) {
    return buildExtensionFixtureStorage(realBackendFixture, origin);
  }
  const account = {
    accountId,
    mainAddress,
    defaultAddress: walletAddress,
    onboardingComplete: true,
    onboardingStep: 'complete',
    organizationId: groupId,
    organizationName: 'Smoke Organization',
    totalBalance: { 0: 100, 1: 0, 2: 0 },
    createdAt: now,
    lastLogin: now,
    addresses: {
      [mainAddress]: {
        address: mainAddress,
        type: 0,
        balance: 0,
        utxoCount: 0,
        txCerCount: 0,
        source: 'created',
        value: { totalValue: 0, utxoValue: 0, txCerValue: 0 },
      },
      [walletAddress]: {
        address: walletAddress,
        type: 0,
        balance: 100,
        utxoCount: 1,
        txCerCount: 0,
        source: 'created',
        registrationState: 'registered',
        privHex: addressPrivKey,
        pubXHex: addressPub.xHex,
        pubYHex: addressPub.yHex,
        publicKeyNew: publicKeyNew(addressPub),
        signPublicKeyV2: accountSignPublicKeyV2,
        seedAnchor: addressSeedMeta.seedAnchor,
        seedChainStep: addressSeedMeta.seedChainStep,
        defaultSpendAlgorithm: addressSeedMeta.defaultSpendAlgorithm,
        seedLocalState: addressSeedMeta.seedLocalState,
        value: { totalValue: 100, utxoValue: 100, txCerValue: 0 },
      },
    },
  };

  return {
    pangu_accounts: { [accountId]: account },
    pangu_active_account: accountId,
    pangu_session: {
      accountId,
      privKey: accountPrivKey,
      expiresAt: Date.now() + 60 * 60 * 1000,
      addressKeys: { [walletAddress]: addressPrivKey },
    },
    pangu_organization: {
      [accountId]: {
        groupId,
        groupName: 'Smoke Organization',
        name: 'Smoke Organization',
        assignAPIEndpoint: mockBaseUrl,
        assignNodeUrl: mockBaseUrl,
        aggrAPIEndpoint: mockBaseUrl,
        aggrNodeUrl: mockBaseUrl,
        pledgeAddress: 'pledge-approve-smoke',
        joinedAt: now,
      },
    },
    pangu_dapp_connections: {
      [accountId]: {
        [origin]: {
          accountId,
          origin,
          address: walletAddress,
          connectedAt: now,
          title: 'PanguPay DApp TX Approve Browser Smoke',
          icon: '',
        },
      },
    },
  };
}

function installMockFetchExpression() {
  const setup = {
    mockBaseUrl,
    groupId,
    txId,
    queryAddress: mockQueryAddressResponse(),
    queryAddressGroup: mockQueryAddressGroupResponse(),
  };
  return `(() => {
    const setup = ${JSON.stringify(setup)};
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.__panguApproveSmokeRequests = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
      const method = String(init && init.method ? init.method : 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : '';
      let path = '';
      try {
        path = new URL(url).pathname;
      } catch {
        path = String(url || '');
      }
      const normalizedPath = path.replace(/^\\/+/g, '/');
      globalThis.__panguApproveSmokeRequests.push({ url, method, path, normalizedPath, body });
      const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });

      if (normalizedPath === '/api/v1/committee/endpoint') {
        return json({ endpoint: setup.mockBaseUrl });
      }
      if (normalizedPath === '/api/v1/com/query-address') {
        return json(setup.queryAddress);
      }
      if (normalizedPath === '/api/v1/com/query-address-group') {
        return json(setup.queryAddressGroup);
      }
      if (normalizedPath === '/api/v1/groups/' + setup.groupId) {
        return json({
          group_id: setup.groupId,
          assign_api_endpoint: setup.mockBaseUrl,
          aggr_api_endpoint: setup.mockBaseUrl,
          pledge_address: 'pledge-approve-smoke',
          group_name: 'Smoke Organization',
        });
      }
      if (normalizedPath === '/api/v1/' + setup.groupId + '/assign/submit-tx') {
        return json({ success: true, tx_id: setup.txId, status: 'submitted' });
      }
      if (normalizedPath === '/api/v1/' + setup.groupId + '/assign/tx-status/' + setup.txId) {
        return json({
          tx_id: setup.txId,
          status: 'success',
          receive_result: true,
          result: true,
          error_reason: '',
          guar_id: 'smoke-guar',
          user_id: '${accountId}',
          block_height: 9,
        });
      }
      if (url.startsWith('http://47.243.174.71:3001') || url.includes(':39999') || url.startsWith(setup.mockBaseUrl)) {
        return json({ success: false, error: 'Unhandled approve smoke mock endpoint: ' + method + ' ' + normalizedPath }, 500);
      }
      return originalFetch(input, init);
    };
    return true;
  })()`;
}

function installFetchCaptureExpression() {
  return `(() => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.__panguApproveSmokeRequests = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
      const method = String(init && init.method ? init.method : 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : '';
      let path = '';
      try {
        path = new URL(url).pathname;
      } catch {
        path = String(url || '');
      }
      const normalizedPath = path.replace(/^\\/+/g, '/');
      globalThis.__panguApproveSmokeRequests.push({ url, method, path, normalizedPath, body });
      return originalFetch(input, init);
    };
    return true;
  })()`;
}

function installIssuanceBlockExpression() {
  return `(() => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.__panguAuthorityFetch = originalFetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
      if (/\\/aggr\\/txcer-issuance-record\\//.test(url)) {
        throw new TypeError('authority issuance query blocked by restart test');
      }
      return originalFetch(input, init);
    };
    return true;
  })()`;
}

function restoreAuthorityFetchAndCaptureExpression() {
  return `(() => {
    if (globalThis.__panguAuthorityFetch) {
      globalThis.fetch = globalThis.__panguAuthorityFetch;
      delete globalThis.__panguAuthorityFetch;
    }
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.__panguApproveSmokeRequests = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
      const method = String(init && init.method ? init.method : 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : '';
      let normalizedPath = '';
      try { normalizedPath = new URL(url).pathname.replace(/^\\/+/g, '/'); }
      catch { normalizedPath = String(url || ''); }
      const entry = { url, method, normalizedPath, body, responseStatus: 0, responseBody: '' };
      globalThis.__panguApproveSmokeRequests.push(entry);
      const response = await originalFetch(input, init);
      entry.responseStatus = response.status;
      try { entry.responseBody = (await response.clone().text()).slice(0, 4000); }
      catch { /* diagnostic only */ }
      return response;
    };
    return true;
  })()`;
}

function spawnEdgeProcess(edgePath) {
  return spawn(edgePath, [
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    `--remote-debugging-port=${debugPort}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    '--window-position=-32000,-32000',
    '--window-size=900,700',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function stopEdgeProcess(edgeProcess) {
  if (!edgeProcess?.pid) return;
  try {
    execFileSync('taskkill', ['/PID', String(edgeProcess.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // Process may already be gone.
  }
  const profileToken = path.basename(profileDir);
  try {
    const ps = `
      $profileToken = ${JSON.stringify(profileToken)};
      Get-CimInstance Win32_Process |
        Where-Object {
          ($_.Name -match 'msedge|chrome') -and
          ($_.CommandLine -like "*$profileToken*")
        } |
        ForEach-Object {
          Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    `;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
  } catch {
    // Best-effort cleanup.
  }
}

async function findPanguExtensionRuntime() {
  await waitForDevTools();
  await sleep(2500);
  const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
  const workers = targets.filter(
    (target) => target.type === 'service_worker' && String(target.url || '').startsWith('chrome-extension://'),
  );
  for (const target of workers) {
    try {
      const info = await evaluateTarget(target, `(() => ({ id: chrome.runtime.id, manifest: chrome.runtime.getManifest() }))()`);
      if (info?.manifest?.name === 'PanguPay Wallet') return { target, info };
    } catch {
      // Ignore unrelated or stopping workers.
    }
  }
  throw new Error('PanguPay service worker not found after Edge restart');
}

async function openBrowserTarget(url, { blockAuthority = false } = {}) {
  const initialUrl = blockAuthority ? 'about:blank' : url;
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(initialUrl)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Failed to create browser target: ${response.status} ${await response.text()}`);
  const target = await response.json();
  const client = await connect(target.webSocketDebuggerUrl);
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  if (blockAuthority) {
    client.on('Fetch.requestPaused', async ({ requestId }) => {
      await client.send('Fetch.failRequest', {
        requestId,
        errorReason: 'Failed',
      });
    });
    await client.send('Fetch.enable', {
      patterns: [{
        urlPattern: '*txcer-issuance-record*',
        requestStage: 'Request',
      }],
    });
  }
  await client.send('Page.navigate', { url });
  return client;
}

async function readAccountEvidence(workerClient, targetAccountId) {
  return evaluatePage(workerClient, `(async () => new Promise((resolve) => chrome.storage.local.get(null, (storage) => {
    const account = storage.pangu_accounts?.[${JSON.stringify(targetAccountId)}] || {};
    const records = account.txCerIssuanceRecords || {};
    const statuses = account.txCerStatuses || {};
    const store = account.txCerStore || {};
    const entries = Object.entries(records).map(([txCerID, metadata]) => ({
      txCerID,
      lifecycleStatus: statuses[txCerID]?.status || metadata?.lifecycleStatus || metadata?.issuanceStatus || '',
      security: metadata?.security || null,
      issuanceRecordID: metadata?.issuanceRecordID || '',
      hasAuthoritySnapshot: Boolean(metadata?.authoritySnapshot),
      hasFastEvidence: Boolean(metadata?.fastEvidence || metadata?.issuanceRecord?.FastEvidence),
      hasAck: Boolean(metadata?.assignAck || metadata?.issuanceRecord?.Ack),
      hasReceipt: Boolean(metadata?.liabilityReceipt || metadata?.issuanceRecord?.LiabilityReceipt),
      txCer: store[txCerID] || metadata?.txCer || metadata?.issuanceRecord?.TXCer || null,
    }));
    resolve({ activeAccount: storage.pangu_active_account || '', entries });
  })))()`);
}

async function installStorageIdentityDiagnostics(workerClient) {
  await evaluatePage(workerClient, `(() => {
    if (globalThis.__panguStorageIdentityDiagnosticInstalled) return true;
    globalThis.__panguStorageIdentityDiagnosticInstalled = true;
    globalThis.__panguStorageIdentityChanges = [];
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      const active = changes.pangu_active_account;
      const session = changes.pangu_session;
      if (!active && !session) return;
      globalThis.__panguStorageIdentityChanges.push({
        at: Date.now(),
        active: active ? {
          oldValue: active.oldValue || '',
          newValue: active.newValue || '',
        } : null,
        session: session ? {
          oldAccountId: session.oldValue?.accountId || '',
          newAccountId: session.newValue?.accountId || '',
        } : null,
      });
    });
    return true;
  })()`);
}

async function readStorageIdentityDiagnostics(workerClient, label) {
  return evaluatePage(workerClient, `(async () => new Promise((resolve) => {
    chrome.storage.local.get(['pangu_active_account', 'pangu_session'], (storage) => resolve({
      label: ${JSON.stringify(label)},
      at: Date.now(),
      activeAccount: storage.pangu_active_account || '',
      sessionAccount: storage.pangu_session?.accountId || '',
      changes: globalThis.__panguStorageIdentityChanges || [],
    }));
  }))()`);
}

async function waitForEvidenceState(workerClient, targetAccountId, expectedState, label) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const snapshot = await readAccountEvidence(workerClient, targetAccountId);
    const record = snapshot.entries.find((entry) => entry.security?.fastEvidenceStatus === expectedState);
    if (record) return { ...snapshot, record };
    await sleep(250);
  }
  throw new Error(`Timeout waiting for ${label}: ${JSON.stringify(await readAccountEvidence(workerClient, targetAccountId))}`);
}

async function approveDappPhase(workerClient, extensionId, dappOrigin, phase, expectedRecipient) {
  const startedAt = Date.now();
  const dappUrl = `${dappOrigin}/?phase=${phase}`;
  const dappClient = await openBrowserTarget(dappUrl);
  await waitFor(dappClient, `() => Boolean(window.pangu)`, `phase ${phase} window.pangu injection`);
  await evaluatePage(dappClient, `(() => { document.querySelector('#send').click(); return true; })()`);
  await waitFor(
    dappClient,
    `() => (document.querySelector('#status')?.textContent || '').includes('submitting')`,
    `phase ${phase} pending request`,
  );

  const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
  const popupClient = await openBrowserTarget(popupUrl);
  await waitFor(
    popupClient,
    `() => window.__currentPage === 'dappTransaction' && document.querySelector('#dappTxApproveBtn') && document.body.innerText.includes('${expectedRecipient}')`,
    `phase ${phase} transaction confirmation`,
  );
  await evaluatePage(popupClient, `(() => { document.querySelector('#dappTxApproveBtn').click(); return true; })()`);
  await waitFor(
    dappClient,
    `() => Boolean(window.__panguTxResult) || Boolean(window.__panguTxError)`,
    `phase ${phase} approve result`,
  );
  const early = await evaluatePage(dappClient, `(() => ({
    result: window.__panguTxResult,
    error: window.__panguTxError,
    events: window.__panguTxEvents || [],
  }))()`);
  const requests = await evaluatePage(workerClient, `(() => globalThis.__panguApproveSmokeRequests || [])()`);
  if (early.error) {
    const submitDiagnostics = requests
      .filter((request) => request.normalizedPath === `/api/v1/${groupId}/assign/submit-tx`)
      .map((request) => ({
        url: request.url,
        method: request.method,
        body: request.body,
        responseStatus: request.responseStatus,
        responseBody: request.responseBody,
      }));
    throw new Error(`phase ${phase} transaction failed: ${JSON.stringify({ ...early, submitDiagnostics })}`);
  }
  const phaseTxId = early.result?.txId;
  const submits = requests.filter(
    (request) => request.normalizedPath === `/api/v1/${groupId}/assign/submit-tx`,
  );
  if (submits.length !== 1) {
    throw new Error(`phase ${phase} expected one submit request before finality, got ${JSON.stringify(submits)}`);
  }
  assertPureTXCerSubmission(JSON.parse(submits[0].body));
  const result = await evaluatePage(dappClient, `(() => ({
    result: window.__panguTxResult,
    error: window.__panguTxError,
    events: window.__panguTxEvents || [],
  }))()`);
  dappClient.close();
  popupClient.close();
  return {
    result,
    requests,
    milestone: {
      txId: phaseTxId,
      assignAcceptedAt: Date.now(),
      assignAcceptMs: Date.now() - startedAt,
    },
  };
}

async function runRealBackendRestartPhase({
  edgePath,
  edgeProcess,
  workerClient,
  extensionId,
  dappOrigin,
  initialTransaction,
  gqncBaseline,
}) {
  const backendQueueBeforeBob = await readCrossOrgQueue(bobAccountId);
  const bobSession = buildExtensionSession(fixtureBob);
  await installStorageIdentityDiagnostics(workerClient);
  const identityBeforeSwitch = await readStorageIdentityDiagnostics(workerClient, 'before-bob-switch');
  await evaluatePage(workerClient, `(async () => {
    const writeIdentity = () => new Promise((resolve) => chrome.storage.local.set({
      pangu_active_account: ${JSON.stringify(bobAccountId)},
      pangu_session: ${JSON.stringify(bobSession)}
    }, resolve));
    if (navigator?.locks?.request) {
      await navigator.locks.request('pangupay-session', { mode: 'exclusive' }, writeIdentity);
    } else {
      await writeIdentity();
    }
  })()`);
  const identityAfterSwitch = await readStorageIdentityDiagnostics(workerClient, 'after-bob-switch');
  if (
    identityAfterSwitch.activeAccount !== bobAccountId
    || identityAfterSwitch.sessionAccount !== bobAccountId
  ) {
    throw new Error(`Bob identity switch was not durable: ${JSON.stringify({
      identityBeforeSwitch,
      identityAfterSwitch,
    })}`);
  }

  const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
  const bobPopup = await openBrowserTarget(popupUrl);
  await bobPopup.send('Runtime.enable');
  await waitFor(bobPopup, `() => window.__currentPage === 'home'`, 'Bob account home before restart');
  const identityAfterPopup = await readStorageIdentityDiagnostics(workerClient, 'after-bob-popup');
  await evaluatePage(bobPopup, `(() => {
    if (globalThis.__panguCrossOrgDiagnosticInstalled) return true;
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.__panguCrossOrgDiagnosticInstalled = true;
    globalThis.__panguCrossOrgDiagnosticRequests = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input?.url || String(input);
      const startedAt = Date.now();
      try {
        const response = await originalFetch(input, init);
        const clone = response.clone();
        let body = '';
        try { body = await clone.text(); } catch { /* diagnostic only */ }
        globalThis.__panguCrossOrgDiagnosticRequests.push({
          url,
          status: response.status,
          body: body.slice(0, 4000),
          elapsedMs: Date.now() - startedAt,
        });
        return response;
      } catch (error) {
        globalThis.__panguCrossOrgDiagnosticRequests.push({
          url,
          error: String(error?.stack || error),
          elapsedMs: Date.now() - startedAt,
        });
        throw error;
      }
    };
    return true;
  })()`);
  let beforeRestart;
  try {
    beforeRestart = await waitForEvidenceState(
      workerClient,
      bobAccountId,
      'Verified',
      'Bob verified FastEvidence before restart',
    );
  } catch (error) {
    const popupRequests = await evaluatePage(
      bobPopup,
      `(() => globalThis.__panguCrossOrgDiagnosticRequests || [])()`,
    );
    const relevantRequests = popupRequests
      .filter((request) => /txcer-issuance|certifiers|\/groups\/|poll-cross-org-txcers/.test(request.url))
      .slice(-20)
      .map((request) => ({
        url: request.url,
        status: request.status,
        error: request.error,
        body: request.body?.slice(0, 600),
        elapsedMs: request.elapsedMs,
      }));
    const currentEvidence = await readAccountEvidence(workerClient, bobAccountId);
    const bobStorage = await evaluatePage(workerClient, `(async () => new Promise((resolve) => chrome.storage.local.get(null, (storage) => {
      const account = storage.pangu_accounts?.[${JSON.stringify(bobAccountId)}] || {};
      resolve({
        activeAccount: storage.pangu_active_account || '',
        sessionAccount: storage.pangu_session?.accountId || '',
        organization: storage.pangu_organization?.[${JSON.stringify(bobAccountId)}] || null,
        addressKeys: Object.keys(account.addresses || {}),
        txCerIDs: Object.keys(account.txCerStore || {}),
        issuanceRecordIDs: Object.keys(account.txCerIssuanceRecords || {}),
      });
    })))()`);
    throw new Error(`${error.message}; diagnostics=${JSON.stringify({
      backendQueueBeforeBob,
      identityBeforeSwitch,
      identityAfterSwitch,
      identityAfterPopup,
      relevantRequests,
      currentEvidence,
      bobStorage,
    })}`);
  }
  const sourceRecord = beforeRestart.record;
  const fastEvidenceMilestone = {
    txCerID: sourceRecord.txCerID,
    verifiedAt: Date.now(),
    elapsedFromAssignMs: initialTransaction?.assignAcceptedAt
      ? Date.now() - initialTransaction.assignAcceptedAt
      : null,
  };
  if (
    sourceRecord.lifecycleStatus !== 'Active'
    || !sourceRecord.issuanceRecordID
    || !sourceRecord.hasAuthoritySnapshot
    || !sourceRecord.hasFastEvidence
    || !sourceRecord.hasAck
    || !sourceRecord.hasReceipt
    || !sourceRecord.txCer
  ) {
    throw new Error(`Bob TXCer evidence is incomplete before restart: ${JSON.stringify(sourceRecord)}`);
  }
  try { await bobPopup.send('Page.close'); } catch { /* best effort */ }
  bobPopup.close();
  workerClient.close();
  stopEdgeProcess(edgeProcess);
  await sleep(1500);

  let restartedProcess;
  let restartedWorker;
  let restartPopup;
  try {
    restartedProcess = spawnEdgeProcess(edgePath);
    const runtime = await findPanguExtensionRuntime();
    if (runtime.info.id !== extensionId) {
      throw new Error(`extension identity changed across same-profile restart: ${extensionId} -> ${runtime.info.id}`);
    }
    restartedWorker = await connect(runtime.target.webSocketDebuggerUrl);
    await restartedWorker.send('Runtime.enable');
    await evaluatePage(restartedWorker, installIssuanceBlockExpression());

    restartPopup = await openBrowserTarget(popupUrl, { blockAuthority: true });
    await waitFor(restartPopup, `() => window.__currentPage === 'home'`, 'Bob home with issuance blocked');
    const blocked = await waitForEvidenceState(
      restartedWorker,
      bobAccountId,
      'Pending',
      'Bob cached evidence Pending while authority is blocked',
    );

    await restartPopup.send('Fetch.disable');
    await evaluatePage(restartedWorker, restoreAuthorityFetchAndCaptureExpression());
    await restartPopup.send('Page.reload', { ignoreCache: true });
    await waitFor(restartPopup, `() => window.__currentPage === 'home'`, 'Bob home after authority restore');
    const replayed = await waitForEvidenceState(
      restartedWorker,
      bobAccountId,
      'Verified',
      'Bob FastEvidence reverified from authority',
    );
    if (replayed.record.txCerID !== sourceRecord.txCerID) {
      throw new Error(`reverified TXCer identity changed: ${sourceRecord.txCerID} -> ${replayed.record.txCerID}`);
    }
    assertEvidenceReplay([
      sourceRecord.security,
      blocked.record.security,
      replayed.record.security,
    ]);

    try { await restartPopup.send('Page.close'); } catch { /* best effort */ }
    restartPopup.close();
    restartPopup = null;
    const secondPhase = await approveDappPhase(
      restartedWorker,
      extensionId,
      dappOrigin,
      2,
      walletAddress,
    );
    const submits = secondPhase.requests.filter(
      (request) => request.normalizedPath === `/api/v1/${groupId}/assign/submit-tx`,
    );
    if (submits.length !== 1) {
      throw new Error(`expected one Bob pure-TXCer submit, got ${JSON.stringify(submits)}`);
    }
    const secondSubmitBody = JSON.parse(submits[0].body);
    const secondTX = assertPureTXCerSubmission(secondSubmitBody);
    const consumedTXCerID = String(secondTX.TXInputsCertificate[0].TXCerID || '');
    if (consumedTXCerID !== sourceRecord.txCerID) {
      throw new Error(`Bob spent unexpected TXCer: expected=${sourceRecord.txCerID} actual=${consumedTXCerID}`);
    }
    const afterSpend = await evaluatePage(restartedWorker, `(async () => new Promise((resolve) => chrome.storage.local.get(null, (storage) => {
      const account = storage.pangu_accounts?.[${JSON.stringify(bobAccountId)}] || {};
      resolve({
        status: account.txCerStatuses?.[${JSON.stringify(consumedTXCerID)}]?.status || '',
        txCerID: ${JSON.stringify(consumedTXCerID)},
      });
    })))()`);
    if (!['PendingUse', 'Consumed', 'AwaitingExchange'].includes(afterSpend.status)) {
      throw new Error(`source TXCer did not enter a spent lifecycle state: ${JSON.stringify(afterSpend)}`);
    }
    const certification = await waitForGQNCCertifiedTransactions({
      txIDs: [initialTransaction?.txId, secondTX.TXID],
      baselineHeight: gqncBaseline?.certifiedHeight || 0,
      baselineRejectedActionIDs: gqncBaseline?.rejectedActionIDs || [],
    });

    restartedWorker.close();
    restartedWorker = null;
    return {
      edgeProcess: restartedProcess,
      evidence: {
        beforeRestart: sourceRecord.security,
        blocked: blocked.record.security,
        replayed: replayed.record.security,
        txCerID: sourceRecord.txCerID,
        cfaaAuditStatus: replayed.record.security?.cfaaAuditStatus,
        fastEvidenceMilestone,
      },
      secondPayment: {
        txId: secondTX.TXID,
        txType: secondTX.TXType,
        normalInputCount: secondTX.TXInputsNormal.length,
        txCerInputCount: secondTX.TXInputsCertificate.length,
        sourceStatus: afterSpend.status,
        assignMilestone: secondPhase.milestone,
      },
      certification,
    };
  } catch (error) {
    try { restartPopup?.close(); } catch { /* best effort */ }
    try { restartedWorker?.close(); } catch { /* best effort */ }
    stopEdgeProcess(restartedProcess);
    throw error;
  }
}

function cleanup(edgeProcess, server) {
  try {
    server?.close();
  } catch {
    // ignore server cleanup errors
  }

  stopEdgeProcess(edgeProcess);

  for (let i = 0; i < 20; i += 1) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
      if (!fs.existsSync(profileDir)) return;
    } catch {
      // Edge child processes may release files slightly later.
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }

  if (fs.existsSync(profileDir)) {
    console.warn(`[check:dapp-tx-approve-browser-smoke] cleanup warning: temp profile still exists ${profileDir}`);
  }
}

async function run() {
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
    throw new Error('dist/manifest.json not found. Run npm run build first.');
  }

  const edgePath = findEdgePath();
  if (!edgePath) {
    throw new Error('Microsoft Edge executable not found. Set PANGUPAY_EDGE_PATH to run DApp TX approve browser smoke.');
  }

  let edgeProcess;
  let server;
  let workerClient;
  try {
    server = await createDappServer();
    edgeProcess = spawnEdgeProcess(edgePath);

    await waitForDevTools();
    await sleep(4000);

    const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
    const serviceWorkers = targets.filter(
      (target) => target.type === 'service_worker' && String(target.url || '').startsWith('chrome-extension://')
    );
    const manifests = [];
    for (const worker of serviceWorkers) {
      try {
        const info = await evaluateTarget(
          worker,
          `(() => ({ id: chrome.runtime.id, manifest: chrome.runtime.getManifest() }))()`
        );
        manifests.push({ target: worker, info });
      } catch (error) {
        manifests.push({ target: worker, error: String(error.message || error) });
      }
    }

    const extension = manifests.find((item) => item.info?.manifest?.name === 'PanguPay Wallet');
    if (!extension) {
      throw new Error(
        `PanguPay service worker not found: ${JSON.stringify(
          manifests.map((item) => ({
            url: item.target.url,
            name: item.info?.manifest?.name,
            error: item.error,
          }))
        )}`
      );
    }

    const extensionId = extension.info.id;
    const dappOrigin = `http://127.0.0.1:${dappPort}`;
    workerClient = await connect(extension.target.webSocketDebuggerUrl);
    await workerClient.send('Runtime.enable');
    await evaluatePage(
      workerClient,
      `(async () => new Promise((resolve) => chrome.storage.local.set(${JSON.stringify(smokeStoragePayload(dappOrigin))}, resolve)))()`
    );
    await evaluatePage(workerClient, isRealBackendMode ? installFetchCaptureExpression() : installMockFetchExpression());
    const gqncBaseline = isRealBackendMode ? await readGQNCCheckpoint() : null;
    const initialSubmitStartedAt = Date.now();

    const dappUrl = `${dappOrigin}/`;
    const dappTargetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${dappUrl}`, { method: 'PUT' });
    if (!dappTargetResponse.ok) {
      throw new Error(`Failed to create DApp target: ${dappTargetResponse.status} ${await dappTargetResponse.text()}`);
    }
    const dappTarget = await dappTargetResponse.json();
    const dappClient = await connect(dappTarget.webSocketDebuggerUrl);
    const dappErrors = [];
    await dappClient.send('Runtime.enable');
    await dappClient.send('Page.enable');
    const pushDappEvent = dappClient.events.push.bind(dappClient.events);
    dappClient.events.push = (event) => {
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
        dappErrors.push({
          type: 'console.error',
          args: (event.params.args || []).map((arg) => arg.value || arg.description || arg.type).join(' '),
        });
      }
      if (event.method === 'Runtime.exceptionThrown') {
        dappErrors.push({ type: 'exception', text: event.params.exceptionDetails?.text });
      }
      return pushDappEvent(event);
    };

    await dappClient.send('Page.navigate', { url: dappUrl });
    await waitFor(dappClient, `() => Boolean(window.pangu)`, 'window.pangu injection');
    await evaluatePage(dappClient, `(() => { document.querySelector('#send').click(); return true; })()`);
    await waitFor(
      dappClient,
      `() => (document.querySelector('#status')?.textContent || '').includes('submitting')`,
      'DApp transaction pending request'
    );

    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    const popupTargetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${popupUrl}`, { method: 'PUT' });
    if (!popupTargetResponse.ok) {
      throw new Error(`Failed to create popup target: ${popupTargetResponse.status} ${await popupTargetResponse.text()}`);
    }
    const popupTarget = await popupTargetResponse.json();
    const popupClient = await connect(popupTarget.webSocketDebuggerUrl);
    const popupErrors = [];
    const popupSseRequests = new Map();
    const popupSseDiagnostics = [];
    await popupClient.send('Runtime.enable');
    await popupClient.send('Page.enable');
    await popupClient.send('Network.enable');
    const pushPopupEvent = popupClient.events.push.bind(popupClient.events);
    popupClient.events.push = (event) => {
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
        popupErrors.push({
          type: 'console.error',
          args: (event.params.args || []).map((arg) => arg.value || arg.description || arg.type).join(' '),
        });
      }
      if (event.method === 'Runtime.exceptionThrown') {
        popupErrors.push({ type: 'exception', text: event.params.exceptionDetails?.text });
      }
      if (
        event.method === 'Network.requestWillBeSent' &&
        String(event.params.request?.url || '').includes('/assign/account-update-stream')
      ) {
        popupSseRequests.set(event.params.requestId, event.params.request.url);
        popupSseDiagnostics.push({
          type: 'request',
          url: event.params.request.url,
        });
      }
      if (
        event.method === 'Network.responseReceived' &&
        popupSseRequests.has(event.params.requestId)
      ) {
        popupSseDiagnostics.push({
          type: 'response',
          url: popupSseRequests.get(event.params.requestId),
          status: event.params.response?.status,
          mimeType: event.params.response?.mimeType,
        });
      }
      if (
        event.method === 'Network.loadingFailed' &&
        popupSseRequests.has(event.params.requestId)
      ) {
        popupSseDiagnostics.push({
          type: 'failed',
          url: popupSseRequests.get(event.params.requestId),
          errorText: event.params.errorText,
          blockedReason: event.params.blockedReason,
          canceled: event.params.canceled,
        });
      }
      return pushPopupEvent(event);
    };

    await popupClient.send('Page.navigate', { url: popupUrl });
    await waitFor(
      popupClient,
      `() => window.__currentPage === 'dappTransaction' && document.querySelector('#dappTxApproveBtn') && document.body.innerText.includes('${recipientAddress}')`,
      'DApp transaction confirmation popup'
    );
    const confirmationSnapshot = await evaluatePage(
      popupClient,
      `(() => ({
        title: document.title,
        text: (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 600),
        currentPage: window.__currentPage,
      }))()`
    );

    await evaluatePage(
      popupClient,
      `(() => {
        const approve = document.querySelector('#dappTxApproveBtn');
        if (!approve) throw new Error('DApp tx approve button missing');
        approve.click();
        return true;
      })()`
    );

    await waitFor(
      dappClient,
      `() => Boolean(window.__panguTxResult) || Boolean(window.__panguTxError)`,
      'DApp transaction approve result'
    );
    const earlyDappResult = await evaluatePage(
      dappClient,
      `(() => ({
        result: window.__panguTxResult,
        error: window.__panguTxError,
        status: document.querySelector('#status')?.textContent || '',
        events: window.__panguTxEvents || [],
      }))()`
    );
    if (earlyDappResult.error) {
      const mockRequests = await evaluatePage(
        workerClient,
        `(() => globalThis.__panguApproveSmokeRequests || [])()`
      );
      throw new Error(
        `DApp transaction failed before submitted event: ${JSON.stringify({
          dappResult: earlyDappResult,
          mockRequests,
        })}`
      );
    }
    const observedTxId = earlyDappResult.result?.txId || txId;
    const shouldRunRestartFlow = isRealBackendMode
      && String(process.env.PANGUPAY_REAL_BROWSER_RESTART_FLOW || 'true').toLowerCase() !== 'false';
    const initialCompletionStatus = getInitialBrowserCompletionStatus({
      realBackend: isRealBackendMode,
      restartFlow: shouldRunRestartFlow,
    });
    const initialHistoryStatus = getInitialBrowserHistoryStatus({
      realBackend: isRealBackendMode,
      restartFlow: shouldRunRestartFlow,
    });
    await waitFor(
      dappClient,
      `() => (window.__panguTxEvents || []).some((event) => event && event.txId === '${observedTxId}' && event.status === 'submitted')`,
      'DApp submitted txStatus event'
    );
    const initialAssignMilestone = {
      txId: observedTxId,
      submittedAt: Date.now(),
      assignAcceptMs: Date.now() - initialSubmitStartedAt,
    };
    if (initialCompletionStatus === 'success') {
      await waitFor(
        dappClient,
        `() => (window.__panguTxEvents || []).some((event) => event && event.txId === '${observedTxId}' && event.status === 'success')`,
        'DApp final success txStatus event'
      );
    }

    const dappResult = await evaluatePage(
      dappClient,
      `(() => ({
        result: window.__panguTxResult,
        error: window.__panguTxError,
        status: document.querySelector('#status')?.textContent || '',
        events: window.__panguTxEvents || [],
      }))()`
    );

    if (dappResult.error) {
      throw new Error(`DApp transaction unexpectedly failed: ${JSON.stringify(dappResult)}`);
    }
    if ((!isRealBackendMode && dappResult.result?.txId !== txId) || dappResult.result?.status !== 'submitted') {
      throw new Error(`Unexpected DApp transaction approve result: ${JSON.stringify(dappResult)}`);
    }

    const storage = await evaluatePage(
      workerClient,
      `(async () => new Promise((resolve) => chrome.storage.local.get(null, resolve)))()`
    );
    const pendingTxs = storage.pangu_dapp_tx_pending?.[accountId] || {};
    if (initialCompletionStatus === 'success' && Object.keys(pendingTxs).length !== 0) {
      throw new Error(`DApp pending transaction was not cleared: ${JSON.stringify(pendingTxs)}`);
    }
    const watches = storage.pangu_dapp_tx_watches?.[accountId] || {};
    if (initialCompletionStatus === 'success' && Object.keys(watches).length !== 0) {
      throw new Error(`DApp tx watch should be consumed after success status: ${JSON.stringify(watches)}`);
    }
    const history = storage.pangu_tx_history?.[accountId] || [];
    const historyRecord = history.find((item) => item.txHash === observedTxId);
    if (!historyRecord || historyRecord.status !== initialHistoryStatus) {
      throw new Error(`Submitted transaction history did not reach ${initialHistoryStatus}: ${JSON.stringify(history)}`);
    }

    const mockRequests = await evaluatePage(
      workerClient,
      `(() => globalThis.__panguApproveSmokeRequests || [])()`
    );
    if (expectedApiHost) {
      const mismatchedHosts = mockRequests
        .map((item) => {
          try {
            const parsed = new URL(item.url);
            return { url: item.url, hostname: parsed.hostname.toLowerCase() };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .filter((item) => item.hostname !== expectedApiHost);
      if (mismatchedHosts.length > 0) {
        throw new Error(
          `Backend request host mismatch. expected=${expectedApiHost} mismatches=${JSON.stringify(mismatchedHosts)}`
        );
      }
    }
    const submitRequest = mockRequests.find((item) => item.normalizedPath === `/api/v1/${groupId}/assign/submit-tx`);
    if (!submitRequest) {
      throw new Error(`Assign submit request was not captured: ${JSON.stringify(mockRequests)}`);
    }
    const submitBody = JSON.parse(submitRequest.body);
    if (submitBody?.TX?.TXType !== 0) {
      throw new Error(`Expected TXType=0 submit body, got: ${JSON.stringify(submitBody?.TX)}`);
    }
    if (!submitBody?.TX?.UserSignatureV2?.Signature) {
      throw new Error(`Submitted transaction is missing UserSignatureV2: ${submitRequest.body}`);
    }
    if (!submitBody?.TX?.TXInputsNormal?.[0]?.SeedReveal) {
      throw new Error(`Submitted transaction is missing SeedReveal: ${submitRequest.body}`);
    }

    if (dappErrors.length || popupErrors.length) {
      throw new Error(
        `Browser runtime errors: ${JSON.stringify({ dappErrors, popupErrors, popupSseDiagnostics })}`
      );
    }
    let restartSummary = null;
    if (shouldRunRestartFlow) {
      try { await dappClient.send('Page.close'); } catch { /* best effort */ }
      try { await popupClient.send('Page.close'); } catch { /* best effort */ }
      dappClient.close();
      popupClient.close();
      const restarted = await runRealBackendRestartPhase({
        edgePath,
        edgeProcess,
        workerClient,
        extensionId,
        dappOrigin,
        initialTransaction: {
          txId: observedTxId,
          assignAcceptedAt: initialAssignMilestone.submittedAt,
        },
        gqncBaseline,
      });
      edgeProcess = restarted.edgeProcess;
      workerClient = null;
      restartSummary = {
        evidence: restarted.evidence,
        secondPayment: restarted.secondPayment,
        certification: restarted.certification,
      };
    } else {
      dappClient.close();
      popupClient.close();
      workerClient.close();
      workerClient = null;
    }

    console.log(JSON.stringify({
      ok: true,
      mode: isRealBackendMode ? 'real-backend' : 'mock-backend',
      extensionId,
      dappOrigin,
      confirmationPage: confirmationSnapshot,
      dappResult,
      submitSummary: {
        txId: submitBody.TX.TXID,
        txType: submitBody.TX.TXType,
        inputCount: submitBody.TX.TXInputsNormal.length,
        outputCount: submitBody.TX.TXOutputs.length,
      },
      initialAssignMilestone,
      restartSummary,
      mockRequestCount: mockRequests.length,
    }, null, 2));
  } finally {
    if (workerClient) {
      workerClient.close();
    }
    cleanup(edgeProcess, server);
  }
}

run().catch((error) => {
  console.error(`[check:dapp-tx-approve-browser-smoke] ${error.stack || error}`);
  process.exit(1);
});
