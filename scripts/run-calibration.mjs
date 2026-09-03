// Runs the calibration bench in parallel slices and merges the dumps.
//
//   node scripts/run-calibration.mjs [--slices 6] [--out .calibration/<stamp>]
//                                    [--env KEY=VALUE ...] [--tranche NAME]
//
// Each slice is one Playwright process over regression/eval-calibration.spec.ts
// with EVAL_CALIBRATION=1, EVAL_CALIBRATION_SLICE=i/N, and its own dump
// (<out>/slice-i.jsonl; console in <out>/slice-i.log). The measurement line
// is EVAL_CALIBRATION_MODE=auto EVAL_CALIBRATION_SMOGON=1; --env overrides or
// adds variables, --tranche restricts the corpus to one stratum. Afterwards
// the dumps merge into <out>/merged.jsonl (sorted by replay id, then turn,
// the order the harness sums in), the harness's aggregate lines print and
// land in <out>/summary.txt, and <out>/run.json keeps the configuration,
// exit codes, and wall times. A red slice still merges; the exit code stays
// non-zero then. Slices are independent (one replay belongs to exactly one
// slice), so the merged aggregate equals a single-process run.
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeDumps, summarize } from './calibration-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_ENV = { EVAL_CALIBRATION_MODE: 'auto', EVAL_CALIBRATION_SMOGON: '1' };
const SPEC = 'regression/eval-calibration.spec.ts';

function usage() {
  console.log('usage: node scripts/run-calibration.mjs [--slices 6] [--out <dir>] [--env KEY=VALUE ...] [--tranche NAME]');
}

function fail(message) {
  console.error(message);
  usage();
  process.exit(2);
}

function parseArgs(argv) {
  const options = { slices: 6, out: null, env: {}, tranche: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };
    if (arg === '--slices') options.slices = parseInt(next(), 10);
    else if (arg === '--out') options.out = next();
    else if (arg === '--tranche') options.tranche = next();
    else if (arg === '--env') {
      const pair = next();
      const eq = pair.indexOf('=');
      if (eq <= 0) fail(`--env expects KEY=VALUE, got ${pair}`);
      options.env[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      fail(`unknown argument ${arg}`);
    }
  }
  if (!Number.isInteger(options.slices) || options.slices < 1) fail('--slices must be a positive integer');
  return options;
}

function stamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function runSlice(index, slices, outDir, env) {
  return new Promise(done => {
    const dump = join(outDir, `slice-${index}.jsonl`);
    const log = createWriteStream(join(outDir, `slice-${index}.log`));
    const started = Date.now();
    const child = spawn(process.execPath, [
      join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'), 'test',
      '-c', 'playwright.regression.config.ts', '--project=app', '--reporter=list',
      '--output', join(outDir, `playwright-slice-${index}`),
      SPEC,
    ], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...env,
        EVAL_CALIBRATION: '1',
        EVAL_CALIBRATION_SLICE: `${index}/${slices}`,
        EVAL_CALIBRATION_DUMP: dump,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const forward = chunk => {
      log.write(chunk);
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) console.log(`[slice ${index}] ${line}`);
      }
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('close', code => {
      log.end();
      done({ index, code, seconds: Math.round((Date.now() - started) / 1000), dump });
    });
  });
}

function commitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  } catch {
    return null;
  }
}

const options = parseArgs(process.argv.slice(2));
const env = { ...DEFAULT_ENV, ...options.env };
if (options.tranche) env.EVAL_CALIBRATION_TRANCHE = options.tranche;
const outDir = resolve(ROOT, options.out ?? join('.calibration', stamp()));
mkdirSync(outDir, { recursive: true });
const startedAt = new Date();
console.log(`calibration: ${options.slices} slice(s), env ${JSON.stringify(env)}, output ${outDir}`);

const results = await Promise.all(
  Array.from({ length: options.slices }, (_, index) => runSlice(index, options.slices, outDir, env)),
);
const present = results.filter(result => existsSync(result.dump));
const merged = mergeDumps(present.map(result => result.dump));
writeFileSync(join(outDir, 'merged.jsonl'), merged.map(sample => JSON.stringify(sample)).join('\n') + (merged.length > 0 ? '\n' : ''));
const lines = summarize(merged);
const failures = results.filter(result => result.code !== 0 || !existsSync(result.dump));

console.log('');
for (const result of results) {
  const state = result.code === 0 ? 'ok' : `exit ${result.code}`;
  const dumped = existsSync(result.dump) ? '' : ' (no dump)';
  console.log(`slice ${result.index}: ${state}, ${result.seconds}s${dumped}`);
}
console.log(`merged ${merged.length} samples from ${present.length}/${options.slices} slices (${Math.round((Date.now() - startedAt.getTime()) / 1000)}s wall)`);
for (const line of lines) console.log(line);
writeFileSync(join(outDir, 'summary.txt'), lines.join('\n') + '\n');
writeFileSync(join(outDir, 'run.json'), JSON.stringify({
  commit: commitHash(),
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  slices: options.slices,
  env,
  samples: merged.length,
  results: results.map(({ index, code, seconds }) => ({ index, code, seconds })),
}, null, 2) + '\n');
if (failures.length > 0) {
  console.error(`${failures.length} slice(s) failed or left no dump; the merged summary above is partial.`);
  process.exitCode = 1;
}
