import fs from 'node:fs/promises';
import path from 'node:path';

const pluginRoot = process.cwd();
const pluginApiPath = path.resolve(pluginRoot, 'src', 'core', 'api.ts');
const frontendApiPath = path.resolve(pluginRoot, '..', 'TransferAreaInterface', 'js', 'config', 'api.ts');

function normalizeExpression(expression) {
  return expression
    .replace(/\s+/g, '')
    .replace(/:\s*string/g, '')
    .replace(/:\s*number/g, '')
    .replace(/:\s*boolean/g, '')
    .replace(/:\s*unknown/g, '')
    .replace(/:\s*any/g, '')
    .replace(/,\)/g, ')');
}

function extractApiEndpoints(source) {
  const match = source.match(/API_ENDPOINTS\s*=\s*{([\s\S]*?)}\s*as const/);
  if (!match) {
    throw new Error('API_ENDPOINTS block not found');
  }

  const body = match[1];
  const lines = body.split('\n');
  const endpoints = new Map();

  for (const line of lines) {
    const withoutComment = line.split('//')[0];
    const trimmed = withoutComment.trim();
    if (!trimmed) continue;

    const entry = trimmed.match(/^([A-Z0-9_]+)\s*:\s*(.+?)(?:,)?$/);
    if (!entry) continue;

    const key = entry[1];
    const value = normalizeExpression(entry[2]);
    endpoints.set(key, value);
  }

  return endpoints;
}

function diffEndpoints(base, target) {
  const missing = [];
  for (const key of base.keys()) {
    if (!target.has(key)) missing.push(key);
  }
  return missing;
}

function mismatchEndpoints(base, target) {
  const mismatches = [];
  for (const [key, value] of base.entries()) {
    if (!target.has(key)) continue;
    const other = target.get(key);
    if (value !== other) {
      mismatches.push({ key, base: value, target: other });
    }
  }
  return mismatches;
}

async function run() {
  const [pluginSource, frontendSource] = await Promise.all([
    fs.readFile(pluginApiPath, 'utf8'),
    fs.readFile(frontendApiPath, 'utf8'),
  ]);

  const pluginEndpoints = extractApiEndpoints(pluginSource);
  const frontendEndpoints = extractApiEndpoints(frontendSource);

  const missingInPlugin = diffEndpoints(frontendEndpoints, pluginEndpoints);
  const extraInPlugin = diffEndpoints(pluginEndpoints, frontendEndpoints);
  const mismatches = mismatchEndpoints(frontendEndpoints, pluginEndpoints);

  console.log('API endpoint parity check');
  console.log(`- Plugin: ${pluginApiPath}`);
  console.log(`- Frontend: ${frontendApiPath}`);

  if (!missingInPlugin.length && !extraInPlugin.length && !mismatches.length) {
    console.log('OK: API_ENDPOINTS entries match.');
    return;
  }

  if (missingInPlugin.length) {
    console.log('Missing in plugin:', missingInPlugin.join(', '));
  }
  if (extraInPlugin.length) {
    console.log('Extra in plugin:', extraInPlugin.join(', '));
  }
  if (mismatches.length) {
    console.log('Mismatched entries:');
    for (const item of mismatches) {
      console.log(`- ${item.key}`);
      console.log(`  frontend: ${item.base}`);
      console.log(`  plugin:   ${item.target}`);
    }
  }

  process.exitCode = 1;
}

run().catch((error) => {
  console.error('API endpoint parity check failed:', error.message);
  process.exitCode = 1;
});
