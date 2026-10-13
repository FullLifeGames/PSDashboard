import { describe, expect, test } from 'vitest';
import { State } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createMatchupCache } from '../src/eval-function';
import { advancePosition, createRootPosition, positionBattle } from '../src/forward-model';
import { createLocalExecutor, searchPosition, subSearchDepth1 } from '../src/search/position';
import { drawChild } from '../src/search/trend-probe';
import { benchOrder } from '../src/search/bench-order';
import { buildMatrix } from '../src/search/matrix';
import { sampleCell } from '../src/search/cell-sampler';
import { countFainted, leafValue, SEARCH_SEEDS } from '../src/search/leaf';
import { expandPivotPairs, searchOptions } from '../src/search/options';
import {
  applyTrendExtrapolation, applyTrendTiebreak, cellKey, rankFromMatrix, selectTieProbeCells, toResult,
} from '../src/rank';
import type { EvalResult, EvalSettings } from '../src/types';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 70: the horizon-trend probe reads a decisive cell from its base draws. The probe used to advance the
 * cell's FIRST-seed child, search it one ply, and subtract the cell's MEAN over all draws: one outcome against the
 * mean of all outcomes (GPL DzBQ5azlO5l turn 13: the first seed was a flinch, the trend +0.54, and the shift of two
 * tied rows put an untied row in front). The probe now runs from each base draw of the cell, the seeds the matrix
 * priced it with, and subtracts each child's own leaf; the trend is the mean over the draws.
 *
 * The scenes are singles with p2's two benched Skarmory identical, so their switch rows tie exactly and the trend
 * layers run on their decisive cells. Gengar's Focus Blast (70 %) is a rolling cell, Shadow Ball (sure) is not.
 */

const SETTINGS: EvalSettings = { depth: 1, samples: 3, tera: false, prove: false };
const PROBE_SETTINGS: EvalSettings = { depth: 1, samples: 1, tera: false };

const scene = (p1Moves: string[]): string => {
  const p1 = [set('Gengar', p1Moves)];
  const p2: PokemonSet[] = [set('Magikarp', ['splash']), set('Skarmory', ['roost', 'bravebird']), set('Skarmory', ['roost', 'bravebird'])];
  return JSON.stringify(State.serializeBattle(battleOf('gen9customgame', p1, p2)));
};
const ROLLING = scene(['focusblast', 'substitute']);
const SURE = scene(['shadowball', 'substitute']);

type Trend = (ctx: { root: ReturnType<typeof createRootPosition>; cache: ReturnType<typeof createMatchupCache>; p1Choice: string; p2Choice: string; value: number; first: ReturnType<typeof createRootPosition> }) => number;

/** The first-seed child searched one ply, against the cell's mean (the probe until round 69). */
const todaysProbe: Trend = ({ cache, value, first }) => subSearchDepth1(first.serialized, PROBE_SETTINGS, cache).score - value;
/** The mean over the cell's first three search seeds of (the child searched one ply) - (the child's own leaf). */
const drawsProbe: Trend = ({ root, cache, p1Choice, p2Choice }) => {
  const trends = SEARCH_SEEDS.slice(0, 3).map(seed => {
    const child = advancePosition(root, p1Choice, p2Choice, seed);
    return subSearchDepth1(child.serialized, PROBE_SETTINGS, cache).score - leafValue(positionBattle(child), cache);
  });
  return trends.reduce((sum, trend) => sum + trend, 0) / trends.length;
};

