import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawn, spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { ec: EC } = require('elliptic');
const { sha256 } = require('js-sha256');
const ec = new EC('p256');

const root = process.cwd();
const extensionDir = path.join(root, 'dist');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pangupay-minimal-e2e-'));
const visible = process.argv.includes('--visible');
const keepOpen = process.argv.includes('--keep-open');
const debugPort = Number(process.env.PANGUPAY_EDGE_DEBUG_PORT || (12200 + Math.floor(Math.random() * 500)));
const password = 'PanguTest123!';
const accountId = '90000003';
const groupId = '10000000';
const mainAddress = 'a'.repeat(40);
const walletAddress = 'b'.repeat(40);
const recipientAddress = 'c'.repeat(40);
const accountPrivateKey = '3'.repeat(64);
const addressPrivateKey = '4'.repeat(64);
const recipientPrivateKey = '5'.repeat(64);
const sourceTxId = 'minimal-e2e-source-utxo-0001';
const submittedTxId = 'minimal-e2e-quick-tx-0001';
const now = Date.now();
const textEncoder = new TextEncoder();

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

function hexToBytes(hex) {
    const normalized = String(hex || '').replace(/^0x/i, '').toLowerCase();
    const bytes = [];
    for (let index = 0; index < normalized.length; index += 2) {
        bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
    }
    return bytes;
}

function pad32(bytes) {
    return bytes.length >= 32 ? bytes.slice(-32) : [...new Array(32 - bytes.length).fill(0), ...bytes];
}

function hashBytes(bytes) {
    return Array.from(sha256.array(Array.from(bytes)));
}

function publicKeyFromPrivate(privateKey) {
    const key = ec.keyFromPrivate(privateKey.padStart(64, '0'), 'hex');
    return {
        xHex: key.getPublic().getX().toString(16).padStart(64, '0'),
        yHex: key.getPublic().getY().toString(16).padStart(64, '0'),
    };
}

function publicKeyNew(publicKey) {
    return {
        CurveName: 'P256',
        X: BigInt(`0x${publicKey.xHex}`).toString(10),
        Y: BigInt(`0x${publicKey.yHex}`).toString(10),
    };
}

function publicKeyEnvelope(publicKey) {
    return {
        Algorithm: 'ecdsa_p256',
        PublicKey: hexToBytes(`04${publicKey.xHex}${publicKey.yHex}`),
    };
}

