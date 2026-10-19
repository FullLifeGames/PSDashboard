import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BANK_TRANCHES, FIT_TRANCHES, holdoutTranches, jobArgs, mergeArgs, validateRunConfig,
} from '../scripts/bank-run-config.mjs';

/**
 * Round 71 (bank in GitHub Actions): .bank-run.json is untrusted input to the bank workflow. scripts/bank-run-config.mjs
 * validates it against an allowlist and builds the runner's argument vector itself, so no value of the file reaches a
 * shell line; these specs pin the allowlist and the job split.
 */

const TRANCHES = [...BANK_TRANCHES, ...holdoutTranches(), ...FIT_TRANCHES];
const valid = (raw: unknown) => validateRunConfig(raw, TRANCHES);
const refused = (raw: unknown) => {
  try {
    valid(raw);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected a refusal');
};

describe('the allowlist of .bank-run.json', () => {
  test('a holdout run reads with its defaults: 16 jobs of 4 slices', () => {
    expect(valid({ name: 'r71-hold-vgc', env: { EVAL_CALIBRATION_SOURCE: 'holdout', EVAL_CALIBRATION_TRANCHE: 'holdout-vgc' } })).toEqual({
      name: 'r71-hold-vgc', jobs: 16, slicesPerJob: 4, slices: 64,
      env: { EVAL_CALIBRATION_SOURCE: 'holdout', EVAL_CALIBRATION_TRANCHE: 'holdout-vgc' },
    });
    expect(valid({ name: 'bank', jobs: 2, slicesPerJob: 1 })).toMatchObject({ slices: 2, env: {} });
  });

  test.each([
    [{ name: 'Bank' }, /name must be/],
    [{ name: 'a'.repeat(41) }, /name must be/],
    [{ name: 'bank; rm -rf /' }, /name must be/],
    [{ name: 'bank', jobs: 17 }, /jobs must be/],
    [{ name: 'bank', jobs: 1.5 }, /jobs must be/],
    [{ name: 'bank', slicesPerJob: 5 }, /slicesPerJob must be/],
    [{ name: 'bank', extra: true }, /unknown key "extra"/],
    [{ name: 'bank', env: { NODE_OPTIONS: '--require=evil' } }, /not an EVAL_CALIBRATION_\* lever/],
    [{ name: 'bank', env: { EVAL_CALIBRATION_DUMP: 'x' } }, /set by the runner or writes files/],
    [{ name: 'bank', env: { EVAL_CALIBRATION_POSITIONS: '/tmp/x' } }, /set by the runner or writes files/],
    [{ name: 'bank', env: { EVAL_CALIBRATION_MODE: 'auto && curl evil' } }, /env value of EVAL_CALIBRATION_MODE/],
    [{ name: 'bank', env: { EVAL_CALIBRATION_MODE: '$(id)' } }, /env value of EVAL_CALIBRATION_MODE/],
    [{ name: 'bank', env: { EVAL_CALIBRATION_MODE: 'fast' } }, /unknown mode fast/],
    [{ name: 'bank', env: { EVAL_CALIBRATION_TRANCHE: 'holdout-xyz' } }, /unknown tranche holdout-xyz/],
    [{ name: 'bank', env: { EVAL_CALIBRATION_SOURCE: 'holdouts' } }, /unknown source holdouts/],
    [{ name: 'bank', env: { EVAL_CALIBRATION_FRACTION: '2' } }, /EVAL_CALIBRATION_FRACTION must be/],
    [{ name: 'bank', env: { EVAL_CALIBRATION_DEPTH: 2 } }, /env value of EVAL_CALIBRATION_DEPTH/],
    [{ name: 'bank', env: [] }, /env must be an object/],
  ])('refuses %j', (raw, reason) => {
    expect(refused(raw)).toMatch(reason);
  });

  test('every problem is named at once', () => {
    const message = refused({ name: 'X', jobs: 0, env: { EVAL_CALIBRATION_TRANCHE: 'nope' } });
    expect(message).toMatch(/name must be.*jobs must be.*unknown tranche nope/);
  });

  test('the bank tranches are those of the calibration harness, and every holdout family has its tranche', () => {
    const harness = readFileSync(fileURLToPath(new URL('./eval-calibration.spec.ts', import.meta.url)), 'utf8');
    const declared = [...harness.matchAll(/^\s+tranche: '([^']+)',$/gm)].map(match => match[1]).sort();
    expect([...BANK_TRANCHES].sort()).toEqual(declared);
    expect(holdoutTranches()).toEqual(['holdout-championsou', 'holdout-championsvgc', 'holdout-doublesou', 'holdout-vgc']);
  });
});

describe('the split of a run into jobs', () => {
  const config = valid({ name: 'r71-bank', jobs: 3, slicesPerJob: 4, env: { EVAL_CALIBRATION_FRACTION: '0.25' } });

  test('job k runs its own block of slices into its own folder, with the run\'s env', () => {
    expect(jobArgs(config, 0)).toEqual(['--slices', '12', '--slice-range', '0..3', '--out', '.calibration/job-0', '--env', 'EVAL_CALIBRATION_FRACTION=0.25']);
    expect(jobArgs(config, 2)).toEqual(['--slices', '12', '--slice-range', '8..11', '--out', '.calibration/job-2', '--env', 'EVAL_CALIBRATION_FRACTION=0.25']);
    expect(() => jobArgs(config, 3)).toThrow(/outside 0 to 2/);
    expect(() => jobArgs(config, Number('1; ls'))).toThrow(/outside/);
  });

  test('the merge takes every job folder and writes the run under its name', () => {
    expect(mergeArgs(config, 'jobs', ['job-0', 'job-1', 'job-2'])).toEqual([
      '--merge', expect.stringMatching(/jobs[\\/]job-0$/), '--merge', expect.stringMatching(/jobs[\\/]job-1$/), '--merge', expect.stringMatching(/jobs[\\/]job-2$/),
      '--out', '.calibration/r71-bank',
    ]);
  });
});
