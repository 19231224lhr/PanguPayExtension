import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
    PBKDF2_ITERATIONS,
    SESSION_TTL_MS,
    decryptSecrets,
    encryptSecrets,
    isSessionExpired,
    validateWalletBundle,
} from '../src/minimal/vault.ts';
import {
    isPublicPageMessage,
    isTrustedUiSender,
    normalizeQuickTransfer,
    resolveSenderOrigin,
} from '../src/minimal/messages.ts';
import { APPROVAL_TIMEOUT_MS, remainingApprovalMs } from '../src/minimal/approvalPolicy.ts';

const privateKey = '1'.repeat(64);
const address = 'a'.repeat(40);

function walletBundle() {
    return {
        version: 1,
        account: {
            accountId: '90000001',
            accountAddress: 'alice-account',
            mainAddress: address,
            defaultAddress: address,
            addresses: {
                [address]: {
                    address,
                    type: 0,
                    balance: '100',
                    utxos: {},
                    txCers: {},
                },
            },
            totalBalance: { 0: '100' },
        },
        organization: {
            groupId: '10000000',
            groupName: 'Local test group',
            assignAPIEndpoint: 'http://127.0.0.1:3002',
            aggrAPIEndpoint: 'http://127.0.0.1:3003',
            pledgeAddress: address,
        },
        secrets: {
            accountPrivateKey: privateKey,
            addressPrivateKeys: { [address]: privateKey },
        },
    };
}

test('validates the one-account wallet bundle used by the minimal extension', () => {
    const bundle = validateWalletBundle(walletBundle());
    assert.equal(bundle.version, 1);
    assert.equal(bundle.account.mainAddress, address);
    assert.equal(bundle.organization.groupId, '10000000');
});

test('rejects wallet bundles without the main address private key', () => {
    const bundle = walletBundle();
    bundle.secrets.addressPrivateKeys = {};
    assert.throws(() => validateWalletBundle(bundle), /main address private key/i);
});

test('strips plaintext key material from the imported account record', () => {
    const bundle = walletBundle() as ReturnType<typeof walletBundle> & {
        account: { addresses: Record<string, Record<string, unknown>>; accountPrivateKey?: string };
    };
    bundle.account.accountPrivateKey = privateKey;
    bundle.account.addresses[address].privHex = privateKey;
    bundle.account.addresses[address].addressRootSeedHex = '2'.repeat(64);

    const validated = validateWalletBundle(bundle);
    assert.equal((validated.account as unknown as Record<string, unknown>).accountPrivateKey, undefined);
    assert.equal(validated.account.addresses[address].privHex, undefined);
    assert.equal(validated.account.addresses[address].addressRootSeedHex, undefined);
});

test('requires a valid default address and HTTP organization endpoints', () => {
    const withoutDefault = walletBundle();
    delete withoutDefault.account.defaultAddress;
    assert.throws(() => validateWalletBundle(withoutDefault), /default address/i);

    const badEndpoint = walletBundle();
    badEndpoint.organization.assignAPIEndpoint = 'not-a-url';
    assert.throws(() => validateWalletBundle(badEndpoint), /Assign endpoint/i);
});

