import { describe, expect, test } from 'vitest';
import {
  dumpSamples, familyOf, familyReports, liftHolds, parseKTable, parseModelForms, parseWeightSet, phaseKReports, rootScaleReports, rulesetOfId, withModelForms, withoutHoldout, withoutUnratedLadder,
  type FamilySample,
} from './fit-families';
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

  test('round 66: ladder games without a rating leave the fit, tournament games and rated ladder games stay', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fit-families-'));
    const dump = join(dir, 'merged.jsonl');
    const row = (id: string, tranche: string, rating: number | null) => JSON.stringify({
      id, turn: 2, tranche, phase: 'early', gameType: 'doubles', score: 0.1, faintedFraction: 0, p1Won: true, lastPair: false, rating, g: [1, 2],
    });
    writeFileSync(dump, [
      row('gen9championsvgc2026regmbbo3-1', 'fit-ladder', null), row('gen9championsvgc2026regmbbo3-2', 'fit-ladder', 0),
      row('gen9championsvgc2026regmc-3', 'fit-ladder', 1650), row('gen9championsvgc2026regmabo3-4', 'fit-tournament', null),
    ].join('\n') + '\n');
    const samples = dumpSamples([dump], () => ['a', 'b']);
    expect(samples.map(sample => sample.rating)).toEqual([null, 0, 1650, null]);
    const { kept, dropped } = withoutUnratedLadder(samples);
    expect(kept.map(sample => sample.game)).toEqual(['gen9championsvgc2026regmc-3', 'gen9championsvgc2026regmabo3-4']);
    expect(dropped).toBe(2);
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
    const reports = familyReports(samples, names, families, () => K, { seeds: 2, folds: 5, draws: 4, minGames: 20, hold: { shared: ['bodies'] } }, leaf);
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
    expect(() => familyReports([{ ...samples[0], score: 0.9 }, ...samples.slice(1)], names, families, () => K,
      { seeds: 2, folds: 5, draws: 4, minGames: 20 }, leaf)).toThrow(/identity/);
  });

  // Rule R2 of round 65: a weight the first pass flags (a flipped sign, a band wider than twice its value) is held, and the family refits once.
  test('a flagged weight is held in a second pass, which the report gives beside the first', () => {
    // The truth runs the second feature against its start sign: the first pass flips it and flags it.
    const samples = synthetic('gen9ou', 'singles', [3, -1.5], 260, 7);
    const names = ['bodies', 'matchup'];
    const families = [{ name: 'standard-singles', singles: [2, 2], doubles: [2, 2] }];
    const reports = familyReports(samples, names, families, () => K, { seeds: 2, folds: 5, draws: 6, minGames: 20 }, leaf);
    const entry = reports.families['standard-singles'];
    if (!('first' in entry)) throw new Error('no second pass');
    expect(entry.first.verdict.flagged).toContain('shared:matchup');
    expect(entry.weights.find(weight => weight.name === 'matchup')).toMatchObject({ free: false, fit: 2 });
    expect(entry.secondPassHeld).toEqual(['shared:matchup']);
  });

  // Round 67 (T138): once Champions prices its own scale, a Champions capture holds leaf values under the Champions K:
  // the identity check and the refit read the K of each family's rule set.
  test('round 67 (T138): the identity and the refit read the K of each family\'s rule set', () => {
    const championsK = { singles: { k0: 1.6, k1: 4.4 }, doubles: { k0: 1.9, k1: 4.2 } };
    const kOf = (ruleset: string) => (ruleset === 'champions' ? championsK : K);
    const leafOf = (tanh: number, doubles: boolean, ff: number, ruleset: string) => {
      const k = doubles ? kOf(ruleset).doubles : kOf(ruleset).singles;
      return 2 / (1 + Math.exp(-(k.k0 + k.k1 * ff) * tanh)) - 1;
    };
    const captured = (sample: FamilySample) => ({ ...sample, score: leafOf(Math.tanh(2 * sample.g[0] + 2 * sample.g[1]), false, 0, sample.ruleset) });
    const samples = [...synthetic('gen9ou', 'singles', [3, 1], 220, 3), ...synthetic('gen9championsou', 'singles', [3, 1], 220, 4)].map(captured);
    const names = ['bodies', 'matchup'];
    const families = [{ name: 'standard-singles', singles: [2, 2], doubles: [2, 2] }, { name: 'champions-singles', singles: [2, 2], doubles: [2, 2] }];
    const options = { seeds: 2, folds: 5, draws: 4, minGames: 20 };
    expect(familyReports(samples, names, families, kOf, options, leafOf).identity).toEqual({ samples: samples.length, off: 0 });
    // One K for every family cannot give the Champions capture back.
    expect(() => familyReports(samples, names, families, () => K, options, leaf)).toThrow(/identity/);
  });

  // Round 69 (T102): a capture is made under the tables of its day; a weight adopted since moves the start tables, and
  // `captured` names the capture-time weights the identity check starts from (the fit and its baseline stay at today's tables).
  test('round 69 (T102): the identity starts from the capture-time weights when a table has moved since', () => {
    const samples = synthetic('gen9ou', 'singles', [3, 1], 220, 3);
    const names = ['bodies', 'matchup'];
    const moved = [{ name: 'standard-singles', singles: [3, 2], doubles: [3, 2] }];
    const options = { seeds: 2, folds: 5, draws: 4, minGames: 20 };
    expect(() => familyReports(samples, names, moved, () => K, options, leaf)).toThrow(/identity/);
    expect(() => familyReports(samples, names, moved, () => K, { ...options, captured: { bodies: 2, matchup: 2 } }, leaf)).not.toThrow();
    // A capture-time weight that is wrong still stops the fit.
    expect(() => familyReports(samples, names, moved, () => K, { ...options, captured: { bodies: 2, matchup: 5 } }, leaf)).toThrow(/identity/);
    // The report's baseline is today's table, not the captured one.
    const report = familyReports(samples, names, moved, () => K, { ...options, captured: { bodies: 2, matchup: 2 } }, leaf).families['standard-singles'];
    if (!('weights' in report)) throw new Error('no report');
    expect(report.weights.find(weight => weight.name === 'bodies')?.hand).toBe(3);
  });

  // Round 67 (T138): Pokémon Champions prices its own scale. The phase K of a family comes back from its own games:
  // the static's tanh under the family's tables, outcomes against k0 + k1 × the fainted share.
  test('round 67 (T138): the phase K of a family comes back from its own games', () => {
    const random = mulberry32(67);
    const truth = (ff: number) => 1 + 4 * ff;
    const samples: FamilySample[] = [];
    for (let game = 0; game < 700; game++) {
      for (const ff of [0, 1 / 3, 2 / 3]) {
        const g = [random() - 0.5, random() - 0.5];
        const z = Math.tanh(2 * g[0] + 2 * g[1]);
        samples.push({
          game: `gen9championsou-${game}`, set: `champions-singles|${game}`, gameType: 'singles', ruleset: 'champions', g,
          p1Won: random() < 1 / (1 + Math.exp(-truth(ff) * z)), faintedFraction: ff, score: 0, wp: true, lastPair: false,
        });
      }
    }
    // The bank prices the last pair by its race: those positions never meet the leaf K.
    const lastPairs = samples.slice(0, 50).map(sample => ({ ...sample, game: `${sample.game}-last`, p1Won: !sample.p1Won, lastPair: true }));
    const families = [{ name: 'champions-singles', singles: [2, 2], doubles: [2, 2] }, { name: 'champions-doubles', singles: [2, 2], doubles: [2, 2] }];
    const reports = phaseKReports([...samples, ...lastPairs], families, () => K, 20);
    expect(reports['champions-doubles']).toMatchObject({ skipped: expect.stringMatching(/^0 samples/) });
    const report = reports['champions-singles'];
    if (!('fitted' in report)) throw new Error('no report');
    expect(report.n).toBe(samples.length);
    expect(report.today).toEqual(K.singles);
    expect(Math.abs(report.fitted.k0 - 1)).toBeLessThan(0.6);
    expect(Math.abs(report.fitted.k1 - 4)).toBeLessThan(1.5);
    expect(report.buckets.late.brierFitted).toBeLessThan(report.buckets.late.brierToday);
    expect(report.spread.k1.lo).toBeLessThan(report.fitted.k1);
  });
  // Round 69 (T102, decision 17; T49 and T42 share the tool): a column at 0 in both tables is held, and a fit frees it by name.
  describe('round 69: new columns, lifted holds and model-form columns', () => {
    /** Outcomes from weights that run with the fainted share: the first feature weighs w0 + w0Phase x ff. Scores are captured under the start weights [2, 2]. */
    function phased(prefix: string, gameType: 'singles' | 'doubles', w0: number, w0Phase: number, games: number, seed: number, root = false): FamilySample[] {
      const random = mulberry32(seed);
      const out: FamilySample[] = [];
      for (let game = 0; game < games; game++) {
        for (let turn = 0; turn < 4; turn++) {
          const g = [random() - 0.5, random() - 0.5];
          const ff = random();
          const first = root ? Math.sign(g[0]) * Math.sqrt(Math.abs(g[0])) : g[0];
          const z = Math.tanh((w0 + w0Phase * ff) * first + 2 * g[1]);
          const doubles = gameType === 'doubles';
          out.push({
            game: `${prefix}-${game}`, set: `${prefix}-${game}`, gameType, ruleset: rulesetOfId(prefix), g,
            p1Won: random() < (leaf(z, doubles, ff) + 1) / 2, faintedFraction: ff, score: leaf(Math.tanh(2 * g[0] + 2 * g[1]), doubles, ff), wp: true, lastPair: false,
          });
        }
      }
      return out;
    }
    const names = ['bodies', 'matchup'];
    const tables = (name: string) => [{ name, singles: [2, 2], doubles: [2, 2] }];
    const options = { seeds: 3, folds: 5, draws: 6, minGames: 20 };
    const report = (samples: FamilySample[], family: string, columns: string[], tabled: ReturnType<typeof tables>, extra: object) => {
      const entry = familyReports(samples, columns, tabled, () => K, { ...options, ...extra }, leaf).families[family];
      if (!('proposed' in entry)) throw new Error('missing report');
      return entry;
    };

    test.each([['singles', 'gen9ou', 'standard-singles'], ['doubles', 'gen9doublesou', 'standard-doubles']] as const)(
      'a model-form column is held at 0 until its hold is lifted, and then the fit recovers the phase interaction (%s)', (gameType, prefix, family) => {
        const samples = phased(prefix, gameType, 1, 5, 320, 11);
        const forms = parseModelForms('phase:bodies');
        expect(forms).toEqual([{ kind: 'phase', key: 'bodies' }]);
        const formed = withModelForms(samples, names, tables(family), forms);
        expect(formed.names).toEqual(['bodies', 'matchup', 'bodies@phase']);
        expect(formed.families[0]).toMatchObject({ singles: [2, 2, 0], doubles: [2, 2, 0] });
        expect(formed.samples[0].g[2]).toBeCloseTo(samples[0].g[0] * samples[0].faintedFraction, 12);
        // The identity check still holds: the derived column weighs 0 in the start tables.
        const held = report(formed.samples, family, formed.names, formed.families, {});
        expect(held.weights.find(weight => weight.name === 'bodies@phase')).toMatchObject({ free: false, fit: 0 });
        // Lifted, with the rest of the table at the hand weights: the phase part comes back.
        const lifted = report(formed.samples, family, formed.names, formed.families, { only: ['bodies', '*@phase'] });
        const side = gameType === 'doubles' ? lifted.proposed.doubles : lifted.proposed.singles;
        expect(side.matchup).toBe(2);
        expect(Math.abs(side.bodies - 1)).toBeLessThan(0.7);
        expect(Math.abs(side['bodies@phase'] - 5)).toBeLessThan(1.5);
        // The plain table (no derived column) fits the same games worse out of fold.
        const plain = report(samples, family, names, tables(family), { only: ['bodies'] });
        expect(lifted.summary.pooled.meanLogLossDelta).toBeLessThan(plain.summary.pooled.meanLogLossDelta);
        expect(lifted.verdict.adopt).toBe(true);
      });

    test.each([['singles', 'gen9ou', 'standard-singles'], ['doubles', 'gen9doublesou', 'standard-doubles']] as const)(
      'a root column comes back with its weight, and the fit reads it better than the linear column alone (%s)', (gameType, prefix, family) => {
        const samples = phased(prefix, gameType, 3, 0, 320, 13, true);
        const formed = withModelForms(samples, names, tables(family), parseModelForms('root:bodies'));
        expect(formed.names).toEqual(['bodies', 'matchup', 'bodies@root']);
        samples.forEach((sample, i) => expect(formed.samples[i].g[2]).toBeCloseTo(Math.sign(sample.g[0]) * Math.sqrt(Math.abs(sample.g[0])), 12));
        const root = report(formed.samples, family, formed.names, formed.families, { only: ['bodies', 'bodies@root'] });
        const linear = report(samples, family, names, tables(family), { only: ['bodies'] });
        const side = gameType === 'doubles' ? root.proposed.doubles : root.proposed.singles;
        expect(side['bodies@root']).toBeGreaterThan(1.5);
        expect(root.inSample.fit.logLoss).toBeLessThan(linear.inSample.fit.logLoss);
      });

    test('a column the report is told to set starts at that weight, and the rest of the table stays at hand', () => {
      const samples = phased('gen9ou', 'singles', 3, 0, 260, 17);
      const entry = report(samples, 'standard-singles', names, tables('standard-singles'), { only: ['matchup'], set: { bodies: 3 } });
      expect(entry.proposed.singles.bodies).toBe(3);
      expect(entry.weights.find(weight => weight.name === 'bodies')).toMatchObject({ hand: 3, free: false });
    });

    test('naming a column the table does not have stops the report', () => {
      const samples = phased('gen9ou', 'singles', 3, 0, 260, 19);
      expect(() => report(samples, 'standard-singles', names, tables('standard-singles'), { only: ['nothing'] })).toThrow(/no weight named nothing/);
      expect(() => parseModelForms('cube:bodies')).toThrow(/model form/);
      expect(() => withModelForms(samples, names, tables('standard-singles'), parseModelForms('phase:nothing'))).toThrow(/no feature named nothing/);
    });

    test('the start weights of a run come from a name=weight list', () => {
      expect(parseWeightSet('boosts=0, boostsBiting=2.25')).toEqual({ boosts: 0, boostsBiting: 2.25 });
      expect(parseWeightSet('')).toEqual({});
      expect(() => parseWeightSet('boosts')).toThrow(/name=weight/);
    });

    test('a lifted hold leaves the pre-registered list, a name the list does not hold changes nothing', () => {
      const hold = { shared: ['trickRoom', 'choiceMismatch', 'boosts'], doubles: ['boosts'] };
      expect(liftHolds(hold, ['boosts'])).toEqual({ shared: ['trickRoom', 'choiceMismatch'], doubles: [] });
      expect(liftHolds(hold, [])).toEqual(hold);
      expect(liftHolds(hold, ['pairFocus'])).toEqual(hold);
    });
  });
});

