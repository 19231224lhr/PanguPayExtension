import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';

const root = process.cwd();
const extensionDir = path.join(root, 'dist');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pangupay-dapp-tx-flow-'));
const debugPort = Number(process.env.PANGUPAY_EDGE_DEBUG_PORT || (10300 + Math.floor(Math.random() * 500)));
const dappPort = Number(process.env.PANGUPAY_DAPP_TX_SMOKE_PORT || (19000 + Math.floor(Math.random() * 1000)));
const accountId = '90000002';
const mainAddress = 'cccccccccccccccccccccccccccccccccccccccc';
const walletAddress = 'dddddddddddddddddddddddddddddddddddddddd';
const recipientAddress = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const now = Date.now();

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

async function waitFor(client, predicateSource, label) {
  for (let i = 0; i < 100; i += 1) {
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
      text: (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 500),
      currentPage: window.__currentPage || null,
    }))()`
  );
  throw new Error(`Timeout waiting for ${label}. Snapshot=${JSON.stringify(snapshot)}`);
}

function createDappServer() {
  const html = `<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <title>PanguPay DApp TX Browser Smoke</title>
      </head>
      <body>
        <h1>PanguPay DApp TX Browser Smoke</h1>
        <button id="send">Send Transaction</button>
        <pre id="status">idle</pre>
        <script>
          window.__panguTxResult = null;
          window.__panguTxError = null;
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
              setStatus('submitting');
              const result = await window.pangu.sendTransaction({
                mode: 'normal',
                coinType: 0,
                gas: 0,
                recipients: [{
                  to: '${recipientAddress}',
                  amount: 12,
                  coinType: 0
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

  const server = http.createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(dappPort, '127.0.0.1', () => resolve(server));
  });
}

function smokeStoragePayload(origin) {
  const account = {
    accountId,
    mainAddress,
    defaultAddress: walletAddress,
    onboardingComplete: true,
    onboardingStep: 'complete',
    organizationId: '10000000',
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
        utxoCount: 0,
        txCerCount: 0,
        source: 'created',
        registrationState: 'registered',
        value: { totalValue: 100, utxoValue: 100, txCerValue: 0 },
      },
    },
  };

  return {
    pangu_accounts: { [accountId]: account },
    pangu_active_account: accountId,
    pangu_session: {
      accountId,
      privKey: '3'.repeat(64),
      expiresAt: Date.now() + 60 * 60 * 1000,
      addressKeys: { [walletAddress]: '4'.repeat(64) },
    },
    pangu_organization: {
      [accountId]: { groupId: '10000000', name: 'Smoke Organization', joinedAt: now },
    },
    pangu_dapp_connections: {
      [accountId]: {
        [origin]: {
          accountId,
          origin,
          address: walletAddress,
          connectedAt: now,
          title: 'PanguPay DApp TX Browser Smoke',
          icon: '',
        },
      },
    },
  };
}

function cleanup(edgeProcess, server) {
  try {
    server?.close();
  } catch {
    // ignore server cleanup errors
  }

  if (edgeProcess?.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(edgeProcess.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // Process may already be gone.
    }
  }

  try {
    const profileToken = path.basename(profileDir);
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
    console.warn(`[check:dapp-tx-browser-smoke] cleanup warning: temp profile still exists ${profileDir}`);
  }
}

async function run() {
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
    throw new Error('dist/manifest.json not found. Run npm run build first.');
  }

  const edgePath = findEdgePath();
  if (!edgePath) {
    throw new Error('Microsoft Edge executable not found. Set PANGUPAY_EDGE_PATH to run DApp TX browser smoke.');
  }

  let edgeProcess;
  let server;
  try {
    server = await createDappServer();
    edgeProcess = spawn(edgePath, [
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
    await evaluateTarget(
      extension.target,
      `(async () => new Promise((resolve) => chrome.storage.local.set(${JSON.stringify(smokeStoragePayload(dappOrigin))}, resolve)))()`
    );

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
    await popupClient.send('Runtime.enable');
    await popupClient.send('Page.enable');
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
      return pushPopupEvent(event);
    };

    await popupClient.send('Page.navigate', { url: popupUrl });
    await waitFor(
      popupClient,
      `() => window.__currentPage === 'dappTransaction' && document.querySelector('#dappTxRejectBtn') && document.body.innerText.includes('${recipientAddress}')`,
      'DApp transaction confirmation popup'
    );
    const confirmationSnapshot = await evaluatePage(
      popupClient,
      `(() => ({
        title: document.title,
        text: (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 500),
        currentPage: window.__currentPage,
      }))()`
    );

    await evaluatePage(
      popupClient,
      `(() => {
        const reject = document.querySelector('#dappTxRejectBtn');
        if (!reject) throw new Error('DApp tx reject button missing');
        reject.click();
        return true;
      })()`
    );

    await waitFor(
      dappClient,
      `() => Boolean(window.__panguTxResult) || Boolean(window.__panguTxError)`,
      'DApp transaction reject result'
    );
    const dappResult = await evaluatePage(
      dappClient,
      `(() => ({
        result: window.__panguTxResult,
        error: window.__panguTxError,
        status: document.querySelector('#status')?.textContent || '',
      }))()`
    );

    if (dappResult.result) {
      throw new Error(`DApp transaction unexpectedly succeeded: ${JSON.stringify(dappResult)}`);
    }
    if (dappResult.error !== 'User rejected transaction') {
      throw new Error(`Unexpected DApp transaction rejection result: ${JSON.stringify(dappResult)}`);
    }

    const storage = await evaluateTarget(
      extension.target,
      `(async () => new Promise((resolve) => chrome.storage.local.get(null, resolve)))()`
    );
    const pendingTxs = storage.pangu_dapp_tx_pending?.[accountId] || {};
    if (Object.keys(pendingTxs).length !== 0) {
      throw new Error(`DApp pending transaction was not cleared: ${JSON.stringify(pendingTxs)}`);
    }
    if (dappErrors.length || popupErrors.length) {
      throw new Error(`Browser runtime errors: ${JSON.stringify({ dappErrors, popupErrors })}`);
    }

    dappClient.close();
    popupClient.close();

    console.log(JSON.stringify({
      ok: true,
      extensionId,
      dappOrigin,
      confirmationPage: confirmationSnapshot,
      rejection: dappResult,
    }, null, 2));
  } finally {
    cleanup(edgeProcess, server);
  }
}

run().catch((error) => {
  console.error(`[check:dapp-tx-browser-smoke] ${error.stack || error}`);
  process.exit(1);
});
