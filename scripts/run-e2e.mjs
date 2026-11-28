import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { connect } from 'node:net';

const host = '127.0.0.1';
const DEFAULT_PORT = '5174';

// Taken out of the argument list: Playwright has no --port (only --ui-port), aborts on an unknown option
// and reads a bare number as a test filter.
function takeDevPort(argv) {
  const rest = [];
  let port = process.env.PS_DEV_PORT ?? DEFAULT_PORT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dev-port') {
      port = argv[i + 1] ?? '';
      i += 1;
    } else if (argv[i].startsWith('--dev-port=')) {
      port = argv[i].slice('--dev-port='.length);
    } else {
      rest.push(argv[i]);
    }
  }
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error(`--dev-port / PS_DEV_PORT expects a port from 1 to 65535, got "${port}"`);
  }
  return { port, rest };
}

const { port, rest: playwrightArgs } = takeDevPort(process.argv.slice(2));
const baseUrl = `http://${host}:${port}`;
const viteBin = './node_modules/vite/bin/vite.js';
const viteArgs = [viteBin, '--host', host, '--port', port, '--strictPort'];

let server = null;
let serverExited = false;
let serverExit = Promise.resolve({ code: null, signal: null });
let tests = null;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// The packages vite.config.ts pre-bundles (optimizeDeps.include).
const PREBUNDLED_DEPS = ['@pkmn/client', '@pkmn/data', '@pkmn/dex', '@pkmn/sim', '@pkmn/smogon', '@smogon/calc'];
const METADATA_PATH = './node_modules/.vite/deps/_metadata.json';

// A cold cache makes Vite bundle at startup and reload every open page, aborting a running test's dynamic imports;
// the optimizer writes the metadata file last, so a complete, unchanging file means the reload is over.
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

function answers(address) {
  return new Promise(resolve => {
    const socket = connect({ host: address, port: Number(port) });
    const done = result => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// --strictPort guards only 127.0.0.1 and plain `vite` may listen on ::1, so both loopback addresses are checked;
// the runner never clears the port: the owner may be a live measurement.
async function assertPortFree() {
  for (const address of ['127.0.0.1', '::1']) {
    if (await answers(address)) {
      throw new Error(
        `Port ${port} is busy (${address}): an earlier run or a second session still holds it. `
        + `Find the owner of port ${port}, check its command line, and stop it yourself (Windows: netstat -ano | findstr :${port}).`,
      );
    }
  }
}

// The e2e specs run with the flag on; one already in the environment wins, the feedback run keeps the shipped build.
const FEATURE_FLAGS = ['VITE_FEATURE_OPPONENT_READS'];
function serverEnv() {
  const feedback = playwrightArgs.some(arg => arg.includes('playwright.feedback.config'));
  if (feedback) return process.env;
  return { ...process.env, ...Object.fromEntries(FEATURE_FLAGS.filter(name => process.env[name] === undefined).map(name => [name, '1'])) };
}

function startServer() {
  server = spawn(process.execPath, viteArgs, {
    stdio: 'inherit',
    windowsHide: true,
    env: serverEnv(),
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

function killTree(child) {
  if (process.platform !== 'win32') {
    child.kill('SIGTERM');
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('exit', resolve);
    killer.on('error', resolve);
  });
}

async function stopServer() {
  if (!server || serverExited || !server.pid) return;

  await killTree(server);
  await Promise.race([serverExit, delay(2000)]);
  if (!serverExited && process.platform !== 'win32') server.kill('SIGKILL');
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => {
    const children = tests && tests.exitCode === null && tests.pid ? [killTree(tests)] : [];
    void Promise.all([...children, stopServer()]).then(() => process.exit(1));
  });
}

async function run() {
  await assertPortFree();
  startServer();
  await waitForServer();
  await waitForDependencyCache();

  const testArgs = ['./node_modules/@playwright/test/cli.js', 'test', ...playwrightArgs];
  tests = spawn(process.execPath, testArgs, {
    stdio: 'inherit',
    windowsHide: true,
    // PS_DEV_PORT lets the Playwright config build the same base URL.
    env: { ...process.env, PS_DEV_PORT: port },
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