/** The depth-1 root search by hand, the trend layers fed by `trendOf`: the rankings before and after, and the probes it priced. */
function byHand(serialized: string, trendOf: Trend, samples: 1 | 3 = 3) {
  const order = benchOrder(serialized);
  const root = createRootPosition(order ? order.serialized : serialized);
  const cache = createMatchupCache();
  const p1 = expandPivotPairs(root, 'p1', searchOptions(root, 'p1', { tera: false }));
  const p2 = expandPivotPairs(root, 'p2', searchOptions(root, 'p2', { tera: false }));
  const matrix = buildMatrix(root, p1, p2, samples, 1, undefined, { done: 0, total: 1 }, cache, true);
  const result = toResult(rankFromMatrix(matrix, leafValue(positionBattle(root), cache)), 1);
  const before = result.perSide.p2.map(row => row.ev);
  const statics = matrix.values.map(row => [...row]);
  const trends = new Map<number, number>();
  const probes: string[] = [];
  for (const [i, j] of selectTieProbeCells(matrix, result, trends)) {
    trends.set(cellKey(i, j), trendOf({ root, cache, p1Choice: p1[i].choice, p2Choice: p2[j].choice, value: statics[i][j], first: matrix.children[i][j] }));
    probes.push(`${p1[i].label} x ${p2[j].label}`);
  }
  applyTrendExtrapolation(matrix, result, trends);
  applyTrendTiebreak(matrix, result, trends);
  return { before, after: result.perSide.p2.map(row => row.ev), trends: [...trends.values()], probes };
}
const evs = (result: EvalResult) => result.perSide.p2.map(row => row.ev);

