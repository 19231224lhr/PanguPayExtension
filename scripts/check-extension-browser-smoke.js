import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';

const root = process.cwd();
const extensionDir = path.join(root, 'dist');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pangupay-edge-flow-'));
const port = Number(process.env.PANGUPAY_EDGE_DEBUG_PORT || (9300 + Math.floor(Math.random() * 500)));
const smokePassword = 'PanguTest123!';

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
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function waitForDevTools() {
  for (let i = 0; i < 100; i += 1) {
    try {
      return await getJson(`http://127.0.0.1:${port}/json/list`);
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
            // ignore close errors during cleanup
          }
        },
      });
    });

    ws.addEventListener('message', (message) => {
      const data = JSON.parse(message.data);
      if (data.id && pending.has(data.id)) {
        const entry = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) {
          entry.rej(new Error(`${entry.method}: ${data.error.message}`));
        } else {
          entry.res(data.result);
        }
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

async function snapshot(client) {
  return evaluatePage(
    client,
    `(() => ({
      href: location.href,
      title: document.title,
      text: (document.body?.innerText || '').replace(/\\s+/g, ' ').trim(),
      currentPage: window.__currentPage || null,
      inputs: [...document.querySelectorAll('input')].map((input) => ({
        id: input.id,
        type: input.type,
        placeholder: input.placeholder,
        valueLength: input.value.length,
      })),
      buttons: [...document.querySelectorAll('button,a')]
        .map((element) => (element.textContent || element.getAttribute('aria-label') || '').trim())
        .filter(Boolean)
        .slice(0, 20),
    }))()`
  );
}

async function waitFor(client, predicateSource, label) {
  for (let i = 0; i < 80; i += 1) {
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
  throw new Error(`Timeout waiting for ${label}. Snapshot=${JSON.stringify(await snapshot(client))}`);
}

function cleanup(edgeProcess) {
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
    // Best-effort cleanup. Directory removal below will expose any leftover lock.
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
    console.warn(`[check:browser-smoke] cleanup warning: temp profile still exists ${profileDir}`);
  }
}

async function run() {
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
    throw new Error('dist/manifest.json not found. Run npm run build first.');
  }

  const edgePath = findEdgePath();
  if (!edgePath) {
    throw new Error('Microsoft Edge executable not found. Set PANGUPAY_EDGE_PATH to run browser smoke.');
  }

  let edgeProcess;
  try {
    edgeProcess = spawn(edgePath, [
      `--user-data-dir=${profileDir}`,
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      '--window-position=-32000,-32000',
      '--window-size=800,600',
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    await waitForDevTools();
    await sleep(4000);

    const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
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
    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${popupUrl}`, { method: 'PUT' });
    if (!targetResponse.ok) {
      throw new Error(`Failed to create popup target: ${targetResponse.status} ${await targetResponse.text()}`);
    }

    const popupTarget = await targetResponse.json();
    const client = await connect(popupTarget.webSocketDebuggerUrl);
    const errors = [];

    try {
      await client.send('Runtime.enable');
      await client.send('Page.enable');
      const pushEvent = client.events.push.bind(client.events);
      client.events.push = (event) => {
        if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
          errors.push({
            type: 'console.error',
            args: (event.params.args || []).map((arg) => arg.value || arg.description || arg.type).join(' '),
          });
        }
        if (event.method === 'Runtime.exceptionThrown') {
          errors.push({
            type: 'exception',
            text: event.params.exceptionDetails?.text,
          });
        }
        return pushEvent(event);
      };

      await client.send('Page.navigate', { url: popupUrl });
      await waitFor(client, `() => document.body && document.body.innerText.includes('创建新账户')`, 'welcome page');
      const welcome = await snapshot(client);

      await evaluatePage(
        client,
        `(() => {
          const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('创建新账户'));
          if (!button) throw new Error('create button missing');
          button.click();
          return true;
        })()`
      );
      await waitFor(
        client,
        `() => window.__currentPage === 'create' && document.body.innerText.includes('继续设置密码')`,
        'create page'
      );
      const create = await snapshot(client);

      await evaluatePage(
        client,
        `(() => {
          const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('继续设置密码'));
          if (!button) throw new Error('continue button missing');
          button.click();
          return true;
        })()`
      );
      await waitFor(
        client,
        `() => window.__currentPage === 'setPassword' && !!document.querySelector('#setPasswordForm')`,
        'set password page'
      );
      const setPassword = await snapshot(client);

      await evaluatePage(
        client,
        `(() => {
          const password = document.querySelector('#password');
          const confirmPassword = document.querySelector('#confirmPassword');
          const form = document.querySelector('#setPasswordForm');
          if (!password || !confirmPassword || !form) throw new Error('password form missing');
          password.value = ${JSON.stringify(smokePassword)};
          confirmPassword.value = ${JSON.stringify(smokePassword)};
          password.dispatchEvent(new Event('input', { bubbles: true }));
          confirmPassword.dispatchEvent(new Event('input', { bubbles: true }));
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          return true;
        })()`
      );
      await waitFor(
        client,
        `() => window.__currentPage === 'walletManager' && (
          document.body.innerText.includes('新建钱包') || document.body.innerText.includes('Create Wallet')
        )`,
        'wallet manager page'
      );
      const walletManager = await snapshot(client);

      const storage = await evaluatePage(
        client,
        `(async () => new Promise((resolve) => chrome.storage.local.get(null, resolve)))()`
      );

      if (!storage.pangu_active_account || !storage.pangu_accounts || !storage.pangu_encrypted_keys) {
        throw new Error(`Account storage missing after create flow: ${JSON.stringify(Object.keys(storage))}`);
      }

      if (errors.length) {
        throw new Error(`Popup runtime errors: ${JSON.stringify(errors)}`);
      }

      console.log(JSON.stringify({
        ok: true,
        extensionId,
        activeAccount: storage.pangu_active_account,
        storageKeys: Object.keys(storage).sort(),
        steps: {
          welcome: welcome.text.slice(0, 120),
          create: create.text.slice(0, 120),
          setPassword: setPassword.text.slice(0, 120),
          walletManager: walletManager.text.slice(0, 200),
        },
      }, null, 2));
    } finally {
      client.close();
    }
  } finally {
    cleanup(edgeProcess);
  }
}

run().catch((error) => {
  console.error(`[check:browser-smoke] ${error.stack || error}`);
  process.exit(1);
});
