import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function fail(message) {
  console.error(`[check:protocol] ${message}`);
  process.exitCode = 1;
}

const addressSource = read('src/core/address.ts');
const walletCreateSource = read('src/popup/pages/walletCreate.ts');
const walletImportSource = read('src/popup/pages/walletImport.ts');
const contentSource = read('src/content/index.ts');
const backgroundSource = read('src/background/index.ts');

if (addressSource.includes('accountPrivHex ? getPublicKeyHexFromPrivate(accountPrivHex)')) {
  fail('SignPublicKeyV2 still falls back to address public key when account private key is missing.');
}

if (/registerAddressOnComNode\s*\(\s*(?:\r?\n\s*)?(?!\{)/.test(walletCreateSource + walletImportSource)) {
  fail('wallet create/import must call registerAddressOnComNode with explicit object parameters.');
}

if (!/accountPrivHex:\s*session[!.]?\.(privKey)/.test(walletCreateSource + walletImportSource)) {
  fail('wallet create/import retail registration must pass the active account private key.');
}

for (const field of ['txId', 'status', 'mode', 'error']) {
  if (!contentSource.includes(`${field}: message.${field}`)) {
    fail(`content script does not forward DApp event field ${field}.`);
  }
}

if (!backgroundSource.includes('saveDappTxWatch')) {
  fail('background does not record DApp tx watches after transaction approval.');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[check:protocol] protocol guard checks passed');
