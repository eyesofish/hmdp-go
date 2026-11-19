import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const testDir = fileURLToPath(new URL('./', import.meta.url));
const project = 'hmdp-e2e-' + randomUUID().slice(0, 8);
const composeArgs = [
  'compose', '-p', project, '-f', 'compose.yaml', '-f', 'tests/e2e/compose.yaml', '--profile', 'web',
];

function compose(args, stdio = 'inherit') {
  return execFileSync('docker', [...composeArgs, ...args], { cwd: root, stdio, encoding: 'utf8' });
}

function port(service, containerPort) {
  const endpoint = compose(['port', service, containerPort], 'pipe').trim();
  return new URL('http://' + endpoint).port;
}

async function waitForApi(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url + '/api/shop-type/list', { signal: AbortSignal.timeout(2000) });
      if (response.ok && (await response.json()).success) return;
    } catch {
      // Nginx may already be up while the API is still initializing.
    }
    await delay(500);
  }
  throw new Error('Shop type API did not become ready at ' + url);
}

try {
  compose(['up', '-d', '--build', '--wait', '--wait-timeout', '240']);
  const baseURL = 'http://127.0.0.1:' + port('frontend', '80');
  await waitForApi(baseURL);
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  execFileSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
    cwd: testDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      E2E_BASE_URL: baseURL,
      E2E_MYSQL_PORT: port('mysql', '3306'),
      E2E_REDIS_PORT: port('redis', '6379'),
    },
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = error.status || 1;
} finally {
  compose(['down', '-v', '--rmi', 'local', '--remove-orphans']);
}
