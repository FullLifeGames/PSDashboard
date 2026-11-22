import { spawn } from 'node:child_process';

/**
 * Round 90 (#222): captures the saved engine results the browser specs seed (test/e2e/eval-store.ts, test/e2e-capture/). It runs the
 * analysis of every capture once in the browser on a dev server (feature flags on, as in the e2e suite) and writes the IndexedDB records
 * to test/e2e/fixtures/eval-store/. Run it when a spec says "fixture stale", then commit the files.
 *
 *   node scripts/capture-eval-store.mjs [--dev-port <n>] [--only <replay id or file name>]
 */
const args = process.argv.slice(2);
let port = process.env.PS_DEV_PORT ?? '5177';
let only = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--dev-port') port = args[++i];
  else if (args[i] === '--only') only = args[++i];
  else {
    console.error(`Unknown argument ${args[i]}. Usage: node scripts/capture-eval-store.mjs [--dev-port <n>] [--only <replay id or file name>]`);
    process.exit(2);
  }
}
const child = spawn(
  process.execPath,
  ['./scripts/run-e2e.mjs', '--dev-port', port, '-c', 'playwright.capture.config.ts', '--workers=1'],
  { stdio: 'inherit', env: { ...process.env, ...(only ? { EVAL_STORE_ONLY: only } : {}) } },
);
child.on('exit', code => process.exit(code ?? 1));