function buildSeedMeta(privateKey) {
    const scalar = pad32(hexToBytes(privateKey));
    const master = hashBytes([
        ...textEncoder.encode('pangu-seedchain-v2:0:'),
        ...scalar,
    ]);
    const chain = new Array(1001);
    chain[0] = hashBytes(master);
    for (let index = 1; index <= 1000; index += 1) chain[index] = hashBytes(chain[index - 1]);
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

const accountPublicKey = publicKeyFromPrivate(accountPrivateKey);
const addressPublicKey = publicKeyFromPrivate(addressPrivateKey);
const recipientPublicKey = publicKeyFromPrivate(recipientPrivateKey);
const accountSignPublicKeyV2 = publicKeyEnvelope(accountPublicKey);
const addressSeed = buildSeedMeta(addressPrivateKey);
const recipientSeed = buildSeedMeta(recipientPrivateKey);

function sourceOutput() {
    return {
        ToAddress: walletAddress,
        ToValue: 100,
        ToGuarGroupID: groupId,
        ToPublicKey: publicKeyNew(addressPublicKey),
        ToInterest: 0,
        Type: 0,
        ToCoinType: 0,
        ToPeerID: '',
        IsPayForGas: false,
        IsCrossChain: false,
        IsGuarMake: false,
        SeedAnchor: addressSeed.seedAnchor,
        SeedChainStep: addressSeed.seedChainStep,
        DefaultSpendAlgorithm: addressSeed.defaultSpendAlgorithm,
    };
}

function queryAddressResponse() {
    return {
        FromGroupID: groupId,
        AddressData: {
            [walletAddress]: {
                Value: 100,
                Type: 0,
                Interest: 0,
                GroupID: groupId,
                PublicKeyNew: publicKeyNew(addressPublicKey),
                SignPublicKeyV2: accountSignPublicKeyV2,
                SeedAnchor: addressSeed.seedAnchor,
                SeedChainStep: addressSeed.seedChainStep,
                DefaultSpendAlgorithm: addressSeed.defaultSpendAlgorithm,
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
                            TXOutputs: [sourceOutput()],
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

function queryAddressGroupResponse() {
    return {
        UserID: accountId,
        Addresstogroup: {
            [recipientAddress]: {
                GroupID: groupId,
                Type: 0,
                PublicKey: publicKeyNew(recipientPublicKey),
                SignPublicKeyV2: accountSignPublicKeyV2,
                SeedAnchor: recipientSeed.seedAnchor,
                SeedChainStep: recipientSeed.seedChainStep,
                DefaultSpendAlgorithm: recipientSeed.defaultSpendAlgorithm,
            },
            [walletAddress]: {
                GroupID: groupId,
                Type: 0,
                PublicKey: publicKeyNew(addressPublicKey),
                SignPublicKeyV2: accountSignPublicKeyV2,
                SeedAnchor: addressSeed.seedAnchor,
                SeedChainStep: addressSeed.seedChainStep,
                DefaultSpendAlgorithm: addressSeed.defaultSpendAlgorithm,
            },
        },
    };
}

function walletBundle(baseUrl) {
    return {
        version: 1,
        account: {
            accountId,
            mainAddress,
            defaultAddress: walletAddress,
            onboardingComplete: true,
            onboardingStep: 'complete',
            organizationId: groupId,
            organizationName: 'Minimal E2E Organization',
            totalBalance: { 0: '100', 1: '0', 2: '0' },
            createdAt: now,
            lastLogin: now,
            addresses: {
                [mainAddress]: {
                    address: mainAddress,
                    type: 0,
                    balance: '0',
                    utxos: {},
                    txCers: {},
                    value: { totalValue: '0', utxoValue: '0', txCerValue: '0' },
                },
                [walletAddress]: {
                    address: walletAddress,
                    type: 0,
                    balance: '100',
                    utxos: {},
                    txCers: {},
                    pubXHex: addressPublicKey.xHex,
                    pubYHex: addressPublicKey.yHex,
                    publicKeyNew: publicKeyNew(addressPublicKey),
                    signPublicKeyV2: accountSignPublicKeyV2,
                    seedAnchor: addressSeed.seedAnchor,
                    seedChainStep: addressSeed.seedChainStep,
                    defaultSpendAlgorithm: addressSeed.defaultSpendAlgorithm,
                    seedLocalState: addressSeed.seedLocalState,
                    value: { totalValue: '100', utxoValue: '100', txCerValue: '0' },
                },
            },
        },
        organization: {
            groupId,
            groupName: 'Minimal E2E Organization',
            assignAPIEndpoint: baseUrl,
            assignNodeUrl: baseUrl,
            aggrAPIEndpoint: baseUrl,
            aggrNodeUrl: baseUrl,
            pledgeAddress: walletAddress,
        },
        secrets: {
            accountPrivateKey,
            addressPrivateKeys: {
                [mainAddress]: accountPrivateKey,
                [walletAddress]: addressPrivateKey,
            },
        },
    };
}

function dappHtml() {
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>PanguPay minimal fixture DApp</title></head>
<body>
    <button id="connect">Connect</button>
    <button id="send">Send quick transfer</button>
    <pre id="status">booting</pre>
    <script>
        window.__panguReady = false;
        window.__panguConnection = null;
        window.__panguAccount = null;
        window.__panguTxResult = null;
        window.__panguError = null;
        window.__panguEvents = [];
        const status = (value) => { document.querySelector('#status').textContent = value; };
        async function provider() {
            if (window.pangu) return window.pangu;
            await new Promise((resolve) => window.addEventListener('panguReady', resolve, { once: true }));
            return window.pangu;
        }
        void provider().then((pangu) => {
            pangu.on('txStatus', (event) => window.__panguEvents.push(event));
            window.__panguReady = true;
            status('ready');
        });
        document.querySelector('#connect').addEventListener('click', async () => {
            try {
                window.__panguError = null;
                window.__panguConnection = null;
                window.__panguAccount = null;
                status('connecting');
                const pangu = await provider();
                window.__panguConnection = await pangu.connect();
                window.__panguAccount = await pangu.getAccount();
                status('connected');
            } catch (error) {
                window.__panguError = error?.message || String(error);
                status('error ' + window.__panguError);
            }
        });
        document.querySelector('#send').addEventListener('click', async () => {
            try {
                window.__panguError = null;
                window.__panguTxResult = null;
                status('submitting');
                const pangu = await provider();
                window.__panguTxResult = await pangu.sendTransaction({
                    toAddress: '${recipientAddress}',
                    amount: '12',
                });
                status('submitted');
            } catch (error) {
                window.__panguError = error?.message || String(error);
                status('error ' + window.__panguError);
            }
        });
    </script>
</body>
</html>`;
}

async function startFixtureServer() {
    const requests = [];
    let statusPolls = 0;
    const server = http.createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString('utf8');
        const url = new URL(request.url || '/', 'http://127.0.0.1');
        const pathname = url.pathname;
        requests.push({ method: request.method, pathname, body });

        const json = (payload, status = 200) => {
            response.writeHead(status, {
                'content-type': 'application/json',
                'access-control-allow-origin': '*',
                'access-control-allow-headers': 'content-type',
            });
            response.end(JSON.stringify(payload));
        };

        if (request.method === 'OPTIONS') return json({});
        if (pathname === '/') {
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            response.end(dappHtml());
            return;
        }
        if (pathname === '/favicon.ico') {
            response.writeHead(204);
            response.end();
            return;
        }

        const address = server.address();
        const baseUrl = `http://127.0.0.1:${address.port}`;
        if (pathname === '/api/v1/committee/endpoint') return json({ endpoint: baseUrl });
        if (pathname === '/api/v1/com/query-address') return json(queryAddressResponse());
        if (pathname === '/api/v1/com/query-address-group') return json(queryAddressGroupResponse());
        if (pathname === `/api/v1/groups/${groupId}`) {
            return json({
                group_id: groupId,
                group_name: 'Minimal E2E Organization',
                assign_api_endpoint: baseUrl,
                aggr_api_endpoint: baseUrl,
                pledge_address: walletAddress,
            });
        }
        if (pathname === `/api/v1/${groupId}/assign/submit-tx`) {
            return json({ success: true, tx_id: submittedTxId, status: 'submitted' });
        }
        if (pathname === `/api/v1/${groupId}/assign/tx-status/${submittedTxId}`) {
            statusPolls += 1;
            return json({
                tx_id: submittedTxId,
                status: statusPolls >= 2 ? 'success' : 'pending',
                receive_result: statusPolls >= 2,
                result: statusPolls >= 2,
                error_reason: '',
                guar_id: 'minimal-e2e-guar',
                user_id: accountId,
                block_height: statusPolls >= 2 ? 9 : 0,
            });
        }
        return json({ success: false, error: `Unhandled fixture endpoint: ${request.method} ${pathname}` }, 500);
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    return {
        server,
        requests,
        baseUrl: `http://127.0.0.1:${address.port}`,
        get statusPolls() { return statusPolls; },
    };
}

function runBuild(apiBaseUrl) {
    const npmCli = process.env.npm_execpath;
    const command = npmCli ? process.execPath : 'npm.cmd';
    const args = npmCli ? [npmCli, 'run', 'build'] : ['run', 'build'];
    const result = spawnSync(command, args, {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, VITE_PANGU_API_BASE_URL: apiBaseUrl },
    });
    if (result.error || result.status !== 0) {
        throw result.error || new Error(`Extension build failed with exit code ${result.status}`);
    }
}

async function getJson(url, init) {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return response.json();
}

function connect(webSocketDebuggerUrl) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(webSocketDebuggerUrl);
        let nextId = 1;
        const pending = new Map();
        const listeners = new Map();
        socket.addEventListener('open', () => resolve({
            send(method, params = {}) {
                const id = nextId++;
                socket.send(JSON.stringify({ id, method, params }));
                return new Promise((res, rej) => pending.set(id, { res, rej, method }));
            },
            on(method, listener) {
                const entries = listeners.get(method) || [];
                entries.push(listener);
                listeners.set(method, entries);
            },
            close() {
                try { socket.close(); } catch { /* already closed */ }
            },
        }));
        socket.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.id && pending.has(message.id)) {
                const entry = pending.get(message.id);
                pending.delete(message.id);
                if (message.error) entry.rej(new Error(`${entry.method}: ${message.error.message}`));
                else entry.res(message.result);
                return;
            }
            for (const listener of listeners.get(message.method) || []) listener(message.params || {});
        });
        socket.addEventListener('error', reject);
    });
}

