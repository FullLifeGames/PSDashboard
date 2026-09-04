import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brierScore, fitConstantK } from './fit-helpers';
import {
  brier, compareSamples, fitConstantK as fitConstantKJs, load, mergeDumps, sortSamples, summarize,
} from '../scripts/calibration-lib.mjs';

/**
 * scripts/calibration-lib.mjs feeds the slice runner (run-calibration.mjs)
 * and the paired script: its summary must read exactly like the harness's
 * own printout (regression/eval-calibration.spec.ts), and its fit must be
 * the fit-helpers.ts fit to the last bit, or a merged slice run stops being
 * comparable with a single-process run.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/calibration-summary-fixture.jsonl', import.meta.url));

interface Sample {
  id: string;
  turn: number;
  phase: 'early' | 'mid' | 'late';
  gameType: 'singles' | 'doubles';
  score: number;
  faintedFraction: number;
  p1Won: boolean;
}

const SORTED_ORDER = [
  'gen9ou-1#4', 'gen9ou-1#7', 'gen9ou-1#11', 'gen9ou-2#3', 'gen9ou-2#9', 'gen9ou-2#14',
  'gen9vgc-1#2', 'gen9vgc-1#5', 'gen9vgc-1#9', 'gen9vgc-2#3', 'gen9vgc-2#6', 'gen9vgc-2#10',
];

test.describe('calibration lib', () => {
  test('summarize prints the harness aggregate, line for line (counts checked by hand)', () => {
    const samples = sortSamples(load(FIXTURE) as Sample[]);
    expect(samples).toHaveLength(12);
    // Sign accuracy by hand: early 2/4, mid 3/4, late 4/4; singles 6/6, doubles 3/6;
    // |score| buckets 2/3, 2/2, 2/4, 3/3.
    expect(summarize(samples)).toEqual([
      'early: n=4 sign-accuracy=50% mean|score|=0.24',
      'mid: n=4 sign-accuracy=75% mean|score|=0.31',
      'late: n=4 sign-accuracy=100% mean|score|=0.81',
      'singles: n=6 sign-accuracy=100%',
      'doubles: n=6 sign-accuracy=50%',
      'winprob K: pooled=2.26 singles=11.45 doubles=0.77',
      'early brier=0.3017',
      'mid brier=0.2527',
      'late brier=0.0213',
      'luck-adjusted: n=12 excluded=0 brier early/mid/late=0.3017/0.2527/0.0213',
      '|score| 0.0–0.2: n=3 favored-side-wins=67%',
      '|score| 0.2–0.4: n=2 favored-side-wins=100%',
      '|score| 0.4–0.7: n=4 favored-side-wins=50%',
      '|score| 0.7–1.0: n=3 favored-side-wins=100%',
    ]);
  });

  test('the fit and the Brier are the fit-helpers.ts numbers to the last bit', () => {
    const samples = sortSamples(load(FIXTURE) as Sample[]);
    const outcomes = samples.map(sample => ({ score: sample.score, faintedFraction: sample.faintedFraction, won: sample.p1Won }));
    const k = fitConstantK(outcomes);
    expect(fitConstantKJs(outcomes)).toBe(k);
    for (const phase of ['early', 'mid', 'late'] as const) {
      const subset = outcomes.filter((_, index) => samples[index].phase === phase);
      expect(brier(subset, k)).toBe(brierScore(subset, k));
    }
  });

  test('samples order by replay id in code units, then turn, and merged slices land in that order', () => {
    const samples = load(FIXTURE) as Sample[];
    expect(sortSamples(samples).map(sample => `${sample.id}#${sample.turn}`)).toEqual(SORTED_ORDER);
    // Code units, not locale collation: the hyphen sorts before every digit.
    expect(compareSamples({ id: 'a-1', turn: 1 }, { id: 'a1', turn: 1 })).toBeLessThan(0);
    expect(compareSamples({ id: 'x', turn: 12 }, { id: 'x', turn: 3 })).toBeGreaterThan(0);

    const dir = mkdtempSync(join(tmpdir(), 'calibration-lib-'));
    const slices = [0, 1, 2].map(slice => {
      const path = join(dir, `slice-${slice}.jsonl`);
      writeFileSync(path, samples.filter((_, index) => index % 3 === slice).map(sample => JSON.stringify(sample)).join('\n') + '\n');
      return path;
    });
    expect(mergeDumps(slices).map(sample => `${sample.id}#${sample.turn}`)).toEqual(SORTED_ORDER);
    expect(mergeDumps(slices)).toEqual(sortSamples(samples));
  });
});
