import { test, expect, describe } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brierScore, fitConstantK } from './fit-helpers';
import {
  bandLines, bankVerdict, brier, compareSamples, fitConstantK as fitConstantKJs, load, mergeDumps, pairedBands,
  sortSamples, summarize,
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

describe('calibration lib', () => {
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

/**
 * Round 48: a paired verdict carries its error bar. One replay yields up to
 * eight positions with ONE outcome, so the bootstrap resamples replays, not
 * positions, and a row reads as a verdict only when its band clears zero.
 */
describe('paired bands (round 48)', () => {
  interface BankSample extends Sample { quality: 'hq' | 'std'; luckAgainstFavored: boolean }
  interface BandRow {
    view: string; gameType: string; phase: string; n: number; games: number;
    meanBp: number; loBp: number; hiBp: number; seBp: number; pBetter: number; reading: string;
  }

  // 30 replays of four positions: every third replay doubles, every second hq, every fifth luck-flagged.
  const bank = (): BankSample[] => {
    let seed = 11;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const samples: BankSample[] = [];
    for (let game = 0; game < 30; game++) {
      const p1Won = rand() < 0.5;
      (['early', 'mid', 'late', 'late'] as const).forEach((phase, index) => {
        const lean = (p1Won ? 1 : -1) * (0.1 + 0.2 * index);
        samples.push({
          id: `game-${String(game).padStart(2, '0')}`, turn: 3 + 4 * index, phase,
          gameType: game % 3 === 0 ? 'doubles' : 'singles',
          score: Math.max(-0.95, Math.min(0.95, lean + (rand() - 0.5) * 0.8)),
          faintedFraction: index / 4, p1Won,
          quality: game % 2 === 0 ? 'hq' : 'std', luckAgainstFavored: game % 5 === 0,
        });
      });
    }
    return samples;
  };
  const against = (sample: BankSample, by: number): BankSample =>
    ({ ...sample, score: Math.max(-0.99, Math.min(0.99, sample.score + (sample.p1Won ? -by : by))) });
  const rowOf = (rows: BandRow[], view: string, gameType: string, phase: string): BandRow =>
    rows.find(row => row.view === view && row.gameType === gameType && row.phase === phase)!;

  test('a dump against itself reads unmoved on every row, band [0, 0]', () => {
    const result = pairedBands(bank(), bank());
    expect(result.joined).toBe(120);
    expect(result.rows.map((row: BandRow) => row.view)).toEqual(expect.arrayContaining(['full', 'hq', 'luck-adjusted']));
    for (const row of result.rows as BandRow[]) {
      expect(Math.abs(row.meanBp) + Math.abs(row.loBp) + Math.abs(row.hiBp)).toBe(0);
      expect(row.reading).toBe('unmoved');
    }
    const lines = bandLines(result);
    expect(lines[0]).toContain('joined n=120');
    expect(lines[1]).toBe(' full:');
    // Pooled rows come first: all phases, then per game type.
    expect(lines[2]).toBe('   all      all       +0 [+0, +0]  se 0  n=120/30g  P(B better)=0%  unmoved');
    expect(lines[3].startsWith('   singles  all ')).toBe(true);
    expect(lines.at(-1)).toBe('bank verdict: no gain resolved; no harm; no warnings');
  });

  test('a constructed offset lies inside its band, under the fixed K of the A side', () => {
    const a = bank();
    const b = a.map(sample => against(sample, 0.3));
    const result = pairedBands(a, b);
    const outcomes = (samples: BankSample[]) => samples.map(sample => ({ score: sample.score, won: sample.p1Won }));
    expect(result.k).toBe(fitConstantKJs(outcomes(a)));
    const pooled = rowOf(result.rows, 'full', 'all', 'all');
    expect(pooled.meanBp).toBeCloseTo((brier(outcomes(b), result.k) - brier(outcomes(a), result.k)) * 10000, 6);
    expect(pooled.loBp).toBeLessThanOrEqual(pooled.meanBp);
    expect(pooled.hiBp).toBeGreaterThanOrEqual(pooled.meanBp);
    expect(pooled.loBp).toBeGreaterThan(0);
    expect(pooled.reading).toBe('B worse');
    expect(pooled.pBetter).toBe(0);
    const verdict = bankVerdict(result);
    expect(verdict.gain).toHaveLength(0);
    expect(verdict.harm.map((row: BandRow) => `${row.view} ${row.gameType}`)).toContain('full singles');
    // The mirror image reads as a gain.
    const mirrored = pairedBands(b, a);
    expect(rowOf(mirrored.rows, 'full', 'all', 'all').reading).toBe('B better');
    expect(bankVerdict(mirrored).gain.length).toBeGreaterThan(0);
    expect(bandLines(mirrored).at(-1)).toContain('bank verdict: gain on full all');
  });

  test('one replay moving all of its positions is no verdict: the band resamples replays', () => {
    const a = bank();
    const b = a.map(sample => (sample.id === 'game-05' ? against(sample, 0.6) : sample));
    const result = pairedBands(a, b);
    const pooled = rowOf(result.rows, 'full', 'all', 'all');
    expect([pooled.n, pooled.games]).toEqual([120, 30]);
    expect(pooled.meanBp).toBeGreaterThan(0);
    // A third of the draws leave the one moved replay out, so the low end stays at zero.
    expect(pooled.loBp).toBe(0);
    expect(pooled.reading).toBe('unresolved');
    expect([rowOf(result.rows, 'full', 'singles', 'all').games, rowOf(result.rows, 'full', 'doubles', 'all').games]).toEqual([20, 10]);
    expect(rowOf(result.rows, 'hq', 'all', 'all').games).toBe(15);
    expect(rowOf(result.rows, 'luck-adjusted', 'all', 'all').games).toBe(24);
    expect(rowOf(result.rows, 'full', 'doubles', 'all').reading).toBe('unmoved');
  });

  // Round 49: a fix that moved 38 of 833 positions read +1 bp [+0, +2], resolved and irrelevant.
  test('harm and warnings need size: a resolved shift under 5 bp is a note', () => {
    const a = bank();
    const small = pairedBands(a, a.map(sample => against(sample, 0.0001)));
    const pooled = rowOf(small.rows, 'full', 'all', 'all');
    expect(pooled.reading).toBe('B worse');
    expect(pooled.meanBp).toBeLessThan(5);
    const verdict = bankVerdict(small);
    expect([verdict.harm.length, verdict.warnings.length]).toEqual([0, 0]);
    expect(verdict.notes.map((row: BandRow) => `${row.view} ${row.gameType} ${row.phase}`)).toContain('full all all');
    const line = bandLines(small).at(-1);
    expect(line).toContain('no harm');
    expect(line).toContain('resolved under 5 bp: full all (+');
    // The offset of the earlier test is far above the floor and stays harm.
    expect(bankVerdict(pairedBands(a, a.map(sample => against(sample, 0.3)))).notes).toHaveLength(0);
  });

  test('the seed fixes the draws', () => {
    let seed = 5;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const a = bank();
    const b = a.map(sample => ({ ...sample, score: Math.max(-0.99, Math.min(0.99, sample.score + (rand() - 0.5) * 0.4)) }));
    const first = pairedBands(a, b, { seed: 7 });
    expect(pairedBands(a, b, { seed: 7 })).toEqual(first);
    const other = rowOf(pairedBands(a, b, { seed: 8 }).rows, 'full', 'all', 'all');
    const same = rowOf(first.rows, 'full', 'all', 'all');
    expect(other.meanBp).toBe(same.meanBp);
    expect([other.loBp, other.hiBp]).not.toEqual([same.loBp, same.hiBp]);
  });
});
