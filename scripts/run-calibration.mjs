// Runs the calibration bench in parallel slices and merges the dumps.
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeDumps, summarize } from './calibration-lib.mjs';
import {
  computeFingerprint, decideReuse, fingerprintRecord, parseFraction, shortValue,
} from './calibration-fingerprint.mjs';
import { checkJobs, jobRecord, mergedRunRecord, parseSliceRange, sliceIndices } from './calibration-jobs.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_ENV = { EVAL_CALIBRATION_MODE: 'auto', EVAL_CALIBRATION_SMOGON: '1' };
const SPEC = 'test/regression/eval-calibration.spec.ts';
const CALIBRATION_DIR = '.calibration';

function usage() {
  console.log('usage: node scripts/run-calibration.mjs [--slices 6] [--out <dir>] [--env KEY=VALUE ...] [--tranche NAME] [--reuse] [--dry-run]');
  console.log('       node scripts/run-calibration.mjs --slices N --slice-range a..b --out <dir> [--env KEY=VALUE ...] [--tranche NAME]');
  console.log('       node scripts/run-calibration.mjs --merge <job dir> [--merge <job dir> ...] --out <dir>');
}

function fail(message) {
  console.error(message);
  usage();
  process.exit(2);
}

function parseArgs(argv) {
  const options = { slices: 6, out: null, env: {}, tranche: null, reuse: false, dryRun: false, sliceRange: null, merge: [] };
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
    else if (arg === '--reuse') options.reuse = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--slice-range') options.sliceRange = next();
    else if (arg === '--merge') options.merge.push(next());
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
  if (options.sliceRange !== null) {
    if (options.reuse) fail('--slice-range runs part of a run and never reuses; drop --reuse');
    if (options.merge.length > 0) fail('--slice-range and --merge are separate steps');
    if (!options.out) fail('--slice-range needs --out, the folder its job leaves for --merge');
    try {
      options.sliceRange = parseSliceRange(options.sliceRange, options.slices);
    } catch (error) {
      fail(error.message);
    }
  }
  if (options.merge.length > 0) {
    if (options.reuse || options.dryRun) fail('--merge joins finished jobs; it takes no --reuse or --dry-run');
    if (!options.out) fail('--merge needs --out, the folder of the merged run');
  }
  return options;
}

function stamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// A replay the harness could not fetch: the run lacks its rows, so it cannot serve as a base.
const HTTP_SKIP = /skipping \S+: HTTP \d+/;

function lineCounter(pattern) {
  let tail = '';
  return {
    count: 0,
    push(chunk) {
      const lines = (tail + chunk.toString()).split('\n');
      tail = lines.pop() ?? '';
      this.count += lines.filter(line => pattern.test(line)).length;
    },
    end() {
      if (pattern.test(tail)) this.count += 1;
      tail = '';
    },
  };
}

