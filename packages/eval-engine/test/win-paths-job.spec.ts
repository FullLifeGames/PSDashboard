import { describe, expect, test } from 'vitest';
import { searchPosition } from '../src/search/position';
import { luckPath } from '../src/endgame/win-paths/luck';
import { mistakeStep } from '../src/endgame/win-paths/mistake';
import { strongerStep } from '../src/endgame/win-paths/stronger';
import { WIN_STEPS, winPaths } from '../src/endgame/win-paths/index';
import type { WinStep } from '../src/endgame/win-paths/types';
import { mon, REQUEST, serializedBoard, won, playLine, type Board } from './win-paths-support';

/**
 * Round 89 (#130), step G8a: the job. `winPaths` runs the steps in their ruled order (a stronger play, luck, a mistake by the opponent),
 * each with a meter of its own, and reports each step the moment it is done. A step that throws leaves the others; the job writes into nothing it was not handed (the serialized position is
 * a string, a result of the search is equal with and without a job between two runs).
 */

/** High Jump Kick (90) against a faster Hydro Pump (80), both at 1 HP: a stronger play and a luck path both exist. */
const COIN: Board = {
  format: 'gen9customgame',
  p1: [mon('Snorlax', ['High Jump Kick'])],
  p2: [mon('Pikachu', ['Hydro Pump'])],
  prepare: battle => { battle.sides[0].pokemon[0].hp = 1; battle.sides[1].pokemon[0].hp = 1; },
};

/** Earthquake (spread) against two Pikachu at 1 HP that may Splash or Growl, as the doubles row of `win-paths-stronger.spec.ts`. */
const DOUBLES: Board = {
  format: 'gen9doublescustomgame',
  p1: [mon('Pikachu', ['Splash', 'Earthquake']), mon('Pidgeot', ['Splash'])],
  p2: [mon('Pikachu', ['Splash', 'Growl']), mon('Pikachu', ['Splash', 'Growl'])],
  prepare: battle => { battle.sides[1].pokemon[0].hp = 1; battle.sides[1].pokemon[1].hp = 1; },
};
const DOUBLES_ORDER = ['move splash, move splash', 'move earthquake, move splash'];

describe('the win-paths job', () => {
  test('the steps come in their ruled order, each reported when it is done', async () => {
    const { serialized } = await serializedBoard(COIN);
    const log: string[] = [];
    const runners = WIN_STEPS.map(runner => ({ ...runner, run: (...args: Parameters<typeof runner.run>) => { log.push(`run ${runner.kind}`); return runner.run(...args); } }));
    const result = winPaths(serialized, REQUEST('p1', { turn: 7, rootOrder: ['move highjumpkick'] }), step => log.push(`step ${step.kind} ${step.status}`), runners);
    expect(WIN_STEPS.map(runner => runner.kind)).toEqual(['stronger', 'luck', 'mistake']);
    expect(result.steps.map(step => step.kind)).toEqual(['stronger', 'luck', 'mistake']);
    // a step is reported before the next one starts
    expect(log).toEqual(['run stronger', 'step stronger found', 'run luck', 'step luck found', 'run mistake', 'step mistake none']);
    expect(result.side).toBe('p1');
    expect(result.turn).toBe(7);
  }, 240_000);

  test('each step has a meter of its own: the job spends what the step alone spends', async () => {
    const { serialized } = await serializedBoard(COIN);
    const request = REQUEST('p1', { rootOrder: ['move highjumpkick'] });
    const result = winPaths(serialized, request);
    expect(result.steps[0]).toEqual(strongerStep(serialized, request));
    expect(result.steps[1]).toEqual(luckPath(serialized, request));
    expect(result.steps[2]).toEqual(mistakeStep(serialized, request));
  }, 240_000);

  test('the third step is the mistake step: an opponent with one choice has no slip to make', async () => {
    const { serialized } = await serializedBoard(COIN);
    const third = winPaths(serialized, REQUEST('p1')).steps[2];
    expect(third).toMatchObject({ kind: 'mistake', status: 'none' });
    expect(third.line).toBeUndefined();
  }, 240_000);

  test('a step that throws leaves the others: it reads failed with the message, the rest run', async () => {
    const { serialized } = await serializedBoard(COIN);
    const seen: WinStep[] = [];
    const runners = WIN_STEPS.map(runner => runner.kind === 'stronger' ? { ...runner, run: () => { throw new Error('the prover broke'); } } : runner);
    const result = winPaths(serialized, REQUEST('p1'), step => seen.push(step), runners);
    expect(result.steps.map(step => step.status)).toEqual(['failed', 'found', 'none']);
    expect(result.steps[0]).toMatchObject({ kind: 'stronger', error: 'the prover broke', spent: { cells: 0, turns: 0 } });
    expect(seen).toEqual(result.steps);
  }, 240_000);

  test('a search result is equal with and without a job between two runs of it', async () => {
    const { serialized } = await serializedBoard(COIN);
    const settings = { depth: 1 as const, samples: 1, mode: 'matrix' as const, ruleset: 'standard' as const, tera: false };
    const before = JSON.stringify(searchPosition(serialized, settings));
    winPaths(serialized, REQUEST('p1', { rootOrder: ['move highjumpkick'] }));
    expect(JSON.stringify(searchPosition(serialized, settings))).toBe(before);
  }, 240_000);

  test('the job leaves the serialized position as it was (a string it only reads)', async () => {
    const { serialized } = await serializedBoard(COIN);
    const copy = `${serialized}`;
    winPaths(serialized, REQUEST('p1'));
    expect(serialized).toBe(copy);
  }, 240_000);
});

describe('the win-paths job, doubles', () => {
  test('the same order and the same lines: the stronger play wins under two seeds, luck reports its own meter', async () => {
    const { serialized } = await serializedBoard(DOUBLES);
    const seen: string[] = [];
    const result = winPaths(serialized, REQUEST('p1', { rootOrder: DOUBLES_ORDER, played: DOUBLES_ORDER[0] }), step => seen.push(step.kind));
    expect(seen).toEqual(['stronger', 'luck', 'mistake']);
    const stronger = result.steps[0];
    expect(stronger.status).toBe('found');
    expect(stronger.line!.choice).toBe('move earthquake, move splash');
    for (const seed of ['1,2,3,4', '905,17,333,4096']) expect(won(await playLine(DOUBLES, stronger.line!, seed), 'p1')).toBe(true);
    expect(result.steps[1]).toEqual(luckPath(serialized, REQUEST('p1', { rootOrder: DOUBLES_ORDER, played: DOUBLES_ORDER[0] })));
    expect(result.steps[2]).toEqual(mistakeStep(serialized, REQUEST('p1', { rootOrder: DOUBLES_ORDER, played: DOUBLES_ORDER[0] })));
  }, 240_000);
});
