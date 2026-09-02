import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';

const host = '127.0.0.1';
const port = '5174';
const baseUrl = `http://${host}:${port}`;
const viteBin = './node_modules/vite/bin/vite.js';
const viteArgs = [viteBin, '--host', host, '--port', port, '--strictPort'];

let server = null;
let serverExited = false;
let serverExit = Promise.resolve({ code: null, signal: null });

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** The packages vite.config.ts pre-bundles (optimizeDeps.include) — the ones the app reaches through lazy imports. */
const PREBUNDLED_DEPS = ['@pkmn/client', '@pkmn/data', '@pkmn/dex', '@pkmn/sim', '@pkmn/smogon', '@smogon/calc'];
const METADATA_PATH = './node_modules/.vite/deps/_metadata.json';

/**
 * Wait for the dependency optimizer to settle before the first test opens
 * a page. With a cold or outdated cache Vite bundles at startup and sends
 * every open page a reload when it finishes, which aborted the dynamic
 * imports of whichever test was running at that moment. The optimizer
 * writes the metadata file last, so a complete and unchanging file means
 * the reload (if any) already went out to nobody.
 */
async function waitForDependencyCache() {
  await fetch(`${baseUrl}/src/main.tsx`).catch(() => {});
  const deadline = Date.now() + 60_000;
  let lastMtime = 0;
  let stableSince = 0;
  while (Date.now() < deadline) {
    try {
      const { mtimeMs } = await stat(METADATA_PATH);
      const metadata = JSON.parse(await readFile(METADATA_PATH, 'utf8'));
      const optimized = Object.keys(metadata.optimized ?? {});
      if (PREBUNDLED_DEPS.every(dep => optimized.includes(dep))) {
        if (mtimeMs !== lastMtime) {
          lastMtime = mtimeMs;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= 1500) {
          return;
        }
      }
    } catch {
      // Not written yet.
    }
    await delay(250);
  }
  console.warn('The dependency cache did not settle in time; starting the tests anyway.');
}

function startServer() {
  server = spawn(process.execPath, viteArgs, {
    stdio: 'inherit',
    windowsHide: true,
  });
  serverExit = new Promise(resolve => {
    server.on('exit', (code, signal) => {
      serverExited = true;
      resolve({ code, signal });
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverExited) {
      throw new Error('Vite server exited before it became ready');
    }

    try {
      const response = await fetch(baseUrl);
      if (response.ok || response.status < 500) return;
    } catch {
      // Server is not ready yet.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function stopServer() {
  if (!server || serverExited || !server.pid) return;

  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('exit', resolve);
      killer.on('error', resolve);
    });
    return;
  }

  server.kill('SIGTERM');
  await Promise.race([serverExit, delay(1000)]);
  if (!serverExited) server.kill('SIGKILL');
}

async function run() {
  startServer();
  await waitForServer();
  await waitForDependencyCache();

  const testArgs = ['./node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)];
  const tests = spawn(process.execPath, testArgs, {
    stdio: 'inherit',
    windowsHide: true,
  });

  const code = await new Promise(resolve => {
    tests.on('exit', exitCode => resolve(exitCode ?? 1));
    tests.on('error', () => resolve(1));
  });

  await stopServer();
  process.exit(code);
}

run().catch(async error => {
  console.error(error);
  await stopServer();
  process.exit(1);
});