test('encrypts secrets with the planned KDF and rejects a wrong password or tampering', async () => {
    assert.equal(PBKDF2_ITERATIONS, 600_000);
    const encrypted = await encryptSecrets(walletBundle().secrets, 'password-123');
    assert.equal(encrypted.iterations, PBKDF2_ITERATIONS);
    assert.ok(!encrypted.ciphertext.includes(privateKey));
    assert.deepEqual(await decryptSecrets(encrypted, 'password-123'), walletBundle().secrets);
    await assert.rejects(() => decryptSecrets(encrypted, 'wrong-password'), /unlock wallet/i);

    const tampered = {
        ...encrypted,
        ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA`,
    };
    await assert.rejects(() => decryptSecrets(tampered, 'password-123'), /unlock wallet/i);
});

test('validates every private key after decrypting the wallet', async () => {
    const invalidSecrets = {
        ...walletBundle().secrets,
        addressPrivateKeys: { [address]: 'not-a-private-key' },
    };
    const encrypted = await encryptSecrets(invalidSecrets, 'password-123');
    await assert.rejects(() => decryptSecrets(encrypted, 'password-123'), /unlock wallet/i);
});

test('expires unlocked sessions after exactly fifteen minutes', () => {
    assert.equal(SESSION_TTL_MS, 15 * 60 * 1000);
    assert.equal(isSessionExpired({ expiresAt: 1_000 }, 999), false);
    assert.equal(isSessionExpired({ expiresAt: 1_000 }, 1_000), true);
});

test('does not extend the fixed unlock deadline when keys are read', () => {
    const storage = fs.readFileSync('src/core/storage.ts', 'utf8');
    const getSessionKey = storage.slice(storage.indexOf('export function getSessionKey'), storage.indexOf('export function clearSession'));
    const getAddressKey = storage.slice(storage.indexOf('export function getSessionAddressKey'), storage.indexOf('export function removeSessionAddressKey'));
    const persistSession = storage.slice(storage.indexOf('async function persistSession'), storage.indexOf('export async function hydrateSession'));

    assert.doesNotMatch(getSessionKey, /persistSession|refreshSessionExpiry/);
    assert.doesNotMatch(getAddressKey, /persistSession|refreshSessionExpiry/);
    assert.doesNotMatch(persistSession, /Date\.now\(\) \+ sessionAutoLockMs/);
});

test('session alarm does not race a new unlock while the wallet is already locked', () => {
    const background = fs.readFileSync('src/background/index.ts', 'utf8');
    const alarm = background.slice(background.indexOf('chrome.alarms.onAlarm'), background.indexOf('async function initialize'));

    assert.match(alarm, /hasActiveSession\(account\.accountId\)/);
    assert.doesNotMatch(alarm, /lockWallet\(/);
});

test('publishes the encrypted wallet record only after core account state is ready', () => {
    const walletStore = fs.readFileSync('src/minimal/walletStore.ts', 'utf8');
    const importFlow = walletStore.slice(walletStore.indexOf('export async function importWalletBundle'), walletStore.indexOf('async function writeSession'));
    const saveOrganization = importFlow.indexOf('await saveOrganization');
    const publishRecord = importFlow.indexOf('await chrome.storage.local.set');

    assert.ok(saveOrganization >= 0);
    assert.ok(publishRecord > saveOrganization);
});

test('uses an exact two-minute approval timeout boundary', () => {
    assert.equal(APPROVAL_TIMEOUT_MS, 120_000);
    assert.equal(remainingApprovalMs(1_000, 120_999), 1);
    assert.equal(remainingApprovalMs(1_000, 121_000), 0);
    assert.equal(remainingApprovalMs(1_000, 200_000), 0);
});

test('keeps decrypted core session keys out of persistent local storage', () => {
    const storage = fs.readFileSync('src/core/storage.ts', 'utf8');
    const session = storage.slice(storage.indexOf('interface SessionRecord'), storage.indexOf('// Wallet Address Helpers'));
    assert.match(session, /chrome\.storage\.session/);
    assert.doesNotMatch(session, /setStorageData\(STORAGE_KEYS\.SESSION/);
    assert.doesNotMatch(session, /getStorageData<SessionRecord>\(STORAGE_KEYS\.SESSION/);
});

test('isolates all rewritten wallet state behind the pangu_v2 storage prefix', () => {
    const storage = fs.readFileSync('src/core/storage.ts', 'utf8');
    const keys = storage.slice(storage.indexOf('const STORAGE_KEYS'), storage.indexOf('function normalizeHexString'));
    const values = [...keys.matchAll(/:\s*'(pangu_[^']+)'/g)].map((match) => match[1]);
    assert.ok(values.length >= 10);
    assert.ok(values.every((value) => value.startsWith('pangu_v2_')));
});

test('accepts only the four public page message types', () => {
    for (const type of ['PANGU_CONNECT', 'PANGU_GET_ACCOUNT', 'PANGU_SEND_TRANSACTION', 'PANGU_DISCONNECT']) {
        assert.equal(isPublicPageMessage({ type, requestId: crypto.randomUUID() }), true);
    }
    assert.equal(isPublicPageMessage({ type: 'PANGU_UI_APPROVE', requestId: 'attacker' }), false);
    assert.equal(isPublicPageMessage({ type: 'PANGU_DAPP_TX_APPROVE', requestId: 'attacker' }), false);
});

test('trusts approval commands only from a chrome-extension page', () => {
    const extensionBase = 'chrome-extension://abcdefghijklmnop/';
    assert.equal(isTrustedUiSender({
        id: 'abcdefghijklmnop',
        url: `${extensionBase}src/popup/index.html`,
    }, extensionBase), true);
    assert.equal(isTrustedUiSender({
        id: 'abcdefghijklmnop',
        url: `${extensionBase}src/popup/index.html`,
        tab: { id: 7 },
    }, extensionBase), true);
    assert.equal(isTrustedUiSender({
        id: 'abcdefghijklmnop',
        url: 'http://127.0.0.1/dapp',
        tab: { id: 5 },
    }, extensionBase), false);
});

test('derives the DApp origin from the sender URL and normalizes only a quick transfer', () => {
    assert.equal(resolveSenderOrigin('http://127.0.0.1:20888/pay?x=1'), 'http://127.0.0.1:20888');
    assert.deepEqual(normalizeQuickTransfer({ toAddress: address, amount: '1.25' }), {
        toAddress: address,
        amount: '1.25',
    });
    assert.throws(() => normalizeQuickTransfer({ toAddress: '', amount: '1' }), /recipient/i);
    assert.throws(() => normalizeQuickTransfer({ toAddress: address, amount: '0' }), /amount/i);
});

test('routes public page messages and private UI approvals through separate trust boundaries', () => {
    const content = fs.readFileSync('src/content/index.ts', 'utf8');
    const background = fs.readFileSync('src/background/index.ts', 'utf8');
    assert.match(content, /isPublicPageMessage/);
    assert.doesNotMatch(content, /startsWith\(['"]PANGU_/);
    assert.match(background, /isTrustedUiSender/);
    assert.match(background, /resolveSenderOrigin\(sender\.url\)/);
    assert.doesNotMatch(background, /message\.site\?\.origin/);
});

test('exposes only the minimal provider surface with cryptographic request IDs', () => {
    const inject = fs.readFileSync('src/content/inject.js', 'utf8');
    assert.match(inject, /crypto\.randomUUID\(\)/);
    assert.doesNotMatch(inject, /Math\.random/);
    assert.doesNotMatch(inject, /connectSigned/);
    for (const method of ['connect', 'getAccount', 'sendTransaction', 'isConnected', 'disconnect', 'on', 'off']) {
        assert.match(inject, new RegExp(`${method}[:(]`));
    }
});

test('limits extension injection and backend access to the two local test hosts', () => {
    const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
    const localMatches = ['http://localhost/*', 'http://127.0.0.1/*'];
    assert.deepEqual(manifest.content_scripts[0].matches, localMatches);
    assert.deepEqual(manifest.host_permissions, localMatches);
    assert.deepEqual(manifest.web_accessible_resources[0].matches, localMatches);
    assert.ok(!manifest.permissions.includes('tabs'));
});

test('uses only the build-time API base URL with a local 127.0.0.1 default', () => {
    const api = fs.readFileSync('src/core/api.ts', 'utf8');
    assert.match(api, /VITE_PANGU_API_BASE_URL/);
    assert.match(api, /http:\/\/127\.0\.0\.1:3001/);
    assert.doesNotMatch(api, /__API_BASE_URL__|__PANGU_API_BASE_URL__/);
});

test('uses Vue 3 as the only popup framework dependency', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const vite = fs.readFileSync('vite.config.ts', 'utf8');
    assert.match(pkg.dependencies.vue, /^\^3\./);
    assert.ok(!pkg.dependencies['vue-router']);
    assert.ok(!pkg.dependencies.pinia);
    assert.match(vite, /@vitejs\/plugin-vue/);
});

test('removes the legacy popup implementation and runtime API override asset', () => {
    assert.equal(fs.existsSync('src/popup/pages'), false);
    assert.equal(fs.existsSync('src/popup/utils'), false);
    assert.equal(fs.existsSync('public/runtime-config.js'), false);
});
