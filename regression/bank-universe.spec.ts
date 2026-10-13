import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FIT_MANIFEST, bankTurns, bankUniverse, cachedRating, holdoutSets, holdoutTurns, phaseOf, quickSubset,
} from './bank-universe';
import { FAMILY_NAMES, familyOf, familyOfFormat, rulesetOfId } from './fit-families';

/** Round 65: the universe of a bank run (bank, fit corpus, holdout) and its sampled turns. */

const bank = { ids: ['a', 'b'], trancheOf: new Map([['a', 'x'], ['b', 'y']]) };
const saved = {
  source: process.env.EVAL_CALIBRATION_SOURCE, dump: process.env.EVAL_CALIBRATION_DUMP,
  family: process.env.EVAL_CALIBRATION_FAMILY, turns: process.env.EVAL_CALIBRATION_TURNS,
  fraction: process.env.EVAL_CALIBRATION_FRACTION,
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
  if (saved.fraction === undefined) delete process.env.EVAL_CALIBRATION_FRACTION;
  else process.env.EVAL_CALIBRATION_FRACTION = saved.fraction;
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

/**
 * Round 70 (bank tooling): EVAL_CALIBRATION_FRACTION keeps a deterministic, stratified share of the
 * universe, so a quick run screens a change in a fraction of the machine time and pairs against a
 * full base on the rows both hold. Unset, empty and 1 leave the universe whole.
 */
describe('quick tier', () => {
  type Entry = readonly [id: string, tranche: string];
  type Universe = { ids: string[]; trancheOf: Map<string, string> };
  const numbered = (format: string, count: number, tranche: string): Entry[] =>
    Array.from({ length: count }, (_, index) => [`${format}-${index + 1}`, tranche] as const);
  /** Four strata: gen9ou in ladder (8), Doubles OU (6) and VGC (4) in cup, one Champions OU game alone in solo. */
  const mixed: Entry[] = [
    ...numbered('gen9ou', 8, 'ladder'), ...numbered('gen9doublesou', 6, 'cup'),
    ...numbered('gen9vgc2026regi', 4, 'cup'), ...numbered('gen9championsou', 1, 'solo'),
  ];
  const at = (fraction: string | undefined, entries: readonly Entry[] = mixed) => {
    delete process.env.EVAL_CALIBRATION_SOURCE;
    if (fraction === undefined) delete process.env.EVAL_CALIBRATION_FRACTION;
    else process.env.EVAL_CALIBRATION_FRACTION = fraction;
    return bankUniverse({ ids: entries.map(([id]) => id), trancheOf: new Map(entries) });
  };
  const counted = (universe: Universe, keyOf: (id: string, tranche: string) => string) => {
    const counts = new Map<string, number>();
    for (const id of universe.ids) {
      const key = keyOf(id, universe.trancheOf.get(id) ?? 'unknown');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const stratum = (id: string, tranche: string) => `${tranche}|${familyOfFormat(id)}`;
  const mixedStrata = (ids: string[]) => Object.fromEntries(
    counted({ ids, trancheOf: new Map(mixed) }, (id, tranche) => `${tranche}|${id.replace(/-\d+$/, '')}`));
  const corpus = () => (JSON.parse(readFileSync(FIT_MANIFEST, 'utf-8')) as { replays: { id: string; format: string }[] }).replays;

  test('without a fraction, with an empty one or with 1 the universe stays whole', () => {
    for (const value of [undefined, '', '1', '1.0']) {
      const universe = at(value);
      expect(universe.ids, String(value)).toEqual(mixed.map(([id]) => id));
      expect([...universe.trancheOf], String(value)).toEqual(mixed);
    }
    process.env.EVAL_CALIBRATION_SOURCE = 'holdout';
    delete process.env.EVAL_CALIBRATION_FRACTION;
    const whole = bankUniverse(bank);
    process.env.EVAL_CALIBRATION_FRACTION = '1';
    const one = bankUniverse(bank);
    expect(one.ids).toEqual(whole.ids);
    expect([...one.trancheOf]).toEqual([...whole.trancheOf]);
    expect(one.cached).toBe(true);
  });

  test('a fraction keeps the replays whose sha256 of the id ranks first in their tranche and family, in universe order', () => {
    // Computed apart from the code (a scratch script over node:crypto), so a change of hash or rank shows here.
    expect(at('0.5').ids).toEqual([
      'gen9ou-1', 'gen9ou-3', 'gen9ou-5', 'gen9ou-8', 'gen9doublesou-1', 'gen9doublesou-2', 'gen9doublesou-4',
      'gen9vgc2026regi-3', 'gen9vgc2026regi-4', 'gen9championsou-1',
    ]);
    expect(at('0.25').ids).toEqual([
      'gen9ou-1', 'gen9ou-5', 'gen9doublesou-2', 'gen9doublesou-4', 'gen9vgc2026regi-3', 'gen9championsou-1',
    ]);
    expect(at('0.25').trancheOf.size).toBe(6);
    expect(at('0.25').trancheOf.get('gen9doublesou-2')).toBe('cup');
  });

  test('each tranche and family keeps its rounded share, and no stratum drops out', () => {
    expect(mixedStrata(at('0.5').ids)).toEqual({ 'ladder|gen9ou': 4, 'cup|gen9doublesou': 3, 'cup|gen9vgc2026regi': 2, 'solo|gen9championsou': 1 });
    expect(mixedStrata(at('0.25').ids)).toEqual({ 'ladder|gen9ou': 2, 'cup|gen9doublesou': 2, 'cup|gen9vgc2026regi': 1, 'solo|gen9championsou': 1 });
    // Below half a replay a stratum still keeps one.
    expect(mixedStrata(at('0.05').ids)).toEqual({ 'ladder|gen9ou': 1, 'cup|gen9doublesou': 1, 'cup|gen9vgc2026regi': 1, 'solo|gen9championsou': 1 });
  });

  test('the same replays come back whatever the input order, and a smaller fraction picks a subset of a larger one', () => {
    const reversed = [...mixed].reverse();
    expect(at('0.25', reversed).ids).toEqual([...at('0.25').ids].reverse());
    const chain = ['0.1', '0.25', '0.5', '0.75', '1'].map(value => new Set(at(value).ids));
    chain.forEach((kept, index) => {
      if (index > 0) expect([...chain[index - 1]].filter(id => !kept.has(id))).toEqual([]);
    });
    expect(chain.map(kept => kept.size)).toEqual([4, 6, 10, 15, 19]);
  });

  test('a stratum keeps the same replays whatever the other strata hold', () => {
    const ladder = (entries: readonly Entry[]) => at('0.25', entries).ids.filter(id => id.startsWith('gen9ou-'));
    const alone = ladder(mixed.filter(([, tranche]) => tranche === 'ladder'));
    expect(alone).toEqual(['gen9ou-1', 'gen9ou-5']);
    expect(ladder(mixed)).toEqual(alone);
    // A new tranche and a new family inside the tranche each form a stratum of their own.
    expect(ladder([...mixed, ...numbered('gen9uu', 7, 'newcomer'), ...numbered('gen9vgc2026regj', 5, 'ladder')])).toEqual(alone);
  });

  test('quickSubset keeps every replay at 1, and groups replays without a tranche into one stratum per family', () => {
    const ids = mixed.map(([id]) => id);
    expect(quickSubset(ids, new Map(mixed), 1)).toEqual(ids);
    expect(quickSubset([], new Map(), 0.25)).toEqual([]);
    // Without tranche labels the strata are the four families: 8 standard singles, 6 Doubles OU, 4 VGC, 1 Champions singles.
    const bare = quickSubset(ids, new Map(), 0.5);
    expect(bare.filter(id => id.startsWith('gen9ou-'))).toHaveLength(4);
    expect(bare.filter(id => id.startsWith('gen9doublesou-'))).toHaveLength(3);
    expect(bare.filter(id => id.startsWith('gen9vgc2026regi-'))).toHaveLength(2);
    expect(bare).toContain('gen9championsou-1');
    // Every family of `mixed` sits in one tranche, so the labels leave the picks where they were.
    expect(bare).toEqual(at('0.5').ids);
  });

  test('a fraction that is no share stops the run', () => {
    for (const value of ['0', '-0.5', '1.5', '2', 'abc', '25%', 'NaN', 'Infinity']) {
      expect(() => at(value), value).toThrow(/EVAL_CALIBRATION_FRACTION/);
    }
  });

  test('the sampled turns and the other levers do not move under a fraction', () => {
    process.env.EVAL_CALIBRATION_FRACTION = '0.25';
    process.env.EVAL_CALIBRATION_SOURCE = 'holdout';
    const universe = bankUniverse(bank);
    expect(universe.sampleTurns(30)).toEqual([5, 15, 25]);
    process.env.EVAL_CALIBRATION_TURNS = 'thirds';
    delete process.env.EVAL_CALIBRATION_SOURCE;
    expect(bankUniverse(bank).sampleTurns(30)).toEqual([5, 15, 25]);
    delete process.env.EVAL_CALIBRATION_TURNS;
    expect(bankUniverse(bank).sampleTurns(30)).toEqual(bankTurns(30));
  });

  test('the holdout keeps every tranche within half a replay of its share', () => {
    process.env.EVAL_CALIBRATION_SOURCE = 'holdout';
    delete process.env.EVAL_CALIBRATION_FRACTION;
    const whole = bankUniverse(bank);
    expect(new Set(whole.ids).size).toBe(whole.ids.length);
    const wholeCounts = counted(whole, (_id, tranche) => tranche);
    expect(wholeCounts.size).toBe(4);
    for (const fraction of [0.1, 0.25, 0.5]) {
      process.env.EVAL_CALIBRATION_FRACTION = String(fraction);
      const quick = bankUniverse(bank);
      expect(quick.cached).toBe(true);
      expect(quick.ids.filter(id => !whole.trancheOf.has(id))).toEqual([]);
      expect(quick.trancheOf.size).toBe(quick.ids.length);
      const quickCounts = counted(quick, (_id, tranche) => tranche);
      for (const [tranche, count] of wholeCounts) {
        expect(Math.abs((quickCounts.get(tranche) ?? 0) - count * fraction), `${tranche} at ${fraction}`).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });

  test('the fit corpus keeps every tranche and family within half a replay per stratum of its share', () => {
    process.env.EVAL_CALIBRATION_SOURCE = 'fit';
    process.env.EVAL_CALIBRATION_DUMP = 'unused.jsonl';
    delete process.env.EVAL_CALIBRATION_FAMILY;
    delete process.env.EVAL_CALIBRATION_FRACTION;
    const whole = bankUniverse(bank);
    process.env.EVAL_CALIBRATION_FRACTION = '0.25';
    const quick = bankUniverse(bank);
    const wholeStrata = counted(whole, stratum);
    const quickStrata = counted(quick, stratum);
    expect(wholeStrata.size).toBe(8);
    expect(quickStrata.size).toBe(8);
    for (const [key, count] of wholeStrata) {
      expect(Math.abs((quickStrata.get(key) ?? 0) - count * 0.25), key).toBeLessThanOrEqual(0.5 + 1e-9);
    }
    // A tranche or a family sums its strata, so its share is off by half a replay per stratum at most.
    for (const part of [0, 1] as const) {
      const sums = (strata: Map<string, number>) => {
        const sum = new Map<string, number>();
        for (const [key, count] of strata) sum.set(key.split('|')[part], (sum.get(key.split('|')[part]) ?? 0) + count);
        return sum;
      };
      const cellsIn = (name: string) => [...wholeStrata.keys()].filter(key => key.split('|')[part] === name).length;
      const quickSums = sums(quickStrata);
      for (const [name, count] of sums(wholeStrata)) {
        expect(Math.abs((quickSums.get(name) ?? 0) - count * 0.25), name).toBeLessThanOrEqual(0.5 * cellsIn(name) + 1e-9);
      }
    }
    expect(quick.ids.filter(id => !whole.trancheOf.has(id))).toEqual([]);
  });

  test('a family universe thins inside the family, after the holdout and the unrated ladder games leave', () => {
    process.env.EVAL_CALIBRATION_SOURCE = 'fit';
    process.env.EVAL_CALIBRATION_DUMP = 'unused.jsonl';
    process.env.EVAL_CALIBRATION_FAMILY = 'standard-doubles';
    delete process.env.EVAL_CALIBRATION_FRACTION;
    const whole = bankUniverse(bank);
    process.env.EVAL_CALIBRATION_FRACTION = '0.25';
    const quick = bankUniverse(bank);
    const wholeSet = new Set(whole.ids);
    expect(quick.ids.length).toBeGreaterThan(50);
    expect(quick.ids.filter(id => !wholeSet.has(id))).toEqual([]);
    expect(quick.ids.every(id => familyOfFormat(id) === 'standard-doubles')).toBe(true);
    expect(Math.abs(quick.ids.length - whole.ids.length * 0.25)).toBeLessThanOrEqual(1 + 1e-9);
  });

  test('a corpus id names the family its format names, so the strata match the families of a fit', () => {
    const apart = corpus().filter(entry => familyOfFormat(entry.id) !== familyOfFormat(entry.format)).map(entry => entry.id);
    expect(apart).toEqual([]);
  });
});
