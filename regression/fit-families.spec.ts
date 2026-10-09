import { describe, expect, test } from 'vitest';
import { dumpSamples, familyOf, familyReports, rulesetOfId, withoutHoldout, type FamilySample } from './fit-families';
import { mulberry32 } from './fit-helpers';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Round 65: the refit per family (rule set × game type), on samples read from
 * calibration-bank dumps (the corpus measured like the app), without the
 * holdout, clustered by set.
 */

const K = { singles: { k0: 2.28, k1: 1.49 }, doubles: { k0: 2.98, k1: 0.88 } };
const leaf = (tanh: number, doubles: boolean, ff: number) => {
  const k = doubles ? K.doubles : K.singles;
  return 2 / (1 + Math.exp(-(k.k0 + k.k1 * ff) * tanh)) - 1;
};

/** A synthetic family: outcomes drawn from the true weights over two features, scores captured under the start weights [2, 2], one game per set. */
function synthetic(prefix: string, gameType: 'singles' | 'doubles', truth: number[], games: number, seed: number): FamilySample[] {
  const random = mulberry32(seed);
  const out: FamilySample[] = [];
  for (let game = 0; game < games; game++) {
    for (let turn = 0; turn < 4; turn++) {
      const g = [random() - 0.5, random() - 0.5];
      const z = Math.tanh(truth[0] * g[0] + truth[1] * g[1]);
      const p = (leaf(z, gameType === 'doubles', 0) + 1) / 2;
      out.push({
        game: `${prefix}-${game}`, set: `${prefix}-${game}`, gameType, ruleset: rulesetOfId(prefix), g,
        p1Won: random() < p, faintedFraction: 0, score: leaf(Math.tanh(2 * g[0] + 2 * g[1]), gameType === 'doubles', 0), wp: true, lastPair: false,
      });
    }
  }
  return out;
}

describe('fit families', () => {
  test('the rule set comes from the game id, the family from rule set and game type', () => {
    expect(rulesetOfId('gen9championsvgc2026regmabo3-1')).toBe('champions');
    expect(rulesetOfId('gen9championsou-2')).toBe('champions');
    expect(rulesetOfId('smogtours-gen9doublesou-3')).toBe('standard');
    expect(rulesetOfId('gen9vgc2024regh-4')).toBe('vgc');
    expect(familyOf({ ruleset: 'vgc', gameType: 'doubles' })).toBe('vgc-doubles');
    expect(familyOf({ ruleset: 'champions', gameType: 'singles' })).toBe('champions-singles');
    expect(familyOf({ ruleset: 'standard', gameType: 'doubles' })).toBe('standard-doubles');
  });

  test('the holdout leaves the fit whole sets at a time', () => {
    const samples = [{ game: 'a' }, { game: 'b' }, { game: 'c' }, { game: 'b' }];
    const { kept, dropped } = withoutHoldout(samples, new Set(['b']));
    expect(kept.map(sample => sample.game)).toEqual(['a', 'c']);
    expect(dropped).toBe(2);
  });

  test('bank dump rows become samples with their rule set and set key; rows without g stay out', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fit-families-'));
    const dump = join(dir, 'merged.jsonl');
    const row = (id: string, gameType: string, g?: number[]) => JSON.stringify({
      id, turn: 2, tranche: 'fit-ladder', phase: 'early', gameType, score: 0.1, faintedFraction: 0, p1Won: true, lastPair: false, ...(g ? { g } : {}),
    });
    writeFileSync(dump, [row('gen9championsou-1', 'singles', [1, 2]), row('gen9doublesou-2', 'doubles', [3, 4]), row('gen9ou-3', 'singles')].join('\n') + '\n');
    const samples = dumpSamples([dump], id => (id === 'gen9championsou-1' ? ['Alice', 'bob'] : ['carol', 'Dave']));
    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({ game: 'gen9championsou-1', ruleset: 'champions', gameType: 'singles', set: 'champions-singles|alice|bob', wp: true, source: 'ladder' });
    expect(samples[1]).toMatchObject({ ruleset: 'standard', gameType: 'doubles', set: 'standard-doubles|carol|dave' });
  });

  test('each family refits on its own games with the pre-registered holds, and the identity check guards the capture', () => {
    const samples = [
      ...synthetic('gen9ou', 'singles', [3, 1], 220, 1),
      ...synthetic('gen9doublesou', 'doubles', [1, 3], 220, 2),
    ];
    const names = ['bodies', 'matchup'];
    const families = [
      { name: 'standard-singles', singles: [2, 2], doubles: [2, 2] },
      { name: 'standard-doubles', singles: [2, 2], doubles: [2, 2] },
      { name: 'champions-singles', singles: [2, 2], doubles: [2, 2] },
    ];
    const reports = familyReports(samples, names, families, K, { seeds: 2, folds: 5, draws: 4, minGames: 20, hold: { shared: ['bodies'] } }, leaf);
    expect(reports.identity.off).toBe(0);
    expect(reports.families['champions-singles']).toMatchObject({ skipped: 'no games' });
    const singles = reports.families['standard-singles'];
    const doubles = reports.families['standard-doubles'];
    if (!('proposed' in singles) || !('proposed' in doubles)) throw new Error('missing reports');
    expect(singles.proposed.singles.bodies).toBe(2);
    expect(doubles.proposed.doubles.bodies).toBe(2);
    expect(singles.proposed.singles.matchup).toBeLessThan(doubles.proposed.doubles.matchup);
    expect(singles.games).toBe(220);
    // A score that the start weights do not give back stops the report.
    expect(() => familyReports([{ ...samples[0], score: 0.9 }, ...samples.slice(1)], names, families, K,
      { seeds: 2, folds: 5, draws: 4, minGames: 20 }, leaf)).toThrow(/identity/);
  });

  // Rule R2 of round 65: a weight the first pass flags (a flipped sign, a band wider than twice its value) is held, and the family refits once.
  test('a flagged weight is held in a second pass, which the report gives beside the first', () => {
    // The truth runs the second feature against its start sign: the first pass flips it and flags it.
    const samples = synthetic('gen9ou', 'singles', [3, -1.5], 260, 7);
    const names = ['bodies', 'matchup'];
    const families = [{ name: 'standard-singles', singles: [2, 2], doubles: [2, 2] }];
    const reports = familyReports(samples, names, families, K, { seeds: 2, folds: 5, draws: 6, minGames: 20 }, leaf);
    const entry = reports.families['standard-singles'];
    if (!('first' in entry)) throw new Error('no second pass');
    expect(entry.first.verdict.flagged).toContain('shared:matchup');
    expect(entry.weights.find(weight => weight.name === 'matchup')).toMatchObject({ free: false, fit: 2 });
    expect(entry.secondPassHeld).toEqual(['shared:matchup']);
  });
});
