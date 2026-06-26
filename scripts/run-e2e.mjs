import { spawn } from 'node:child_process';

const host = '127.0.0.1';
const port = '5174';
const baseUrl = `http://${host}:${port}`;
const viteArgs = [
  './node_modules/vite/bin/vite.js',
  '--host',
  host,
  '--port',
  port,
  '--strictPort',
];

const server = spawn(process.execPath, viteArgs, {
  stdio: 'inherit',
  windowsHide: true,
});

let serverExited = false;
const serverExit = new Promise(resolve => {
  server.on('exit', (code, signal) => {
    serverExited = true;
    resolve({ code, signal });
  });
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  if (serverExited || !server.pid) return;

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
  await waitForServer();

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