async function evaluate(client, expression) {
    const reply = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    });
    if (reply.exceptionDetails) {
        throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text || 'Evaluation failed');
    }
    return reply.result.value;
}

async function waitFor(client, predicate, label, attempts = 240) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const matched = await evaluate(client, `(() => { try { return Boolean((${predicate})()); } catch { return false; } })()`);
        if (matched) return;
        await sleep(250);
    }
    const snapshot = await evaluate(client, `(() => ({
        href: location.href,
        text: (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 800),
        error: window.__panguError || null,
        result: window.__panguTxResult || null,
        events: window.__panguEvents || [],
    }))()`);
    throw new Error(`Timeout waiting for ${label}: ${JSON.stringify(snapshot)}`);
}

async function waitForDevTools() {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        try {
            return await getJson(`http://127.0.0.1:${debugPort}/json/list`);
        } catch {
            await sleep(250);
        }
    }
    throw new Error('Edge DevTools endpoint did not become ready');
}

async function openTarget(url) {
    return getJson(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
}

async function findExtensionRuntime() {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
        for (const target of targets.filter((entry) => entry.type === 'service_worker' && entry.url.startsWith('chrome-extension://'))) {
            const client = await connect(target.webSocketDebuggerUrl);
            try {
                await client.send('Runtime.enable');
                const info = await evaluate(client, `(() => ({ id: chrome.runtime.id, manifest: chrome.runtime.getManifest() }))()`);
                if (info.manifest?.name === 'PanguPay Wallet') return { target, info, client };
            } catch {
                client.close();
            }
        }
        await sleep(250);
    }
    throw new Error('PanguPay extension service worker was not found');
}

