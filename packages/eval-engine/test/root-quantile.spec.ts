import { describe, expect, test } from 'vitest';
import { advancePositionWithLog, positionBattle } from '../src/forward-model';
import { QuantileSink } from '../src/forward/scripted-prng';
import { loadSimMods } from '../src/forward/sim-mods';
import type { DieName, Draw } from '../src/dice/types';
import { drawKeyed } from '../src/pair/draw';
import { cellHash, RootQuantiles, rootSalt, type DieQuantiles } from '../src/search/root-quantile';
import { RULES } from './dice-fixtures';
import { sweepBoard } from './dice-sweep-support';
import { rootOf } from './secondary-classes-support';

/**
 * Round 89 (#59, T322 block 1), A3 stage 1: the stratifier. Tree k of T answers each named die of a root draw with
 * `U = (pi_d(k) + u_d) / T` (ruling 9 of 09.11.2026): `pi_d` is the die's own order of the T quarters, `u_d` a hash. Rows: (a1) each
 * single die over 1,000 salts, (a2) the joint strands of two dice, (a3) the answer stays in the draw's range, (a4) both PRNGs
 * give the plain advance when the quantiles answer nothing, (a5) both PRNGs take a quantile's answer and the records carry it.
 */
await loadSimMods('gen9championsou');

const TREES = 4;
const SALTS = 1000;
const OFFSETS = [0, 1, 2, 3];
const die = (slot: string, kind: DieName['kind'] = 'accuracy'): DieName => ({ slot, moveId: 'testmove', targetSlot: 'p2a', kind });
const chance = (numerator: number, denominator: number): Draw => ({ call: 'chance', from: denominator, numerator });
const salts = Array.from({ length: SALTS }, (_, index) => rootSalt(`position ${index}`));
const cellOf = (salt: number): number => cellHash(salt, 'move 1', 'move 1');
const quantilesOf = (salt: number, offset: number): RootQuantiles => new RootQuantiles(cellOf(salt), offset, TREES);

/** What the four trees of one salt answer to a list of dice (a tree asks in the order of the list). */
function treesOf<T>(salt: number, ask: (quantiles: RootQuantiles) => T): T[] {
  return OFFSETS.map(offset => ask(quantilesOf(salt, offset)));
}
const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

describe('(a1) each single die is stratified over the four trees', () => {
  test.each([0.1, 0.3, 0.5, 0.85])('a chance of %s: the frequency, and the count of trees with a yes per salt', p => {
    const counts = salts.map(salt => treesOf(salt, quantiles => quantiles.answer(die('p1a'), chance(Math.round(p * 100), 100)) as boolean).filter(Boolean).length);
    expect(Math.abs(mean(counts) / TREES - p)).toBeLessThan(0.03);
    for (const count of counts) expect([Math.floor(TREES * p), Math.ceil(TREES * p)]).toContain(count);
    // a die of one quarter or more is never missed by all four trees
    if (p >= 1 / TREES) expect(counts.every(count => count >= 1)).toBe(true);
  });

  test('random(16): every value near 1/16, and the four trees take the four quarters of the range, one each', () => {
    const histogram = new Array<number>(16).fill(0);
    for (const salt of salts) {
      const values = treesOf(salt, quantiles => quantiles.answer(die('p1a', 'damage-roll'), { call: 'random', from: 16 }) as number);
      for (const value of values) histogram[value]++;
      expect(values.map(value => Math.floor(value / 4)).sort()).toEqual([0, 1, 2, 3]);
    }
    for (const count of histogram) expect(Math.abs(count / (SALTS * TREES) - 1 / 16)).toBeLessThan(0.03);
  });

  test('the same salt and offset answer the same, another cell or another die answers differently', () => {
    const draw = chance(30, 100);
    const first = salts.map(salt => quantilesOf(salt, 1).answer(die('p1a'), draw));
    expect(salts.map(salt => quantilesOf(salt, 1).answer(die('p1a'), draw))).toEqual(first);
    const other = salts.map(salt => new RootQuantiles(cellHash(salt, 'move 2', 'move 1'), 1, TREES).answer(die('p1a'), draw));
    const elsewhere = salts.map(salt => quantilesOf(salt, 1).answer(die('p2a'), draw));
    expect(other).not.toEqual(first);
    expect(elsewhere).not.toEqual(first);
  });

  test('a second occurrence of one die has its own unit: stratified, and not always the same quarter as the first', () => {
    let alike = 0;
    for (const salt of salts) {
      const rolls = treesOf(salt, quantiles => [0, 1].map(() => quantiles.answer(die('p1a', 'damage-roll'), { call: 'random', from: 16 }) as number));
      for (const index of [0, 1]) expect(rolls.map(roll => Math.floor(roll[index] / 4)).sort()).toEqual([0, 1, 2, 3]);
      alike += rolls.filter(roll => Math.floor(roll[0] / 4) === Math.floor(roll[1] / 4)).length;
    }
    // independent permutations agree on 1 tree in 4
    expect(Math.abs(alike / (SALTS * TREES) - 1 / TREES)).toBeLessThan(0.03);
  });
});

