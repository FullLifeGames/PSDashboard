import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { FIT_MANIFEST, bankTurns, bankUniverse, cachedRating, holdoutSets, holdoutTurns, phaseOf } from './bank-universe';
import { FAMILY_NAMES, familyOf, familyOfFormat, rulesetOfId } from './fit-families';

/** Round 65: the universe of a bank run (bank, fit corpus, holdout) and its sampled turns. */

const bank = { ids: ['a', 'b'], trancheOf: new Map([['a', 'x'], ['b', 'y']]) };
const saved = {
  source: process.env.EVAL_CALIBRATION_SOURCE, dump: process.env.EVAL_CALIBRATION_DUMP,
  family: process.env.EVAL_CALIBRATION_FAMILY, turns: process.env.EVAL_CALIBRATION_TURNS,
};

afterEach(() => {
  if (saved.source === undefined) delete process.env.EVAL_CALIBRATION_SOURCE;
  else process.env.EVAL_CALIBRATION_SOURCE = saved.source;
  if (saved.dump === undefined) delete process.env.EVAL_CALIBRATION_DUMP;
  else process.env.EVAL_CALIBRATION_DUMP = saved.dump;
  if (saved.family === undefined) delete process.env.EVAL_CALIBRATION_FAMILY;
  else process.env.EVAL_CALIBRATION_FAMILY = saved.family;
  if (saved.turns === undefined) delete process.env.EVAL_CALIBRATION_TURNS;
  else process.env.EVAL_CALIBRATION_TURNS = saved.turns;
});

describe('bank universe', () => {
  test('the bank samples every ceil(maxTurn / 8)-th turn from turn 2, the holdout one turn per third', () => {
    expect(bankTurns(30)).toEqual([2, 6, 10, 14, 18, 22, 26]);
    expect(holdoutTurns(30)).toEqual([5, 15, 25]);
    expect(holdoutTurns(12)).toEqual([2, 6, 10]);
    expect(holdoutTurns(4)).toEqual([2, 3]);
  });

  test('round 66: each holdout turn lies in the third it stands for, a short game drops the thirds it cannot reach', () => {
    // Round 65's rule clamped the early point to turn 2, which a game of five or six snapshots reads as mid.
    const round65 = (maxTurn: number) => [...new Set([1 / 6, 1 / 2, 5 / 6]
      .map(at => Math.min(maxTurn - 1, Math.max(2, Math.round(at * maxTurn)))))].filter(turn => turn < maxTurn);
    for (let maxTurn = 3; maxTurn <= 400; maxTurn++) {
      const turns = holdoutTurns(maxTurn);
      expect(new Set(turns.map(turn => phaseOf(turn, maxTurn))).size).toBe(turns.length);
      if (maxTurn >= 7) expect(turns).toEqual(round65(maxTurn));
    }
    expect(holdoutTurns(6)).toEqual([3, 5]);
    expect(holdoutTurns(5)).toEqual([3, 4]);
    expect(holdoutTurns(3)).toEqual([2]);
    expect([2, 3, 4, 5].map(turn => phaseOf(turn, 6))).toEqual(['mid', 'mid', 'late', 'late']);
    expect(phaseOf(2, 7)).toBe('early');
  });

  test('without a source the bank runs its own tranches from the network', () => {
    delete process.env.EVAL_CALIBRATION_SOURCE;
    expect(bankUniverse(bank)).toMatchObject({ ids: ['a', 'b'], cached: false });
  });

  test('the holdout reads its sets from the cache under holdout-<family> tranches', () => {
    process.env.EVAL_CALIBRATION_SOURCE = 'holdout';
    const universe = bankUniverse(bank);
    const sets = holdoutSets();
    expect(universe.cached).toBe(true);
    expect(universe.ids).toHaveLength(sets.reduce((sum, set) => sum + set.ids.length, 0));
    expect(universe.trancheOf.get(sets[0].ids[0])).toBe(`holdout-${sets[0].family}`);
    expect(universe.sampleTurns(30)).toEqual([5, 15, 25]);
  });

  // Round 66 review: scripts/expand-fit-corpus.mjs keeps bank and feedback replays out, scripts/build-fit-corpus.mjs does not.
  test('the fit corpus and its holdout share no replay with the bank or the feedback corpus', () => {
    const quoted = (path: string) => [...readFileSync(path, 'utf-8').matchAll(/'((?:[a-z0-9]+-)+\d+)'/g)].map(match => match[1]);
    const barred = new Set([...quoted('regression/eval-calibration.spec.ts'), ...quoted('e2e-feedback/corpus.ts')]);
    const corpus = new Set((JSON.parse(readFileSync(FIT_MANIFEST, 'utf-8')) as { replays: { id: string }[] }).replays.map(entry => entry.id));
    expect(barred.size).toBeGreaterThanOrEqual(134);
    expect([...corpus].filter(id => barred.has(id))).toEqual([]);
    expect(holdoutSets().flatMap(set => set.ids).filter(id => !corpus.has(id))).toEqual([]);
  });

  test('the fit corpus needs a dump path, and an unknown source stops the run', () => {
    process.env.EVAL_CALIBRATION_SOURCE = 'fit';
    delete process.env.EVAL_CALIBRATION_DUMP;
    expect(() => bankUniverse(bank)).toThrow(/dump/);
    process.env.EVAL_CALIBRATION_SOURCE = 'holdouts';
    expect(() => bankUniverse(bank)).toThrow(/unknown EVAL_CALIBRATION_SOURCE/);
  });
});