describe('the trend probe reads the cell from its base draws (round 70)', () => {
  test('a rolling cell: the layers book the mean over the draws, each child against its own leaf', () => {
    const reference = byHand(ROLLING, drawsProbe);
    const searched = evs(searchPosition(ROLLING, SETTINGS));
    expect(searched).toHaveLength(reference.after.length);
    searched.forEach((ev, index) => expect(ev).toBeCloseTo(reference.after[index], 9));
    // The layers did run on the rolling cell, and the probe of round 69 would have booked another trend there.
    expect(reference.probes).toEqual(['Focus Blast x → Skarmory', 'Focus Blast x → Skarmory']);
    expect(reference.after[0]).not.toBeCloseTo(reference.before[0], 2);
    const old = byHand(ROLLING, todaysProbe);
    expect(Math.abs(old.trends[0] - reference.trends[0])).toBeGreaterThan(0.05);
    expect(Math.abs(old.after[0] - reference.after[0])).toBeGreaterThan(0.02);
  });

  test('a cell priced by one draw keeps the probe of round 69: its child is the cell', () => {
    const old = byHand(SURE, todaysProbe);
    expect(old.probes).toEqual(['Shadow Ball x → Skarmory', 'Shadow Ball x → Skarmory']);
    // The layers did run on the cell, and the cell is priced by its first seed alone: the child against the cell is the child against its own leaf.
    expect(Math.abs(old.after[0] - old.before[0])).toBeGreaterThan(0.02);
    const cell = sampleCell(createRootPosition(SURE), 0, 'move shadowball', 'switch 2', 3, createMatchupCache(), true);
    expect(cell.baseDraws).toBeUndefined();
    const searched = evs(searchPosition(SURE, SETTINGS));
    expect(searched).toHaveLength(old.after.length);
    searched.forEach((ev, index) => expect(ev).toBeCloseTo(old.after[index], 9));
  });

  test('with one draw per cell the whole search is the search of round 69, rolling cells included', () => {
    for (const serialized of [ROLLING, SURE]) {
      const old = byHand(serialized, todaysProbe, 1);
      expect(old.probes.length).toBeGreaterThan(0);
      const searched = evs(searchPosition(serialized, { ...SETTINGS, samples: 1 }));
      expect(searched).toHaveLength(old.after.length);
      searched.forEach((ev, index) => expect(ev).toBeCloseTo(old.after[index], 12));
    }
  });

  test('the matrix reports the draws behind a cell: the leading seeds of a rolling cell, none for a cell of one draw', () => {
    const root = createRootPosition(ROLLING);
    const cache = createMatchupCache();
    const rolling = sampleCell(root, countFainted(positionBattle(root)), 'move focusblast', 'move splash', 3, cache, true);
    expect(rolling.baseDraws).toEqual([{ index: 0 }, { index: 1 }, { index: 2 }]);
    const sure = sampleCell(root, countFainted(positionBattle(root)), 'move substitute', 'move splash', 3, cache, true);
    expect(sure.baseDraws).toBeUndefined();
    const p1 = searchOptions(root, 'p1', { tera: false });
    const p2 = searchOptions(root, 'p2', { tera: false });
    const matrix = buildMatrix(root, p1, p2, 3, 1, undefined, { done: 0, total: 1 }, cache, true);
    const focus = p1.findIndex(option => option.choice === 'move focusblast');
    const splash = p2.findIndex(option => option.choice === 'move splash');
    expect(matrix.baseDraws.get(cellKey(focus, splash))).toEqual([{ index: 0 }, { index: 1 }, { index: 2 }]);
    expect(matrix.baseDraws.size).toBeLessThan(p1.length * p2.length);
  });

  test('a speed-tied cell reports both move orders, as the cell prices them', () => {
    const mirror = JSON.stringify(State.serializeBattle(battleOf('gen9customgame', [set('Machamp', ['closecombat', 'bulkup'])], [set('Machamp', ['closecombat', 'bulkup'])])));
    const root = createRootPosition(mirror);
    const cell = sampleCell(root, 0, 'move closecombat', 'move closecombat', 3, createMatchupCache(), true);
    const orders = (cell.baseDraws ?? []).map(draw => draw.first);
    expect(orders).toContain('p1');
    expect(orders).toContain('p2');
    expect((cell.baseDraws ?? []).every(draw => draw.index >= 0 && draw.index < SEARCH_SEEDS.length)).toBe(true);
  });

  test('a draw of a speed-tied cell replays its move order: the child is the one the cell priced', () => {
    // Equal Machamp, p1 at 1 HP: whoever moves first decides whether p1's Close Combat lands before p1 faints.
    const battle = battleOf('gen9customgame', [set('Machamp', ['closecombat', 'bulkup'])], [set('Machamp', ['closecombat', 'bulkup'])]);
    battle.sides[0].active[0]!.sethp(1);
    const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)));
    const p2Hp = (first: 'p1' | 'p2') => positionBattle(drawChild(root, 'move closecombat', 'move closecombat', { index: 0, first })).sides[1].pokemon[0].hp;
    const full = positionBattle(root).sides[1].pokemon[0].maxhp;
    expect(p2Hp('p1')).toBeLessThan(full);
    expect(p2Hp('p2')).toBe(full);
  });

  test('a probe job answers with the trend of the draw it names', async () => {
    const executor = createLocalExecutor(ROLLING);
    const order = benchOrder(ROLLING);
    const root = createRootPosition(order ? order.serialized : ROLLING);
    const cache = createMatchupCache();
    const job = (index: number) => ({
      i: 0, j: 0, p1Choice: 'move focusblast', p2Choice: 'move splash', settings: PROBE_SETTINGS, draw: { index },
    });
    const trends: number[] = [];
    for (const index of [0, 1, 2]) {
      const child = advancePosition(root, 'move focusblast', 'move splash', SEARCH_SEEDS[index]);
      const expected = subSearchDepth1(child.serialized, PROBE_SETTINGS, cache).score - leafValue(positionBattle(child), cache);
      const answer = await executor.subSearch(job(index));
      expect(answer.trend, `draw ${index}`).toBeCloseTo(expected, 12);
      trends.push(answer.trend!);
    }
    // A hit and a miss price the next ply differently: the draws are not the same child.
    expect(Math.abs(trends[0] - trends[1])).toBeGreaterThan(0.1);
    // A job without a draw is the sub-search it was: no trend.
    const plain = await executor.subSearch({ i: 0, j: 0, p1Choice: 'move focusblast', p2Choice: 'move splash', settings: PROBE_SETTINGS });
    expect(plain.trend).toBeUndefined();
  });
});