describe('(a2) the joint strands of two dice get trees by their chance', () => {
  /** Mean number of trees per salt whose answers to dice A and B are (a, b). */
  function strand(pa: number, pb: number, a: boolean, b: boolean): number {
    const counts = salts.map(salt => treesOf(salt, quantiles => [
      quantiles.answer(die('p1a'), chance(pa, 100)) as boolean, quantiles.answer(die('p2a'), chance(pb, 100)) as boolean,
    ]).filter(([x, y]) => x === a && y === b).length);
    return mean(counts);
  }

  test('two dice of 50 percent: each of the four strands has 1.0 trees on average (the form U = (k + u) / 4 reads 0, 0, 2, 2)', () => {
    for (const a of [true, false]) {
      for (const b of [true, false]) expect(Math.abs(strand(50, 50, a, b) - 1)).toBeLessThan(0.05);
    }
  });

  test('two moves of 85 percent (Doubles OU): one misses 1.02 trees, both miss 0.09', () => {
    // A hits, B misses and the other way round
    const oneMisses = strand(85, 85, true, false) + strand(85, 85, false, true);
    expect(Math.abs(oneMisses - 4 * 2 * 0.85 * 0.15)).toBeLessThan(0.05);
    expect(Math.abs(strand(85, 85, false, false) - 4 * 0.15 * 0.15)).toBeLessThan(0.05);
  });
});

describe('(a3) the answer stays in the draw, and what the quantiles leave to the stream they leave', () => {
  const answers = (draw: Draw, name = die('p1a', 'damage-roll')): (number | boolean | undefined)[] =>
    salts.flatMap(salt => treesOf(salt, quantiles => quantiles.answer(name, draw)));

  test.each([
    ['random(16)', { call: 'random', from: 16 }, 0, 16],
    ['random(217, 256)', { call: 'random', from: 217, to: 256 }, 217, 256],
    ['random(100)', { call: 'random', from: 100 }, 0, 100],
    ['random(1)', { call: 'random', from: 1 }, 0, 1],
    ['random(2, 5)', { call: 'random', from: 2, to: 5 }, 2, 5],
    ['sample of 5 items', { call: 'sample', from: 5, items: [1, 2, 3, 4, 5] }, 0, 5],
  ] as [string, Draw, number, number][])('%s', (_label, draw, from, to) => {
    for (const value of answers(draw)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value as number).toBeGreaterThanOrEqual(from);
      expect(value as number).toBeLessThan(to);
    }
  });

  test('a chance of 0 never comes true, a chance of 1 always does', () => {
    expect(new Set(answers(chance(0, 100), die('p1a')))).toEqual(new Set([false]));
    expect(new Set(answers(chance(100, 100), die('p1a')))).toEqual(new Set([true]));
    expect(new Set(answers(chance(1, 1), die('p1a')))).toEqual(new Set([true]));
  });

  test('a bare random(), a shuffle and a tree outside the quarters answer nothing', () => {
    expect(new Set(answers({ call: 'random' }))).toEqual(new Set([undefined]));
    expect(new Set(answers({ call: 'shuffle', from: 0, to: 2 }))).toEqual(new Set([undefined]));
    for (const offset of [-1, TREES, TREES + 3]) {
      expect(new RootQuantiles(cellOf(salts[0]), offset, TREES).answer(die('p1a'), chance(30, 100))).toBeUndefined();
    }
  });
});

const GEN9 = RULES.find(rules => rules.name === 'Gen 9')!;
const STOP_EARLY: DieQuantiles = { answer: () => undefined };
const stampless = (log: readonly string[]): string[] => log.filter(line => !line.startsWith('|t:|'));
const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16'];
const CLICKS = {
  singles: { p1: 'move thunder', p2: 'move splash' },
  doubles: { p1: 'move thunder 1, move splash', p2: 'move splash, move splash' },
} as const;

/** One singles root draw under a quantile sink (the real PRNG path: `forkBattle` builds the `ScriptedPRNG` for any sink). */
function singlesDraw(quantiles: DieQuantiles | null, seed: string) {
  const board = sweepBoard(GEN9, 'thunder', 'singles');
  const sink = quantiles ? new QuantileSink(quantiles) : undefined;
  const drawn = advancePositionWithLog(rootOf(board), CLICKS.singles.p1, CLICKS.singles.p2, seed as never, sink ? { scripts: sink } : undefined);
  return { log: stampless(drawn.log), sink };
}

