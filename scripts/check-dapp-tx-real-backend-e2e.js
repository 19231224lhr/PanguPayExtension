import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  buildBackendSmokeArguments,
  getRealBrowserCommitDelaySeconds,
} from './real-browser-flow-helpers.js';

const root = process.cwd();
const backendRoot = path.resolve(process.env.PANGU_UTXO_AREA_ROOT || path.join(root, '..', 'UTXO-Area'));
const webRoot = path.resolve(process.env.PANGU_WEB_ROOT || path.join(root, '..', 'TransferAreaInterface'));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pangupay-real-backend-e2e-'));
const readyFile = path.join(tempDir, 'backend-ready.json');
const stopFile = path.join(tempDir, 'backend-stop');
const fixtureFile = path.join(tempDir, 'fixture.json');
const holdSeconds = Number(process.env.PANGUPAY_REAL_BACKEND_HOLD_SECONDS || 420);

function log(message) {
  console.log(`[check:dapp-tx-real-backend-e2e] ${message}`);
}

function run(command, args, options = {}) {
  let executable = command;
  let finalArgs = args;
  if (command === 'npm') {
    const npmCli = process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)
      ? process.env.npm_execpath
      : path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!fs.existsSync(npmCli)) {
      throw new Error(`npm CLI not found: ${npmCli}`);
    }
    executable = process.execPath;
    finalArgs = [npmCli, ...args];
  }
  const result = spawnSync(executable, finalArgs, {
    stdio: 'inherit',
    ...options,
  });
  if (result.error) {
    throw new Error(`failed to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}: ${file}`);
}

async function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    (async () => {
      await sleep(timeoutMs);
      throw new Error('backend smoke process did not exit after stop file');
    })(),
  ]);
}

function startBackend() {
  const smokeScript = path.join(backendRoot, 'scripts', 'dev-backend-smoke.ps1');
  if (!fs.existsSync(smokeScript)) {
    throw new Error(`Backend smoke script not found: ${smokeScript}`);
  }

  log(`starting backend smoke nodes from ${backendRoot}`);
  const child = spawn(
    'powershell.exe',
    buildBackendSmokeArguments({
      smokeScript,
      commitDelaySec: getRealBrowserCommitDelaySeconds(process.env.PANGUPAY_GUAR_BLOCK_COMMIT_DELAY_SEC),
      holdSeconds,
      readyFile,
      stopFile,
    }),
    {
      cwd: backendRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.on('exit', (code) => {
    if (code !== 0 && !fs.existsSync(stopFile)) {
      console.error(`[check:dapp-tx-real-backend-e2e] backend smoke exited early with code ${code}`);
    }
  });
  return child;
}

async function runRealBackendE2E() {
  if (!fs.existsSync(backendRoot)) {
    throw new Error(`UTXO-Area root not found: ${backendRoot}`);
  }

  const backend = startBackend();
  let ready;
  try {
    await waitForFile(readyFile, 'backend ready file', Number(process.env.PANGUPAY_REAL_BACKEND_READY_TIMEOUT_MS || 480000));
    ready = JSON.parse(fs.readFileSync(readyFile, 'utf8').replace(/^\uFEFF/, ''));
    if (!ready?.ready || !ready?.configPath || !ready?.gatewayBase || !ready?.groupID) {
      throw new Error(`Invalid backend ready payload: ${JSON.stringify(ready)}`);
    }

    log(`preparing users through real Gateway ${ready.gatewayBase}`);
    run('go', [
      'run',
      './tools/dev-http-e2e',
      '-config',
      ready.configPath,
      '-gateway',
      ready.gatewayBase,
      '-group',
      ready.groupID,
      '-prepare-only',
      '-fixture-json',
      fixtureFile,
    ], { cwd: backendRoot });

    log('building extension with local Gateway API base');
    run('npm', ['run', 'build'], {
      env: {
        ...process.env,
        VITE_PANGU_API_BASE_URL: ready.gatewayBase,
      },
    });

    log('running browser DApp approve flow against the real backend');
    run('node', ['scripts/check-dapp-tx-approve-browser-smoke.js'], {
      env: {
        ...process.env,
        PANGUPAY_REAL_BACKEND_FIXTURE: fixtureFile,
        PANGUPAY_EXPECT_API_HOST: '127.0.0.1',
        PANGUPAY_DAPP_APPROVE_AMOUNT: process.env.PANGUPAY_DAPP_APPROVE_AMOUNT || '12',
      },
    });

    const protocolEnv = {
      ...process.env,
      PANGU_GATEWAY_BASE: ready.gatewayBase,
      PANGU_GROUP_ID: ready.groupID,
      PANGU_REQUIRE_REAL_FLOW: 'true',
    };
    log('checking the extension protocol client against the resulting real issuance record');
    run('npm', ['run', 'check:real-backend-protocol'], { env: protocolEnv });
    if (!fs.existsSync(webRoot)) {
      throw new Error(`TransferAreaInterface root not found: ${webRoot}`);
    }
    log('checking the Web protocol client against the same real issuance record');
    run('npm', ['run', 'test:real-backend'], { cwd: webRoot, env: protocolEnv });

    log('real backend DApp approve E2E passed');
  } finally {
    try {
      fs.writeFileSync(stopFile, 'stop\n');
    } catch {
      // best-effort stop signal
    }
    try {
      await waitForExit(backend, 60000);
    } catch (error) {
      console.error(`[check:dapp-tx-real-backend-e2e] ${error.message}`);
      try {
        backend.kill('SIGKILL');
      } catch {
        // ignore cleanup errors
      }
    }

    log('rebuilding extension with default API base');
    try {
      run('npm', ['run', 'build'], {
        env: {
          ...process.env,
          VITE_PANGU_API_BASE_URL: '',
        },
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

runRealBackendE2E().catch((error) => {
  console.error(`[check:dapp-tx-real-backend-e2e] ${error.stack || error}`);
  process.exit(1);
});
