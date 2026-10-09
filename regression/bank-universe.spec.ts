import { afterEach, describe, expect, test } from 'vitest';
import { bankTurns, bankUniverse, holdoutSets, holdoutTurns } from './bank-universe';

/** Round 65: the universe of a bank run (bank, fit corpus, holdout) and its sampled turns. */

const bank = { ids: ['a', 'b'], trancheOf: new Map([['a', 'x'], ['b', 'y']]) };
const saved = { source: process.env.EVAL_CALIBRATION_SOURCE, dump: process.env.EVAL_CALIBRATION_DUMP };

afterEach(() => {
  if (saved.source === undefined) delete process.env.EVAL_CALIBRATION_SOURCE;
  else process.env.EVAL_CALIBRATION_SOURCE = saved.source;
  if (saved.dump === undefined) delete process.env.EVAL_CALIBRATION_DUMP;
  else process.env.EVAL_CALIBRATION_DUMP = saved.dump;
});

describe('bank universe', () => {
  test('the bank samples every ceil(maxTurn / 8)-th turn from turn 2, the holdout one turn per third', () => {
    expect(bankTurns(30)).toEqual([2, 6, 10, 14, 18, 22, 26]);
    expect(holdoutTurns(30)).toEqual([5, 15, 25]);
    expect(holdoutTurns(12)).toEqual([2, 6, 10]);
    expect(holdoutTurns(4)).toEqual([2, 3]);
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

  test('the fit corpus needs a dump path, and an unknown source stops the run', () => {
    process.env.EVAL_CALIBRATION_SOURCE = 'fit';
    delete process.env.EVAL_CALIBRATION_DUMP;
    expect(() => bankUniverse(bank)).toThrow(/dump/);
    process.env.EVAL_CALIBRATION_SOURCE = 'holdouts';
    expect(() => bankUniverse(bank)).toThrow(/unknown EVAL_CALIBRATION_SOURCE/);
  });
});
