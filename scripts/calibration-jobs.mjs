// CI jobs of a calibration run (round 71, bank in GitHub Actions).
//
// A run of N slices splits into jobs: each job runs a range of the slices (run-calibration.mjs --slice-range a..b
// --slices N) and leaves its slice dumps with a job.json (no run.json, so --reuse never mistakes a job for a run).
// --merge checks that a set of job folders makes one complete run (same slice count, env, fraction, commit and
// fingerprint; every slice exactly once) and writes a run folder that reads like a local run: merged.jsonl,
// summary.txt and a run.json in the shape run-calibration.mjs writes. Slices are independent (one replay belongs to
// exactly one slice), so the merged rows equal a run of all slices in one process.
import { canonicalJson } from './calibration-fingerprint.mjs';

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The range "a..b" of --slice-range as [a, b] with 0 <= a <= b < slices; throws with the reason otherwise. */
export function parseSliceRange(raw, slices) {
  const match = /^(\d+)\.\.(\d+)$/.exec(String(raw ?? '').trim());
  if (!match) throw new Error(`--slice-range expects a..b (the first and the last slice index), got "${raw}"`);
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (first > last) throw new Error(`--slice-range ${raw} runs backwards`);
  if (last >= slices) throw new Error(`--slice-range ${raw} reaches past slice ${slices - 1}, the last of --slices ${slices}`);
  return [first, last];
}

/** The slice indices of a range, in order. */
export function sliceIndices([first, last]) {
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

/** The job.json of a job: the run's identity (slices, env, fraction, commit, fingerprint) and its own slices. */
export function jobRecord({ commit, startedAt, finishedAt, slices, sliceRange, env, fraction, results, fingerprint }) {
  return {
    kind: 'job',
    commit,
    startedAt,
    finishedAt,
    slices,
    sliceRange,
    env,
    fraction,
    results: results.map(({ index, code, seconds, httpSkips }) => ({ index, code, seconds, httpSkips })),
    fingerprint,
  };
}

const RUN_IDENTITY = [
  ['slice count', job => job.slices],
  ['env', job => job.env],
  ['fraction', job => job.fraction],
  ['commit', job => job.commit],
  ['fingerprint', job => job.fingerprint?.value ?? null],
];

/**
 * Checks that `jobs` ([{ name, job }], job = a parsed job.json) make one complete run and returns its slice count.
 * Throws with the problems found: a folder without a job's record, jobs of different runs, a slice twice, a slice
 * missing.
 */
export function checkJobs(jobs) {
  if (jobs.length === 0) throw new Error('--merge needs at least one job folder');
  const foreign = jobs.filter(({ job }) => job?.kind !== 'job' || !Array.isArray(job.sliceRange)).map(({ name }) => name);
  if (foreign.length > 0) throw new Error(`no job.json of a CI job in ${foreign.join(', ')}`);
  const [first] = jobs;
  const differs = RUN_IDENTITY
    .filter(([, of]) => jobs.some(({ job }) => canonicalJson(of(job)) !== canonicalJson(of(first.job))))
    .map(([label]) => label);
  if (differs.length > 0) throw new Error(`the jobs belong to different runs (they differ in ${differs.join(', ')})`);
  if (typeof first.job.fingerprint?.value !== 'string') throw new Error('the jobs carry no fingerprint, so the run could never serve as a base');
  const { slices } = first.job;
  const problems = [];
  const owner = new Map();
  for (const { name, job } of jobs) {
    for (const index of sliceIndices(job.sliceRange)) {
      if (owner.has(index)) problems.push(`slice ${index} twice (${owner.get(index)} and ${name})`);
      else owner.set(index, name);
    }
  }
  const missing = Array.from({ length: slices }, (_, index) => index).filter(index => !owner.has(index));
  if (missing.length > 0) problems.push(`${missing.length === 1 ? 'slice' : 'slices'} ${missing.join(', ')} missing`);
  if (problems.length > 0) throw new Error(problems.join('; '));
  return slices;
}

/**
 * The run.json of the merged run, in the shape of a local run's, and the count of slices that failed or left no
 * dump. `present` holds the indices whose dump the merge found; a failed slice keeps the run incomplete, as in a
 * local run.
 */
export function mergedRunRecord(jobs, { samples, mergedSha256, finishedAt, present }) {
  const first = jobs[0].job;
  const results = jobs.flatMap(({ job }) => job.results).sort((a, b) => a.index - b.index);
  const httpSkips = results.reduce((sum, result) => sum + (result.httpSkips ?? 0), 0);
  const failures = results.filter(result => result.code !== 0 || !present.has(result.index)).length;
  const fingerprints = jobs.map(({ job }) => job.fingerprint);
  const record = {
    commit: first.commit,
    startedAt: jobs.map(({ job }) => job.startedAt).sort(byCode)[0],
    finishedAt,
    slices: first.slices,
    env: first.env,
    samples,
    results: results.map(({ index, code, seconds }) => ({ index, code, seconds })),
    fraction: first.fraction,
    complete: failures === 0 && samples > 0 && httpSkips === 0,
    httpSkips,
    mergedSha256,
    fingerprint: {
      ...first.fingerprint,
      dirty: fingerprints.some(fingerprint => fingerprint.dirty !== false),
      stable: fingerprints.every(fingerprint => fingerprint.stable === true),
      dirtyPaths: [...new Set(fingerprints.flatMap(fingerprint => fingerprint.dirtyPaths ?? []))].sort(byCode),
    },
    mergedFrom: jobs.map(({ name }) => name),
  };
  return { record, failures };
}
