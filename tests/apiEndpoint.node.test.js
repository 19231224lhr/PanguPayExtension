import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';

const root = process.cwd();

async function loadApiEndpoints() {
  const result = await esbuild.build({
    stdin: {
      contents: `
        import {
          API_BASE_URL,
          API_ENDPOINTS,
          buildApiUrl,
          buildAssignNodeUrl,
          buildAggrNodeUrl,
        } from './src/core/api.ts';
        globalThis.__apiEndpoints = {
          API_BASE_URL,
          API_ENDPOINTS,
          buildApiUrl,
          buildAssignNodeUrl,
          buildAggrNodeUrl,
        };
      `,
      resolveDir: root,
      sourcefile: 'api-endpoint-test-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
    packages: 'external',
  });
  const context = {
    console,
    Buffer,
    process,
    URL,
    require: createRequire(import.meta.url),
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(result.outputFiles[0].text, context, { timeout: 10_000 });
  return context.__apiEndpoints;
}

test('absolute Assign and Aggregation endpoints remain authoritative', async () => {
  const api = await loadApiEndpoints();
  assert.equal(api.API_BASE_URL, 'http://127.0.0.1:3001');
  assert.equal(api.buildAssignNodeUrl('http://127.0.0.1:3001/'), 'http://127.0.0.1:3001');
  assert.equal(api.buildAssignNodeUrl('https://assign.example.test/base/'), 'https://assign.example.test/base');
  assert.equal(api.buildAggrNodeUrl('http://localhost:3004/'), 'http://localhost:3004');
  assert.equal(api.buildApiUrl('http://127.0.0.1:3001/', '/health'), 'http://127.0.0.1:3001/health');
  assert.equal(api.API_ENDPOINTS.ASSIGN_SUBMIT_TX('group-a'), '/api/v1/group-a/assign/submit-tx');
  assert.equal(api.API_ENDPOINTS.ASSIGN_TX_STATUS('group-a', 'tx-1'), '/api/v1/group-a/assign/tx-status/tx-1');
  assert.equal(api.API_ENDPOINTS.COM_QUERY_ADDRESS, '/api/v1/com/query-address');
  assert.equal(api.API_ENDPOINTS.COM_QUERY_ADDRESS_GROUP, '/api/v1/com/query-address-group');
});
