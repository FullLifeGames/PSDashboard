import { afterEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import { createMatchupCache } from '../src/eval-function';
import { createRootPosition, positionBattle, type SimPosition } from '../src/forward-model';
import { createLocalExecutor, subSearchDepth1 } from '../src/search';
import { searchOptions } from '../src/search/options';
import { sampleCell } from '../src/search/cell-sampler';
import { countFainted } from '../src/search/leaf';
import {
  deepenVerifiedCell, deeperValues, lightOptions, VERIFY_CHEAP, VERIFY_DEEPEN_COVER, VERIFY_PLAIN_DRAWS, type Outcome,
} from '../src/search/verify-cell';
import { perfReset, perfSummary } from '../src/perf-trace';
import type { EvalCellJob, EvalSettings } from '../src/types';
import { pairSet } from './pair-battles';

/**
 * Round 69 (T148): the doubles verify round deepens the heaviest outcome of a cell through a full depth-1 sub-search
 * (VERIFY_DEEPEN_COVER.doubles is 0) and prices every smaller outcome as its one-ply leaf plus the mean step of the
 * deepened one. The small outcomes now take a light sub-search instead: the same depth-1 search over the best option
 * lists of each side, so the shifted guess becomes a priced value at a fraction of the cost. Singles keeps its cover
 * of 0.9 and its value path untouched.
 */

const child = (name: string) => ({ serialized: name } as unknown as SimPosition);
const outcome = (name: string, weight: number, leaf: number, ended = false): Outcome => ({ weight, child: child(name), leaf, ended });

describe('deeperValues with a cheap deepening for the outcomes beyond the cover', () => {
  const outcomes = [outcome('heavy', 0.6, 0.1), outcome('mid', 0.25, 0.3), outcome('small', 0.1, -0.2), outcome('done', 0.05, 1, true)];
  const full = (position: SimPosition) => ({ heavy: 0.5 }[position.serialized as 'heavy'] ?? Number.NaN);
  const light = (position: SimPosition) => ({ mid: 0.45, small: -0.1 }[position.serialized as 'mid'] ?? Number.NaN);

  test('every open outcome beyond the cover is priced by the cheap callback, the heaviest by the full one', () => {
    const fullCalls: string[] = [];
    const cheapCalls: string[] = [];
    const values = deeperValues(outcomes, position => { fullCalls.push(position.serialized); return full(position); }, 0,
      Number.POSITIVE_INFINITY, undefined, { price: position => { cheapCalls.push(position.serialized); return light(position); }, statesOnly: false, minWeight: 0 });
    expect(fullCalls).toEqual(['heavy']);
    expect(cheapCalls).toEqual(['mid', 'small']);
    expect(values).toEqual([0.5, 0.45, -0.1, 1]);
  });

  test('without it the beyond-cover outcomes take the mean step, as before', () => {
    const values = deeperValues(outcomes, full, 0);
    const step = 0.5 - 0.1;
    expect(values).toEqual([0.5, 0.3 + step, -0.2 + step, 1]);
  });

  test('statesOnly keeps the shift for an outcome with one state and prices an outcome with states through the cheap callback', () => {
    const states = [{ share: 0.5, child: child('mid-a'), leaf: 0.2, ended: false }, { share: 0.5, child: child('mid-b'), leaf: 0.4, ended: false }];
    const withStates = [outcome('heavy', 0.6, 0.1), { ...outcome('mid', 0.25, 0.3), groups: states }, outcome('small', 0.15, -0.2)];
    const cheapCalls: string[] = [];
    const values = deeperValues(withStates, full, 0, Number.POSITIVE_INFINITY, undefined,
      { price: position => { cheapCalls.push(position.serialized); return position.serialized === 'mid-a' ? 0.3 : 0.5; }, statesOnly: true, minWeight: 0 });
    expect(cheapCalls).toEqual(['mid-a', 'mid-b']);
    expect(values[1]).toBeCloseTo(0.4, 12);
    expect(values[2]).toBeCloseTo(-0.2 + (0.5 - 0.1), 12); // one state: the shift
  });

  test('an outcome lighter than minWeight keeps the shift, the heavier one takes the cheap price', () => {
    const cheapCalls: string[] = [];
    const values = deeperValues(outcomes, full, 0, Number.POSITIVE_INFINITY, undefined,
      { price: position => { cheapCalls.push(position.serialized); return light(position); }, statesOnly: false, minWeight: 0.2 });
    expect(cheapCalls).toEqual(['mid']);
    expect(values).toEqual([0.5, 0.45, -0.2 + (0.5 - 0.1), 1]);
  });

  test('a cover that reaches every outcome calls the cheap callback never', () => {
    let calls = 0;
    const deep = (position: SimPosition) => (position.serialized === 'heavy' ? 0.5 : 0.4);
    deeperValues(outcomes, deep, 1, Number.POSITIVE_INFINITY, undefined, { price: () => { calls += 1; return 0; }, statesOnly: false, minWeight: 0 });
    expect(calls).toBe(0);
  });
});

describe('the game types keep their rule', () => {
  test('singles takes no cheap deepening, doubles takes one', () => {
    expect(VERIFY_CHEAP.singles).toBe('off');
    expect(VERIFY_CHEAP.doubles).not.toBe('off');
    expect(VERIFY_DEEPEN_COVER.singles).toBe(0.9);
  });
});

const fixture = JSON.parse(readFileSync(new URL('./fixtures/positions/smogtours-gen9doublesou-912045-t6.json', import.meta.url), 'utf-8')) as
  { serialized: string; tera: boolean; sleepClause: boolean };

function singlesRoot(): SimPosition {
  const battle = new Battle({
    formatid: toID('gen9customgame'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack([pairSet('Caster', 'Alakazam', ['Focus Blast', 'Recover', 'Psychic'], { level: 100 }), pairSet('Back', 'Blissey', ['Soft-Boiled'])]) },
    p2: { name: 'Beta', team: Teams.pack([pairSet('Wall', 'Snorlax', ['Curse', 'Rest', 'Body Slam'], { level: 100 }), pairSet('Back', 'Chansey', ['Soft-Boiled'])]) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return createRootPosition(JSON.stringify(State.serializeBattle(battle)));
}

describe('light option lists', () => {
  const root = createRootPosition(fixture.serialized);

  test('912045 t6: at most six options a side, a quarter of the cells or less', () => {
    const sides = ['p1', 'p2'] as const;
    const fullLists = sides.map(side => searchOptions(root, side, { tera: false }));
    const lightLists = sides.map((side, index) => lightOptions(root, side, fullLists[index]));
    const cells = (lists: unknown[][]) => lists[0].length * lists[1].length;
    expect(cells(fullLists)).toBeGreaterThan(36);
    expect(lightLists.every((list, index) => list.length <= 6 && list.every(option => fullLists[index].includes(option)))).toBe(true);
    expect(cells(lightLists)).toBeLessThanOrEqual(cells(fullLists) / 4);
  });

  test('a singles list is returned as it is', () => {
    const singles = singlesRoot();
    const options = searchOptions(singles, 'p1', { tera: false });
    expect(lightOptions(singles, 'p1', options)).toBe(options);
  });
});

describe('the verify round of a cell counts its sub-searches', () => {
  const saved = VERIFY_CHEAP.doubles;
  afterEach(() => { VERIFY_CHEAP.doubles = saved; });

  async function verifyRound(serialized: string, cells: [number, number][], deepen: EvalSettings) {
    const executor = createLocalExecutor(serialized);
    const { p1, p2 } = await executor.choices(deepen.tera, undefined, deepen.sleepClause);
    const jobs: EvalCellJob[] = cells.map(([i, j]) => ({ i, j, p1Choice: p1[i].choice, p2Choice: p2[j].choice, samples: 1, deepen }));
    perfReset();
    const values = await executor.evalCells(jobs);
    return { jobs, values, counters: perfSummary('t148').counters };
  }

  test('912045 t6: the cheap deepening adds light sub-searches and leaves the full ones where they were', async () => {
    const settings: EvalSettings = { depth: 1, samples: 1, tera: fixture.tera, sleepClause: fixture.sleepClause };
    const cells: [number, number][] = [[0, 0], [1, 2], [3, 1], [5, 5]];
    VERIFY_CHEAP.doubles = 'off';
    const off = await verifyRound(fixture.serialized, cells, settings);
    VERIFY_CHEAP.doubles = saved;
    const on = await verifyRound(fixture.serialized, cells, settings);
    expect(off.counters['verify-sub-light'] ?? 0).toBe(0);
    expect(off.counters['verify-sub-full']).toBeGreaterThan(0);
    expect(on.counters['verify-sub-light']).toBeGreaterThan(0);
    expect(on.counters['verify-sub-full']).toBe(off.counters['verify-sub-full']);
    // The sampler's own values do not move, only the deepened ones.
    expect(on.values.map(value => value.value)).toEqual(off.values.map(value => value.value));
  }, 120_000);

  test('singles: the verify round deepens as deepenVerifiedCell does without a cheap callback, and no light search runs', async () => {
    const root = singlesRoot();
    const deepen: EvalSettings = { depth: 1, samples: 1, tera: false };
    const round = await verifyRound(root.serialized, [[0, 0], [0, 1], [1, 0], [2, 1]], deepen);
    expect(round.counters['verify-sub-light'] ?? 0).toBe(0);
    expect(round.counters['verify-sub-full']).toBeGreaterThan(0);
    const cache = createMatchupCache();
    const rootFainted = countFainted(positionBattle(root));
    for (const [index, job] of round.jobs.entries()) {
      const cell = sampleCell(root, rootFainted, job.p1Choice, job.p2Choice, 1, cache, true, VERIFY_PLAIN_DRAWS);
      const expected = { i: job.i, j: job.j, value: cell.value, ended: cell.ended, ...(cell.blend ? { blend: cell.blend } : {}) };
      deepenVerifiedCell(expected, cell, position => subSearchDepth1(position.serialized, deepen, cache).score, VERIFY_DEEPEN_COVER.singles);
      expect(round.values[index].deepened).toBe((expected as { deepened?: number }).deepened);
      expect(round.values[index].blend?.classes.map(cls => cls.deepened)).toEqual(expected.blend?.classes.map(cls => cls.deepened));
    }
  }, 120_000);
});
