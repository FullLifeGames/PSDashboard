import { describe, expect, test } from 'vitest';
import type { EvalLine, EvalMatrix, EvalResult, ForcedWin, RankedChoice } from '../src/types';
import { blendValues, blendWorlds } from '../src/branch/bring-worlds';

/**
 * Round 89 (#124, stage 2): the blend of the worlds of a short-side game. Each world is solved under perfect information (ADR
 * 0013); the game's value is the weighted mean over the worlds. Units on hand-made results, no simulator: one world is returned
 * as it came (pinned and bring-all games stay byte-identical), several give the weighted mean with the heaviest world as the
 * frame. The scenes of the real games are in bring-worlds-scenes.spec.ts. Singles and doubles share the one rule: the choice
 * strings are opaque ids here.
 */
const row = (choice: string, ev: number, extra: Partial<RankedChoice> = {}): RankedChoice => ({
  choice, label: choice.toUpperCase(), worstCase: ev - 0.1, expected: ev - 0.05, ev, punishedBy: 'reply', ...extra,
});

function result(over: Partial<EvalResult> = {}): EvalResult {
  return {
    score: 0.2, interval: 0.1, depthCompleted: 2, gameValue: 0.2,
    perSide: { p1: [row('a', 0.3), row('b', 0.1)], p2: [row('x', -0.2), row('y', -0.4)] },
    ...over,
  };
}

const forced = (side: 'p1' | 'p2'): ForcedWin => ({ side, turns: 2, mass: 1, caveat: 'none', engineScore: 0.5, states: 10 });

describe('blendValues', () => {
  test('one value comes back exactly, whatever its weight', () => {
    expect(blendValues([0.1 + 0.2], [0.37])).toBe(0.1 + 0.2);
    expect(blendValues([-0.7], [1])).toBe(-0.7);
  });

  test('the weighted mean, normalized by the weights that are present', () => {
    expect(blendValues([1, 0], [0.75, 0.25])).toBeCloseTo(0.75, 12);
    // Weights that do not sum to 1 (a world dropped out): the mean renormalizes.
    expect(blendValues([1, 0, 0.5], [0.3, 0.1, 0.1])).toBeCloseTo((0.3 + 0.05) / 0.5, 12);
  });
});