async function setInput(client, selector, value) {
    await evaluate(client, `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('Missing input: ' + ${JSON.stringify(selector)});
        element.value = ${JSON.stringify(value)};
        element.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    })()`);
}

async function click(client, selector) {
    await evaluate(client, `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('Missing button: ' + ${JSON.stringify(selector)});
        element.click();
        return true;
    })()`);
}

function stopEdge(edgeProcess) {
    if (!edgeProcess?.pid) return;
    try {
        execFileSync('taskkill', ['/PID', String(edgeProcess.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
        // The process may already have exited.
    }
}

async function closeServer(server) {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
}

async function run() {
    const edgePath = findEdgePath();
    if (!edgePath) throw new Error('Microsoft Edge executable was not found');

    let fixture;
    let edgeProcess;
    const clients = [];
    try {
        fixture = await startFixtureServer();
        runBuild(fixture.baseUrl);
        assert.ok(fs.existsSync(path.join(extensionDir, 'manifest.json')), 'dist/manifest.json must exist');

        const windowArgs = visible
            ? ['--window-position=80,80', '--window-size=1100,780']
            : ['--window-position=-32000,-32000', '--window-size=900,700'];
        edgeProcess = spawn(edgePath, [
            `--user-data-dir=${profileDir}`,
            `--disable-extensions-except=${extensionDir}`,
            `--load-extension=${extensionDir}`,
            `--remote-debugging-port=${debugPort}`,
            '--remote-allow-origins=*',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-popup-blocking',
            ...windowArgs,
            'about:blank',
        ], { stdio: 'ignore' });

        await waitForDevTools();
        const extension = await findExtensionRuntime();
        clients.push(extension.client);
        const extensionId = extension.info.id;
        const workerLogs = [];
        extension.client.on('Runtime.consoleAPICalled', (event) => {
            workerLogs.push((event.args || []).map((arg) => arg.value ?? arg.description ?? arg.type).join(' '));
        });

        const popupTarget = await openTarget(`chrome-extension://${extensionId}/src/popup/index.html`);
        const popup = await connect(popupTarget.webSocketDebuggerUrl);
        clients.push(popup);
        await popup.send('Runtime.enable');
        await popup.send('Page.enable');
        await waitFor(popup, `() => Boolean(document.querySelector('[data-testid="screen-import"]'))`, 'wallet import screen');

        await setInput(popup, '[data-testid="bundle-input"]', JSON.stringify(walletBundle(fixture.baseUrl)));
        await setInput(popup, '[data-testid="import-password"]', password);
        await setInput(popup, '[data-testid="import-confirm"]', password);
        await click(popup, '[data-testid="import-button"]');
        await waitFor(popup, `() => Boolean(document.querySelector('[data-testid="screen-unlock"]'))`, 'wallet unlock screen');

        await setInput(popup, '[data-testid="unlock-password"]', password);
        await click(popup, '[data-testid="unlock-button"]');
        await waitFor(popup, `() => Boolean(document.querySelector('[data-testid="screen-overview"]'))`, 'unlocked wallet overview');

        const stored = await evaluate(extension.client, `(async () => {
            const local = await chrome.storage.local.get(null);
            const session = await chrome.storage.session.get(null);
            return { local, session };
        })()`);
        assert.ok(stored.local.pangu_v2_wallet, 'encrypted wallet record was not persisted');
        assert.ok(stored.session.pangu_v2_session, 'unlocked session was not created');
        assert.ok(!JSON.stringify(stored.local).includes(accountPrivateKey), 'account private key leaked to local storage');
        assert.ok(!JSON.stringify(stored.local).includes(addressPrivateKey), 'address private key leaked to local storage');
        assert.ok(JSON.stringify(stored.session).includes(addressPrivateKey), 'session does not contain decrypted address key');

        const dappTarget = await openTarget(`${fixture.baseUrl}/`);
        const dapp = await connect(dappTarget.webSocketDebuggerUrl);
        clients.push(dapp);
        await dapp.send('Runtime.enable');
        await dapp.send('Page.enable');
        await waitFor(dapp, `() => window.__panguReady === true`, 'window.pangu provider');

        await click(dapp, '#connect');
        await waitFor(popup, `() => document.querySelector('[data-testid="screen-approval"]')?.innerText.includes('允许连接钱包')`, 'connection approval');
        await click(popup, '[data-testid="reject-button"]');
        await waitFor(dapp, `() => String(window.__panguError || '').includes('rejected')`, 'rejected connection result');
        assert.equal(await evaluate(dapp, `(() => window.__panguConnection)()`), null);

        await waitFor(popup, `() => Boolean(document.querySelector('[data-testid="screen-overview"]'))`, 'overview after rejected connection');
        await click(dapp, '#connect');
        await waitFor(popup, `() => document.querySelector('[data-testid="screen-approval"]')?.innerText.includes('允许连接钱包')`, 'second connection approval');
        await click(popup, '[data-testid="approve-button"]');
        await waitFor(dapp, `() => Boolean(window.__panguConnection) && Boolean(window.__panguAccount)`, 'DApp account connection');
        const connected = await evaluate(dapp, `(() => ({ connection: window.__panguConnection, account: window.__panguAccount, error: window.__panguError }))()`);
        assert.equal(connected.error, null);
        assert.deepEqual(connected.account, { accountId, address: walletAddress });
        assert.deepEqual(connected.connection, connected.account);

        await waitFor(
            popup,
            `() => Boolean(document.querySelector('[data-testid="screen-overview"]')) && !document.querySelector('[data-testid="lock-button"]')?.disabled`,
            'interactive overview after connection'
        );
        await click(popup, '[data-testid="lock-button"]');
        await waitFor(
            popup,
            `() => Boolean(document.querySelector('[data-testid="screen-unlock"]')) && !document.querySelector('[data-testid="unlock-button"]')?.disabled`,
            'interactive locked wallet screen'
        );
        await click(dapp, '#send');
        await waitFor(dapp, `() => document.querySelector('#status')?.textContent === 'submitting'`, 'locked transaction request');
        await setInput(popup, '[data-testid="unlock-password"]', password);
        await click(popup, '[data-testid="unlock-button"]');
        await waitFor(popup, `() => document.querySelector('[data-testid="screen-approval"]')?.innerText.includes('批准快速转账')`, 'quick transfer approval');

        await evaluate(dapp, `(() => {
            window.postMessage({ type: 'PANGU_UI_APPROVE', requestId: crypto.randomUUID(), payload: { approved: true } }, location.origin);
            window.postMessage({ type: 'PANGU_UI_REJECT', requestId: crypto.randomUUID(), payload: { approved: false } }, location.origin);
            window.postMessage({ type: 'PANGU_DAPP_TX_APPROVE', requestId: crypto.randomUUID(), payload: { approved: true } }, location.origin);
            return true;
        })()`);
        await sleep(500);
        assert.equal(await evaluate(dapp, `(() => window.__panguTxResult)()`), null, 'forged page approval changed transaction state');
        assert.equal(
            await evaluate(popup, `(() => Boolean(document.querySelector('[data-testid="screen-approval"]')))()`),
            true,
            'forged page approval cleared the pending request'
        );

        await click(popup, '[data-testid="reject-button"]');
        await waitFor(dapp, `() => String(window.__panguError || '').includes('rejected')`, 'rejected transaction result');
        assert.equal(await evaluate(dapp, `(() => window.__panguTxResult)()`), null);

        await waitFor(popup, `() => Boolean(document.querySelector('[data-testid="screen-overview"]'))`, 'overview after rejected transaction');
        await click(dapp, '#send');
        await waitFor(popup, `() => document.querySelector('[data-testid="screen-approval"]')?.innerText.includes('批准快速转账')`, 'second quick transfer approval');
        await click(popup, '[data-testid="approve-button"]');
        await waitFor(dapp, `() => Boolean(window.__panguTxResult) || Boolean(window.__panguError)`, 'submitted transaction result');
        const early = await evaluate(dapp, `(() => ({ result: window.__panguTxResult, error: window.__panguError, events: window.__panguEvents }))()`);
        const failureStorage = early.error ? await evaluate(extension.client, `(async () => {
            const local = await chrome.storage.local.get(null);
            const session = await chrome.storage.session.get(null);
            return {
                address: local.pangu_v2_accounts?.['${accountId}']?.addresses?.['${walletAddress}'] || null,
                sessionAddressKeys: Object.keys(session.pangu_v2_session?.addressKeys || {}),
            };
        })()`) : null;
        assert.equal(early.error, null, JSON.stringify({ early, requests: fixture.requests, failureStorage, workerLogs }));
        assert.deepEqual(early.result, { txId: submittedTxId, mode: 'quick', status: 'submitted' });

        await waitFor(
            dapp,
            `() => window.__panguEvents.some((event) => event.txId === '${submittedTxId}' && event.status === 'submitted')`,
            'submitted txStatus event'
        );
        await waitFor(
            dapp,
            `() => window.__panguEvents.some((event) => event.txId === '${submittedTxId}' && event.status === 'success')`,
            'final success txStatus event'
        );

        const submitRequest = fixture.requests.find((request) => request.pathname === `/api/v1/${groupId}/assign/submit-tx`);
        assert.ok(submitRequest, 'fixture backend did not receive a transaction submission');
        const submitted = JSON.parse(submitRequest.body);
        assert.equal(submitted.TX.TXOutputs[0].ToAddress, recipientAddress);
        assert.equal(Number(submitted.TX.TXOutputs[0].Type ?? submitted.TX.TXOutputs[0].ToCoinType), 0);
        assert.ok(submitted.TX.UserSignatureV2?.Signature, 'submitted transaction is missing protocol-v2 signature');
        assert.ok(submitted.TX.TXInputsNormal?.[0]?.SeedReveal, 'submitted transaction is missing seed reveal');
        assert.ok(fixture.statusPolls >= 2, 'background did not continue polling to final status');

        const finalState = await evaluate(dapp, `(() => ({ events: window.__panguEvents, account: window.__panguAccount }))()`);
        console.log(JSON.stringify({
            check: 'minimal-e2e',
            account: finalState.account,
            transaction: early.result,
            events: finalState.events,
            backendRequests: fixture.requests.map((request) => `${request.method} ${request.pathname}`),
        }, null, 2));
        if (visible) await dapp.send('Page.bringToFront');
        if (keepOpen) {
            console.log(`[demo:minimal] Local DApp remains open at ${fixture.baseUrl}`);
            await new Promise((resolve) => {
                process.once('SIGINT', resolve);
                process.once('SIGTERM', resolve);
            });
        }
    } finally {
        for (const client of clients) client.close();
        stopEdge(edgeProcess);
        await closeServer(fixture?.server);
        for (let attempt = 0; attempt < 20; attempt += 1) {
            try {
                fs.rmSync(profileDir, { recursive: true, force: true });
                if (!fs.existsSync(profileDir)) break;
            } catch {
                await sleep(250);
            }
        }
    }
}

run().catch((error) => {
    console.error(`[check:minimal-e2e] ${error.stack || error.message || error}`);
    process.exitCode = 1;
});