function runSlice(index, slices, outDir, env) {
  return new Promise(done => {
    const dump = join(outDir, `slice-${index}.jsonl`);
    const log = createWriteStream(join(outDir, `slice-${index}.log`));
    const started = Date.now();
    const child = spawn(process.execPath, [
      join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run',
      '--config', 'vitest.config.ts', '--project', 'app', '--reporter', 'verbose',
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
    const skips = [lineCounter(HTTP_SKIP), lineCounter(HTTP_SKIP)];
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.stdout.on('data', chunk => skips[0].push(chunk));
    child.stderr.on('data', chunk => skips[1].push(chunk));
    child.on('close', code => {
      log.end();
      for (const skip of skips) skip.end();
      done({ index, code, seconds: Math.round((Date.now() - started) / 1000), dump, httpSkips: skips[0].count + skips[1].count });
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

function listed(paths) {
  return paths.slice(0, 3).join(', ') + (paths.length > 3 ? `, +${paths.length - 3} more` : '');
}

function fingerprintLine(fingerprint) {
  if (fingerprint.value === null) return `fingerprint: none (${fingerprint.problem}); this run cannot serve as a base`;
  const state = fingerprint.dirty
    ? `uncommitted changes under the inputs: ${listed(fingerprint.dirtyPaths)}; this run cannot serve as a base`
    : `clean tree at ${fingerprint.commit}; a finished run with it can serve as a base`;
  return `fingerprint ${shortValue(fingerprint.value)} (${state})`;
}

function noReuseLine(decision, fingerprint) {
  if (decision.reason === 'unavailable') return `reuse: skipped, ${decision.detail}`;
  if (decision.reason === 'dirty') {
    return `reuse: skipped, the tree has uncommitted changes under the inputs (${listed(decision.dirtyPaths)}); a dirty tree never reuses`;
  }
  const head = `reuse: none, no finished run under ${CALIBRATION_DIR} carries fingerprint ${shortValue(fingerprint.value)}`;
  const { nearest } = decision;
  if (!nearest) return `${head}; no finished run there records a fingerprint yet (runs from before the tool have none)`;
  const shownDiffs = nearest.differs.slice(0, 4).join(', ') + (nearest.differs.length > 4 ? `, +${nearest.differs.length - 4} more` : '');
  return `${head}; the closest, ${nearest.name} (commit ${nearest.run.commit ?? 'unknown'}), differs in ${shownDiffs || 'nothing that the recipe names'}`;
}

function recordedLine(record, failures, httpSkips) {
  if (record.value === null) return `fingerprint none recorded in run.json; this run cannot serve as a base (${record.problem})`;
  const why = [];
  if (record.dirty) why.push('uncommitted changes under the inputs');
  if (!record.stable) why.push('inputs changed during the run');
  if (failures > 0) why.push('slices failed');
  if (httpSkips > 0) why.push('replays skipped on HTTP errors');
  const state = why.length > 0 ? `this run cannot serve as a base (${why.join(', ')})` : '--reuse finds this run';
  return `fingerprint ${shortValue(record.value)} recorded in run.json; ${state}`;
}

function sliceLines(results) {
  return results.map(result => {
    const state = result.code === 0 ? 'ok' : `exit ${result.code}`;
    const dumped = existsSync(result.dump) ? '' : ' (no dump)';
    const skipped = result.httpSkips > 0 ? ` (${result.httpSkips} replay(s) skipped on HTTP errors)` : '';
    return `slice ${result.index}: ${state}, ${result.seconds}s${dumped}${skipped}`;
  });
}

function writeMerged(outDir, dumps) {
  const merged = mergeDumps(dumps);
  const mergedText = merged.map(sample => JSON.stringify(sample)).join('\n') + (merged.length > 0 ? '\n' : '');
  writeFileSync(join(outDir, 'merged.jsonl'), mergedText);
  const lines = summarize(merged);
  writeFileSync(join(outDir, 'summary.txt'), lines.join('\n') + '\n');
  return { merged, mergedText, lines };
}

function mergeJobs(options) {
  const jobs = options.merge.map(dir => {
    const path = resolve(ROOT, dir);
    let job = null;
    try {
      job = JSON.parse(readFileSync(join(path, 'job.json'), 'utf8'));
    } catch {
      // checkJobs names the folder.
    }
    return { name: basename(path), path, job };
  });
  try {
    checkJobs(jobs);
  } catch (error) {
    fail(`--merge: ${error.message}`);
  }
  const outDir = resolve(ROOT, options.out);
  mkdirSync(outDir, { recursive: true });
  const present = new Set();
  for (const { path, job } of jobs) {
    for (const index of sliceIndices(job.sliceRange)) {
      for (const file of [`slice-${index}.jsonl`, `slice-${index}.log`]) {
        if (existsSync(join(path, file))) copyFileSync(join(path, file), join(outDir, file));
      }
      if (existsSync(join(outDir, `slice-${index}.jsonl`))) present.add(index);
    }
  }
  const { slices } = jobs[0].job;
  const dumps = [...present].sort((a, b) => a - b).map(index => join(outDir, `slice-${index}.jsonl`));
  const { merged, mergedText, lines } = writeMerged(outDir, dumps);
  const { record, failures } = mergedRunRecord(jobs, {
    samples: merged.length,
    mergedSha256: createHash('sha256').update(mergedText).digest('hex'),
    finishedAt: new Date().toISOString(),
    present,
  });
  writeFileSync(join(outDir, 'run.json'), JSON.stringify(record, null, 2) + '\n');
  const results = jobs.flatMap(({ job }) => job.results).sort((a, b) => a.index - b.index)
    .map(result => ({ ...result, dump: join(outDir, `slice-${result.index}.jsonl`) }));
  for (const line of sliceLines(results)) console.log(line);
  console.log(`merged ${merged.length} samples from ${present.size}/${slices} slices of ${jobs.length} job(s): ${jobs.map(({ name }) => name).join(', ')}`);
  for (const line of lines) console.log(line);
  console.log(recordedLine(record.fingerprint, failures, record.httpSkips));
  if (failures > 0) {
    console.error(`${failures} slice(s) failed or left no dump; the merged summary above is partial.`);
    process.exitCode = 1;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.merge.length > 0) {
    mergeJobs(options);
    return;
  }
  const env = { ...DEFAULT_ENV, ...options.env };
  if (options.tranche) env.EVAL_CALIBRATION_TRANCHE = options.tranche;
  // The slices inherit this process's environment, so the fraction can come from there as well as from --env.
  let fraction;
  try {
    fraction = parseFraction(env.EVAL_CALIBRATION_FRACTION ?? process.env.EVAL_CALIBRATION_FRACTION);
  } catch (error) {
    fail(error.message);
  }
  const outDir = resolve(ROOT, options.out ?? join(CALIBRATION_DIR, stamp()));
  const indices = options.sliceRange ? sliceIndices(options.sliceRange) : Array.from({ length: options.slices }, (_, index) => index);
  const what = options.sliceRange ? `slices ${options.sliceRange.join('..')} of ${options.slices}` : `${options.slices} slice(s)`;
  const fingerprintEnv = { ...env, EVAL_CALIBRATION: '1' };
  const start = computeFingerprint({ root: ROOT, env: fingerprintEnv, slices: options.slices });

  if (options.reuse || options.dryRun) {
    console.log(fingerprintLine(start));
    const decision = options.reuse ? decideReuse({ fingerprint: start, calibrationDir: join(ROOT, CALIBRATION_DIR) }) : null;
    if (decision?.action === 'reuse') {
      const { run } = decision;
      const newest = decision.matches > 1 ? `, the newest of ${decision.matches}` : '';
      console.log(`reuse: ${relative(ROOT, decision.dir)} carries fingerprint ${shortValue(start.value)} (finished ${run.finishedAt}, ${run.samples} samples, commit ${run.commit ?? 'unknown'}${newest}); no run starts`);
      if (options.out) console.log(`reuse: --out ${options.out} stays unused`);
      console.log(decision.dir);
      return;
    }
    if (decision) console.log(noReuseLine(decision, start));
    if (options.dryRun) {
      console.log(`dry run: ${what} would start into ${outDir}`);
      process.exitCode = options.reuse ? 3 : 0;
      return;
    }
  }

  mkdirSync(outDir, { recursive: true });
  const startedAt = new Date();
  console.log(`calibration: ${what}, env ${JSON.stringify(env)}, output ${outDir}`);
  if (!options.reuse && !options.dryRun) console.log(fingerprintLine(start));
  if (fraction < 1) {
    console.log(`quick tier: EVAL_CALIBRATION_FRACTION=${fraction} keeps that share of every tranche and family, the same replays each time; pair the run against a full base with scripts/paired-calibration.mjs`);
  }

  const results = await Promise.all(indices.map(index => runSlice(index, options.slices, outDir, env)));
  const failures = results.filter(result => result.code !== 0 || !existsSync(result.dump));
  const httpSkips = results.reduce((sum, result) => sum + result.httpSkips, 0);
  if (options.sliceRange) {
    console.log('');
    for (const line of sliceLines(results)) console.log(line);
    const record = fingerprintRecord(start, computeFingerprint({ root: ROOT, env: fingerprintEnv, slices: options.slices }));
    writeFileSync(join(outDir, 'job.json'), JSON.stringify(jobRecord({
      commit: commitHash(), startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), slices: options.slices,
      sliceRange: options.sliceRange, env, fraction, results, fingerprint: record,
    }), null, 2) + '\n');
    console.log(`job: ${what} done in ${Math.round((Date.now() - startedAt.getTime()) / 1000)}s; --merge joins it with the other jobs of the run`);
    if (failures.length > 0) {
      console.error(`${failures.length} slice(s) failed or left no dump.`);
      process.exitCode = 1;
    }
    return;
  }
  const present = results.filter(result => existsSync(result.dump));
  const { merged, mergedText, lines } = writeMerged(outDir, present.map(result => result.dump));

  console.log('');
  for (const line of sliceLines(results)) console.log(line);
  console.log(`merged ${merged.length} samples from ${present.length}/${options.slices} slices (${Math.round((Date.now() - startedAt.getTime()) / 1000)}s wall)`);
  for (const line of lines) console.log(line);
  const record = fingerprintRecord(start, computeFingerprint({ root: ROOT, env: fingerprintEnv, slices: options.slices }));
  writeFileSync(join(outDir, 'run.json'), JSON.stringify({
    commit: commitHash(),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    slices: options.slices,
    env,
    samples: merged.length,
    results: results.map(({ index, code, seconds }) => ({ index, code, seconds })),
    fraction,
    complete: failures.length === 0 && merged.length > 0 && httpSkips === 0,
    httpSkips,
    mergedSha256: createHash('sha256').update(mergedText).digest('hex'),
    fingerprint: record,
  }, null, 2) + '\n');
  console.log(recordedLine(record, failures.length, httpSkips));
  if (failures.length > 0) {
    console.error(`${failures.length} slice(s) failed or left no dump; the merged summary above is partial.`);
    process.exitCode = 1;
  }
}

await main();