/**
 * Round 69 (T163): a search capture of one family at up to three positions per game, so a night holds
 * the four families the leaf K is fitted on. The default paths do not move.
 */
describe('fit universe of one family', () => {
  type Entry = { id: string; format: string; source: 'tournament' | 'ladder' };
  const corpus = () => (JSON.parse(readFileSync(FIT_MANIFEST, 'utf-8')) as { replays: Entry[] }).replays;
  const fitRun = (family?: string) => {
    process.env.EVAL_CALIBRATION_SOURCE = 'fit';
    process.env.EVAL_CALIBRATION_DUMP = 'unused.jsonl';
    if (family === undefined) delete process.env.EVAL_CALIBRATION_FAMILY;
    else process.env.EVAL_CALIBRATION_FAMILY = family;
    return bankUniverse(bank);
  };
  const held = () => new Set(holdoutSets().flatMap(set => set.ids));
  /** What a fit does not read: the holdout and the ladder games without a rating (withoutHoldout, withoutUnratedLadder). */
  const leavesTheFit = (entry: Entry, holdout: ReadonlySet<string>) =>
    holdout.has(entry.id) || (entry.source === 'ladder' && (cachedRating(entry.id) ?? 0) <= 0 && cachedRating(entry.id) !== undefined);

  test('without a family or a turn rule the fit universe is the whole corpus at the bank turns', () => {
    delete process.env.EVAL_CALIBRATION_TURNS;
    const universe = fitRun();
    const entries = corpus();
    expect(universe.ids).toEqual(entries.map(entry => entry.id));
    expect(universe.trancheOf.get(entries[0].id)).toBe(`fit-${entries[0].source}`);
    expect(universe.sampleTurns(30)).toEqual(bankTurns(30));
  });

  test('a corpus format belongs to the family its replays play (the log says gametype)', () => {
    const seen = new Map<string, number>();
    for (const entry of corpus()) {
      const taken = seen.get(entry.format) ?? 0;
      const path = `.fit-corpus/${entry.id}.json`;
      if (taken >= 2 || !existsSync(path)) continue;
      seen.set(entry.format, taken + 1);
      const log = (JSON.parse(readFileSync(path, 'utf-8')) as { log: string }).log;
      const gameType = /\|gametype\|doubles/.test(log) ? 'doubles' : 'singles';
      expect(familyOfFormat(entry.format), entry.id).toBe(familyOf({ ruleset: rulesetOfId(entry.id), gameType }));
    }
    expect(seen.size).toBeGreaterThan(30);
  }, 120_000);

  test('a family keeps its own games, left of the holdout and the unrated ladder, under the corpus tranches', () => {
    const holdout = held();
    const entries = corpus();
    const fitted = entries.filter(entry => !leavesTheFit(entry, holdout));
    const lists = FAMILY_NAMES.map(name => ({ name, universe: fitRun(name) }));
    for (const { name, universe } of lists) {
      const expected = fitted.filter(entry => familyOfFormat(entry.format) === name);
      expect(universe.ids.length, name).toBeGreaterThan(100);
      expect(universe.ids, name).toEqual(expected.map(entry => entry.id));
      expect(universe.cached).toBe(true);
      const first = expected[0];
      expect(universe.trancheOf.get(first.id)).toBe(`fit-${first.source}`);
    }
    // The five families split the games a fit reads between them: no game twice, none lost.
    const all = lists.flatMap(({ universe }) => universe.ids);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(fitted.length);
    // The unrated ladder games of the corpus (Champions VGC Bo3) are what the filter drops beside the holdout.
    expect(entries.filter(entry => entry.source === 'ladder' && !holdout.has(entry.id) && leavesTheFit(entry, holdout)).length).toBeGreaterThan(0);
  }, 240_000);

  test('a family names one of the five and needs the fit corpus', () => {
    expect(() => fitRun('doublesou')).toThrow(/unknown EVAL_CALIBRATION_FAMILY/);
    process.env.EVAL_CALIBRATION_FAMILY = 'vgc-doubles';
    delete process.env.EVAL_CALIBRATION_SOURCE;
    expect(() => bankUniverse(bank)).toThrow(/EVAL_CALIBRATION_SOURCE=fit/);
    process.env.EVAL_CALIBRATION_SOURCE = 'holdout';
    expect(() => bankUniverse(bank)).toThrow(/EVAL_CALIBRATION_SOURCE=fit/);
  });

  test('EVAL_CALIBRATION_TURNS=thirds samples one turn in each third of a game, on any source', () => {
    process.env.EVAL_CALIBRATION_TURNS = 'thirds';
    expect(fitRun().sampleTurns(30)).toEqual(holdoutTurns(30));
    expect(fitRun('champions-doubles').sampleTurns(61)).toEqual(holdoutTurns(61));
    delete process.env.EVAL_CALIBRATION_FAMILY;
    delete process.env.EVAL_CALIBRATION_SOURCE;
    expect(bankUniverse(bank).sampleTurns(30)).toEqual([5, 15, 25]);
    process.env.EVAL_CALIBRATION_TURNS = 'every';
    expect(() => bankUniverse(bank)).toThrow(/unknown EVAL_CALIBRATION_TURNS/);
  });
});