/**
 * Round 69 (T163, decision 20): the leaf K on the search's root values. A search capture holds the root
 * value v in wp units; its logit is 2 atanh(v), and a family's scale c0 + c1 ff of sigmoid(c logit)
 * against the outcome says how far the search's own values sit from honest (the search averages leaf values,
 * so it re-inflates or flattens them).
 */
describe('root scale of search values', () => {
  const SCALE = (ff: number, c0: number, c1: number) => c0 + c1 * ff;

  /** Root values from a search whose logit z is c_true(ff) times too big (or too small) a reading of the odds. */
  function searched(prefix: string, gameType: 'singles' | 'doubles', c0: number, c1: number, games: number, seed: number): FamilySample[] {
    const random = mulberry32(seed);
    const out: FamilySample[] = [];
    for (let game = 0; game < games; game++) {
      for (let turn = 0; turn < 4; turn++) {
        const faintedFraction = random() * 0.8;
        const z = (random() - 0.5) * 6;
        const p = 1 / (1 + Math.exp(-SCALE(faintedFraction, c0, c1) * z));
        out.push({
          game: `${prefix}-${game}`, set: `${prefix}-${game}`, gameType, ruleset: rulesetOfId(prefix), g: [], p1Won: random() < p,
          faintedFraction, score: Math.tanh(z / 2), wp: true, lastPair: false,
        });
      }
    }
    return out;
  }

  const kOf = () => K;
  const families = [
    ['singles', 'gen9ou', 'standard-singles', K.singles], ['doubles', 'gen9doublesou', 'standard-doubles', K.doubles],
    ['doubles', 'gen9vgc2026regi', 'vgc-doubles', K.doubles],
  ] as const;

  test.each(families)('a search that reads its odds 40 percent too sure comes back as a scale under 1 (%s %s)', (gameType, prefix, family, k) => {
    const rows = searched(prefix, gameType, 0.7, 0.3, 900, 31);
    const report = rootScaleReports(rows, kOf, kOf, 40)[family];
    if (!('scale' in report)) throw new Error('skipped');
    expect(report.n).toBe(rows.length);
    expect(report.sets).toBe(900);
    expect(report.capturedK).toEqual(k);
    // k0 and k1 trade off against each other: the scale in the middle of the games is the steady reading.
    for (const ff of [0.2, 0.4, 0.6]) expect(Math.abs(report.scale.k0 + report.scale.k1 * ff - SCALE(ff, 0.7, 0.3))).toBeLessThan(0.1);
    // K' is the K of the capture times the scale: the line through the product on the rows' own phases.
    const at = (ff: number) => (k.k0 + k.k1 * ff) * SCALE(ff, 0.7, 0.3);
    for (const ff of [0.1, 0.4, 0.7]) expect(Math.abs(report.kPrime.k0 + report.kPrime.k1 * ff - at(ff)) / at(ff)).toBeLessThan(0.1);
    // The fitted scale reads the same games better than the capture's own values.
    for (const bucket of ['early', 'mid', 'late'] as const) {
      expect(report.buckets[bucket].n).toBeGreaterThan(100);
      expect(report.buckets[bucket].logLossFitted).toBeLessThan(report.buckets[bucket].logLossToday);
      expect(report.buckets[bucket].brierFitted).toBeLessThan(report.buckets[bucket].brierToday);
    }
    // The 90 percent band of K' at a third fainted holds the true K' there.
    const third = report.spread.at.find(entry => Math.abs(entry.ff - 1 / 3) < 1e-9)!;
    expect(third.k).toBeCloseTo((k.k0 + k.k1 / 3) * (report.scale.k0 + report.scale.k1 / 3), 10);
    expect(third.lo).toBeLessThan(at(1 / 3));
    expect(third.hi).toBeGreaterThan(at(1 / 3));
  });

  test.each(families)('an honest search reads a scale of 1, and the last pair, which the bank prices by its race, stays out (%s %s)', (gameType, prefix, family) => {
    const honest = searched(prefix, gameType, 1, 0, 400, 37);
    const withLast = [...honest, ...searched(prefix, gameType, -3, 0, 60, 41).map(row => ({ ...row, game: `last-${row.game}`, set: `last-${row.set}`, lastPair: true }))];
    const plain = rootScaleReports(honest, kOf, kOf, 20)[family];
    const mixed = rootScaleReports(withLast, kOf, kOf, 20)[family];
    if (!('scale' in plain) || !('scale' in mixed)) throw new Error('skipped');
    expect(Math.abs(plain.scale.k0 + plain.scale.k1 * 0.4 - 1)).toBeLessThan(0.15);
    expect(mixed.n).toBe(honest.length);
    expect(mixed.scale).toEqual(plain.scale);
  });

  test('a family below 100 positions is skipped, and a certain value (v = 1) is counted and clamped, not infinite', () => {
    const few = searched('gen9ou', 'singles', 1, 0, 20, 43);
    expect(rootScaleReports(few, kOf, kOf, 10)['standard-singles']).toMatchObject({ skipped: expect.stringMatching(/below 100/) });
    const rows = searched('gen9ou', 'singles', 1, 0, 300, 47);
    rows[0] = { ...rows[0], score: 1, p1Won: true };
    rows[1] = { ...rows[1], score: -1, p1Won: true };
    const report = rootScaleReports(rows, kOf, kOf, 10)['standard-singles'];
    if (!('scale' in report)) throw new Error('skipped');
    expect(report.clamped).toBe(2);
    expect(Number.isFinite(report.scale.k0) && Number.isFinite(report.scale.k1)).toBe(true);
  });

  test('the K table of a capture is read from a stamp with one K per rule set and game type', () => {
    const stamp = JSON.stringify({
      standard: K, vgc: K, champions: { singles: K.singles, doubles: { k0: 1.86, k1: 4.17 } },
    });
    const captured = parseKTable(stamp);
    expect(captured('standard')).toEqual(K);
    expect(captured('vgc')).toEqual(K);
    expect(captured('champions').doubles).toEqual({ k0: 1.86, k1: 4.17 });
    // A stamp that lacks a rule set, or a K, stops the report instead of reading today's table.
    expect(() => parseKTable(JSON.stringify({ standard: K }))).toThrow(/vgc/);
    expect(() => parseKTable(JSON.stringify({ standard: K, vgc: K, champions: { singles: K.singles, doubles: { k0: 1 } } }))).toThrow(/champions.*doubles/);
  });

  test('a capture made under another K table is refused', () => {
    const rows = searched('gen9doublesou', 'doubles', 1, 0, 200, 53);
    const other = () => ({ singles: K.singles, doubles: { k0: K.doubles.k0 + 0.5, k1: K.doubles.k1 } });
    expect(() => rootScaleReports(rows, kOf, other, 10)).toThrow(/standard-doubles.*capture/);
    // Singles rows do not care for the doubles table of the stamp.
    const singles = searched('gen9ou', 'singles', 1, 0, 200, 59);
    expect(() => rootScaleReports(singles, kOf, other, 10)).not.toThrow();
  });
});