describe('blendWorlds', () => {
  test('one world returns the same object: pinned and bring-all games stay byte-identical', () => {
    const only = result();
    expect(blendWorlds([only], [1])).toBe(only);
    expect(blendWorlds([only], [0.4])).toBe(only);
  });

  test('score, interval and gameValue are weighted means, depthCompleted the minimum', () => {
    const blended = blendWorlds([
      result({ score: 0.4, interval: 0.2, gameValue: 0.5, depthCompleted: 3 }),
      result({ score: -0.4, interval: 0.6, gameValue: -0.3, depthCompleted: 2 }),
    ], [0.75, 0.25]);
    expect(blended.score).toBeCloseTo(0.2, 12);
    expect(blended.interval).toBeCloseTo(0.3, 12);
    expect(blended.gameValue).toBeCloseTo(0.3, 12);
    expect(blended.depthCompleted).toBe(2);
  });

  test('gameValue and trend appear only when every world has them', () => {
    const missing = blendWorlds([result({ gameValue: 0.5, trend: 0.1 }), result({ gameValue: undefined, trend: 0.3 })], [0.5, 0.5]);
    expect(missing.gameValue).toBeUndefined();
    expect(missing.trend).toBeCloseTo(0.2, 12);
    const none = blendWorlds([result({ trend: 0.1 }), result({ trend: undefined })], [0.5, 0.5]);
    expect(none.trend).toBeUndefined();
    expect('trend' in none).toBe(false);
  });

  test('the heaviest world is the frame, whatever its place in the list', () => {
    const light = result({ score: 0, engine: { id: 'light', name: 'light' }, perSide: { p1: [row('a', 0.3, { label: 'Light A', punishedBy: 'light reply' })], p2: [] } });
    const heavy = result({ score: 0, engine: { id: 'heavy', name: 'heavy' }, perSide: { p1: [row('a', 0.1, { label: 'Heavy A', punishedBy: 'heavy reply', line: [{ p1: 'a', p2: 'x' }] })], p2: [] } });
    const blended = blendWorlds([light, heavy], [0.3, 0.7]);
    expect(blended.engine?.id).toBe('heavy');
    expect(blended.perSide.p1[0].label).toBe('Heavy A');
    expect(blended.perSide.p1[0].punishedBy).toBe('heavy reply');
    expect(blended.perSide.p1[0].line).toEqual([{ p1: 'a', p2: 'x' }]);
    expect(blended.perSide.p1[0].ev).toBeCloseTo(0.3 * 0.3 + 0.7 * 0.1, 12);
    expect(blended.perSide.p1[0].worstCase).toBeCloseTo(0.3 * 0.2 + 0.7 * 0, 12);
    expect(blended.perSide.p1[0].expected).toBeCloseTo(0.3 * 0.25 + 0.7 * 0.05, 12);
  });

  test('a row one world lacks blends over the worlds that hold it; a row only a lighter world ranks is dropped; the rows re-sort by the blended ev', () => {
    const heavy = result({ perSide: { p1: [row('a', 0.2), row('b', 0.1), row('c', 0.05)], p2: [row('x', -0.1)] } });
    const light = result({ perSide: { p1: [row('b', 0.9), row('a', 0), row('d', 0.99)], p2: [row('x', -0.1)] } });
    const blended = blendWorlds([light, heavy], [0.4, 0.6]);
    // a: 0.12, b: 0.06 + 0.36 = 0.42, c: only the heavy world holds it, so its own 0.05; d: only the light world, dropped.
    expect(blended.perSide.p1.map(entry => entry.choice)).toEqual(['b', 'a', 'c']);
    expect(blended.perSide.p1.map(entry => entry.ev)).toEqual([expect.closeTo(0.42, 12), expect.closeTo(0.12, 12), expect.closeTo(0.05, 12)]);
  });

  test('lines (round 89, #104): the engine line is the line of the blended best row, from whichever world holds it; the played line stays', () => {
    const line = (side: 'p1' | 'p2', label: string, roles: EvalLine['for'], end: number): EvalLine =>
      ({ side, label, choice: label.toLowerCase(), for: roles, visits: 10, end, endFainted: 0, steps: [] });
    const heavy = result({
      perSide: { p1: [row('a', 0.3), row('b', 0.25)], p2: [row('x', -0.2), row('y', -0.4)] },
      lines: [line('p1', 'A', ['engine'], 0.31), line('p2', 'X', ['engine', 'played'], -0.2)],
    });
    const light = result({
      perSide: { p1: [row('b', 0.6), row('a', 0)], p2: [row('x', -0.2), row('y', -0.4)] },
      lines: [line('p1', 'B', ['engine'], 0.61), line('p1', 'A', ['played'], 0.01), line('p2', 'X', ['engine'], -0.19)],
    });
    const blended = blendWorlds([heavy, light], [0.6, 0.4]);
    expect(blended.perSide.p1[0].label).toBe('B');
    // p1: the blended best row B has its line from the light world; the heavy world's line of A (its own best) is not the engine's any more
    // and it was not played, so it goes; the light world's played line of A stays. p2: the engine row X keeps the heavy world's line.
    const seen = [...(blended.lines ?? [])].sort((a, b) => a.side.localeCompare(b.side) || a.label.localeCompare(b.label));
    expect(seen.map(entry => [entry.side, entry.label, entry.for, entry.end])).toEqual([
      ['p1', 'A', ['played'], 0.01], ['p1', 'B', ['engine'], 0.61], ['p2', 'X', ['engine', 'played'], -0.2],
    ]);
    // no world held a line: none appears
    expect(blendWorlds([result(), result()], [0.6, 0.4]).lines).toBeUndefined();
    // the worlds that hold a line but none of the blended best row's: the result has the played lines only, or none
    const onlyHeavy = blendWorlds([heavy, result({ perSide: light.perSide })], [0.6, 0.4]);
    expect(onlyHeavy.lines?.every(entry => entry.for.includes('played') || entry.label === onlyHeavy.perSide[entry.side][0].label)).toBe(true);
  });

  test('equal blended evs keep the heaviest world\'s order', () => {
    const heavy = result({ perSide: { p1: [row('a', 0.3), row('b', 0.3), row('c', 0.1)], p2: [] } });
    const light = result({ perSide: { p1: [row('c', 0.1), row('b', 0.3), row('a', 0.3)], p2: [] } });
    expect(blendWorlds([light, heavy], [0.2, 0.8]).perSide.p1.map(entry => entry.choice)).toEqual(['a', 'b', 'c']);
  });

  test('the matrix keeps the heaviest world\'s rows and columns; cells blend by choice id with summed visits', () => {
    const matrix = (p1: string[], p2: string[], values: number[][], verified: boolean[][], p1Mix: number[], p2Mix: number[]): EvalMatrix => ({
      p1Labels: p1.map(id => id.toUpperCase()), p2Labels: p2.map(id => id.toUpperCase()), p1Choices: p1, p2Choices: p2, values,
      mixes: { p1: p1Mix, p2: p2Mix },
      cells: values.map((line, i) => line.map((_, j) => ({ visits: 10 * (i + 1) + j, verified: verified[i][j] }))),
    });
    const heavy = result({ matrix: matrix(['a', 'b'], ['x', 'y'], [[0.4, 0.2], [0, -0.2]], [[true, true], [true, false]], [0.75, 0.25], [0.5, 0.5]) });
    // The light world lists its rows in another order and holds a column the frame lacks.
    const light = result({ matrix: matrix(['b', 'a'], ['y', 'x', 'z'], [[0.8, 0.6, 0.1], [0.4, 0, 0.3]], [[true, true, true], [true, true, true]], [0.5, 0.5], [0.2, 0.2, 0.6]) });
    const blended = blendWorlds([light, heavy], [0.25, 0.75]).matrix!;
    expect(blended.p1Choices).toEqual(['a', 'b']);
    expect(blended.p2Choices).toEqual(['x', 'y']);
    expect(blended.p1Labels).toEqual(['A', 'B']);
    // Cell (a, x): heavy 0.4 (0.75), light row a col x = values[1][1] = 0 (0.25).
    expect(blended.values[0][0]).toBeCloseTo(0.3, 12);
    // Cell (b, y): heavy -0.2, light row b col y = values[0][0] = 0.8.
    expect(blended.values[1][1]).toBeCloseTo(0.75 * -0.2 + 0.25 * 0.8, 12);
    // Visits add up (heavy cell (a,x) = 10, light cell (a,x) = cells[1][1] = 21), verified only when every holder verified.
    expect(blended.cells![0][0].visits).toBe(10 + 21);
    expect(blended.cells![0][0].verified).toBe(true);
    expect(blended.cells![1][1].verified).toBe(false);
    // Mixes: the weighted mean per id over the holders, renormalized to 1.
    const p1Raw = [0.75 * 0.75 + 0.25 * 0.5, 0.75 * 0.25 + 0.25 * 0.5];
    expect(blended.mixes.p1).toEqual(p1Raw.map(share => expect.closeTo(share / (p1Raw[0] + p1Raw[1]), 12)));
    expect(blended.mixes.p1[0] + blended.mixes.p1[1]).toBeCloseTo(1, 12);
    expect(blended.mixes.p2[0] + blended.mixes.p2[1]).toBeCloseTo(1, 12);
  });

  test('forcedWin stays only when every world proves one for the same side', () => {
    const same = blendWorlds([result({ forcedWin: forced('p1') }), result({ forcedWin: forced('p1') })], [0.7, 0.3]);
    expect(same.forcedWin?.side).toBe('p1');
    const split = blendWorlds([result({ forcedWin: forced('p1') }), result({ forcedWin: forced('p2') })], [0.7, 0.3]);
    expect(split.forcedWin).toBeUndefined();
    const open = blendWorlds([result({ forcedWin: forced('p1') }), result()], [0.7, 0.3]);
    expect(open.forcedWin).toBeUndefined();
    expect('forcedWin' in open).toBe(false);
  });
});
