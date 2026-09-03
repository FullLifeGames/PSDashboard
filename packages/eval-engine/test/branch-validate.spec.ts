import { test, expect } from '@playwright/test';
import type { PokemonSet } from '@pkmn/sim';
import { reconstructBranchRuntime, validateBranchRuntime } from '../src/branch-engine';

const p1Team: PokemonSet[] = [
  {
    name: 'Pikachu',
    species: 'Pikachu',
    item: 'Light Ball',
    ability: 'Static',
    moves: ['Thunderbolt', 'Protect'],
    nature: 'Timid',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
];

const p2Team: PokemonSet[] = [
  {
    name: 'Bulbasaur',
    species: 'Bulbasaur',
    item: 'Eviolite',
    ability: 'Overgrow',
    moves: ['Vine Whip', 'Protect'],
    nature: 'Modest',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  },
];

const twoTurnLog = [
  '|switch|p1a: Pikachu|Pikachu, L50|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
  '|turn|1',
  '|move|p1a: Pikachu|Thunderbolt|p2a: Bulbasaur',
  '|-damage|p2a: Bulbasaur|60/100',
  '|move|p2a: Bulbasaur|Vine Whip|p1a: Pikachu',
  '|-damage|p1a: Pikachu|80/100',
  '|upkeep',
  '|turn|2',
].join('\n');

test.describe('branch runtime validation (B7/B17)', () => {
  test('accepts a healthy reconstruction', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: twoTurnLog,
      targetTurn: 1,
    });
    expect(validateBranchRuntime(runtime)).toBeNull();
  });

  test('flags reconstructions that hit the overall deadline', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: twoTurnLog,
      targetTurn: 2,
      deadlineMs: 0,
    });
    expect(runtime.timedOut).toBe(true);
    expect(validateBranchRuntime(runtime)).toContain('timed out');
  });

  test('reports progress while replaying towards the target turn', async () => {
    const progress: [number, number][] = [];
    await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: twoTurnLog,
      targetTurn: 2,
      onProgress: (turn, targetTurn) => progress.push([turn, targetTurn]),
    });
    expect(progress).toContainEqual([1, 2]);
  });

  test('stops replaying when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: twoTurnLog,
      targetTurn: 2,
      abort: controller.signal,
    });
    // The replay loop never ran, so the battle is still on turn 1.
    expect(runtime.battleStream.battle?.turn).toBe(1);
  });
});
