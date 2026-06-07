import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

function run(command, args, options = {}) {
  let executable = command;
  let finalArgs = args;
  if (command === 'npm' && process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)) {
    executable = process.execPath;
    finalArgs = [process.env.npm_execpath, ...args];
  }
  const result = spawnSync(executable, finalArgs, {
    stdio: 'inherit',
    ...options,
  });
  if (result.error) {
    console.error(`[check:dapp-tx-approve-local-api-smoke] failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const localApiBase = process.env.PANGUPAY_LOCAL_API_BASE_URL || 'http://127.0.0.1:3001';

try {
  run('npm', ['run', 'build'], {
    env: {
      ...process.env,
      VITE_PANGU_API_BASE_URL: localApiBase,
    },
  });

  run('node', ['scripts/check-dapp-tx-approve-browser-smoke.js'], {
    env: {
      ...process.env,
      PANGUPAY_EXPECT_API_HOST: '127.0.0.1',
    },
  });
} finally {
  run('npm', ['run', 'build'], {
    env: {
      ...process.env,
      VITE_PANGU_API_BASE_URL: '',
    },
  });
}
