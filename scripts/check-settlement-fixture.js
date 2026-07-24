import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['--test', '--test-name-pattern', 'transaction hashes', 'tests/protocolV2.node.test.js'],
  { cwd: process.cwd(), stdio: 'inherit' }
);
process.exit(result.status ?? 1);