function doublesDraw(quantiles: DieQuantiles | undefined, seed: string) {
  const board = sweepBoard(GEN9, 'thunder', 'doubles');
  return drawKeyed(rootOf(board), CLICKS.doubles.p1, CLICKS.doubles.p2, seed as never, false, quantiles);
}

describe('(a4) quantiles that answer nothing give the plain advance, both PRNGs', () => {
  test.each(SEEDS)('singles, seed %s: log and stream', seed => {
    const plain = singlesDraw(null, seed);
    expect(singlesDraw(STOP_EARLY, seed).log).toEqual(plain.log);
    expect(singlesDraw(new RootQuantiles(1, TREES, TREES), seed).log).toEqual(plain.log);
  });

  test.each(SEEDS)('doubles, seed %s: log, records and stream', seed => {
    const plain = doublesDraw(undefined, seed);
    for (const quantiles of [STOP_EARLY, new RootQuantiles(1, TREES, TREES)]) {
      const stopped = doublesDraw(quantiles, seed);
      expect(stampless(stopped.log)).toEqual(stampless(plain.log));
      expect(stopped.records.map(({ kind }) => kind)).toEqual(plain.records.map(({ kind }) => kind));
    }
  });
});

/** A quantile that answers the accuracy and the secondary die as asked and leaves every other draw to the stream. */
const asking = (hit: boolean, secondary: boolean): DieQuantiles => ({
  answer(name, draw) {
    if (name.kind === 'accuracy' && draw.call === 'chance') return hit;
    if (name.kind === 'secondary') return draw.call === 'chance' ? secondary : (secondary ? 0 : (draw.from ?? 100) - 1);
    return undefined;
  },
});

describe('(a5) a quantile answer replaces the natural number, and the records carry what the battle did', () => {
  test.each(SEEDS)('singles, seed %s: a miss and a hit; the paralysis die lands in the sink', seed => {
    const missed = singlesDraw(asking(false, true), seed);
    expect(missed.log.some(line => line.startsWith('|-miss|'))).toBe(true);
    const paralysed = singlesDraw(asking(true, true), seed);
    expect(paralysed.log.some(line => line.startsWith('|-miss|'))).toBe(false);
    expect(paralysed.log.some(line => line.startsWith('|-status|p2a') && line.endsWith('|par'))).toBe(true);
    expect(paralysed.sink!.secondaries.map(record => record.happened)).toEqual([true]);
    const spared = singlesDraw(asking(true, false), seed);
    expect(spared.log.some(line => line.startsWith('|-status|p2a'))).toBe(false);
    expect(spared.sink!.secondaries.map(record => record.happened)).toEqual([false]);
  });

  test.each(SEEDS)('doubles, seed %s: a miss and a hit; the records name the result', seed => {
    const missed = doublesDraw(asking(false, true), seed);
    expect(missed.log.some(line => line.startsWith('|-miss|'))).toBe(true);
    expect(missed.records.filter(record => record.kind === 'accuracy').map(record => (record as { hit: boolean }).hit)).toEqual([false]);
    const paralysed = doublesDraw(asking(true, true), seed);
    expect(paralysed.log.some(line => line.startsWith('|-status|p2a') && line.endsWith('|par'))).toBe(true);
    expect(paralysed.records.filter(record => record.kind === 'accuracy').map(record => (record as { hit: boolean }).hit)).toEqual([true]);
    expect(paralysed.records.filter(record => record.kind === 'secondary').map(record => (record as { happened: boolean }).happened)).toEqual([true]);
    const spared = doublesDraw(asking(true, false), seed);
    expect(spared.records.filter(record => record.kind === 'secondary').map(record => (record as { happened: boolean }).happened)).toEqual([false]);
  });

  test.each(SEEDS)('seed %s: an answer equal to the natural one leaves the child on the plain stream (the natural number is drawn first)', seed => {
    const board = sweepBoard(GEN9, 'thunder', 'singles');
    const seedAfter = (quantiles: DieQuantiles | null): string => {
      const sink = quantiles ? new QuantileSink(quantiles) : undefined;
      const { child } = advancePositionWithLog(rootOf(board), CLICKS.singles.p1, CLICKS.singles.p2, seed as never, sink ? { scripts: sink } : undefined);
      return String(positionBattle(child).prng.getSeed());
    };
    const hit = !singlesDraw(null, seed).log.some(line => line.startsWith('|-miss|'));
    const accuracyOnly: DieQuantiles = { answer: (name, draw) => (name.kind === 'accuracy' && draw.call === 'chance' ? hit : undefined) };
    expect(seedAfter(accuracyOnly)).toBe(seedAfter(null));
  });
});
