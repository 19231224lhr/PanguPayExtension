import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--test', 'tests/apiEndpoint.node.test.js'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);

console.log('[check:api] local extension API contract checks passed');
