import { test, expect, describe } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { calcSingleDamageRange, createBranchState, reconstructBranchRuntime } from '@fulllifegames/eval-engine';
import { buildTeamsFromReplay } from '@fulllifegames/replay-core';
import type { BranchMoveOption, SimPokemonInfo } from '../src/hooks/useBranch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixtureReplay = JSON.parse(
  readFileSync(join(__dirname, '..', 'e2e', 'fixtures', 'replay.json'), 'utf-8'),
);

const pikachu: SimPokemonInfo = {
  name: 'Pikachu',
  species: 'Pikachu',
  hp: 110,
  maxhp: 110,
  hpPercent: 100,
  status: '',
  fainted: false,
  isActive: true,
  activeSlot: 0,
  moves: [{ name: 'Thunderbolt', type: 'Electric' }],
  ability: 'Static',
  item: 'Light Ball',
  stats: { atk: 75, def: 60, spa: 70, spd: 70, spe: 110 },
  boosts: {},
  level: 50,
  types: ['Electric'],
};

const bulbasaur: SimPokemonInfo = {
  ...pikachu,
  name: 'Bulbasaur',
  species: 'Bulbasaur',
  maxhp: 120,
  hp: 120,
  types: ['Grass', 'Poison'],
};

const squirtle: SimPokemonInfo = {
  ...pikachu,
  name: 'Squirtle',
  species: 'Squirtle',
  maxhp: 124,
  hp: 124,
  types: ['Water'],
};

const thunderbolt: BranchMoveOption = {
  name: 'Thunderbolt',
  activeSlot: 0,
  slot: 1,
  pp: 24,
  maxpp: 24,
  disabled: false,
  type: 'Electric',
  targetType: 'normal',
  requiresTarget: true,
  targetOptions: [],
};

const earthquake: BranchMoveOption = {
  ...thunderbolt,
  name: 'Earthquake',
  type: 'Ground',
  pp: 16,
  maxpp: 16,
};

describe('target-specific damage previews', () => {
  test('calculates different preview ranges for different selected targets', () => {
    const intoBulbasaur = calcSingleDamageRange(pikachu, bulbasaur, thunderbolt);
    const intoSquirtle = calcSingleDamageRange(pikachu, squirtle, thunderbolt);

    expect(intoBulbasaur.moveName).toBe('Thunderbolt');
    expect(intoSquirtle.maxPercent).toBeGreaterThan(intoBulbasaur.maxPercent);
    expect(intoSquirtle.range).not.toBe(intoBulbasaur.range);
  });

  test('uses branch simulator EVs, IVs, and nature instead of default calc spreads', () => {
    const garchomp = {
      ...pikachu,
      name: 'Garchomp',
      species: 'Garchomp',
      maxhp: 420,
      hp: 420,
      ability: '',
      item: '',
      level: 100,
      stats: { atk: 359, def: 226, spa: 196, spd: 207, spe: 240 },
      types: ['Dragon', 'Ground'],
      nature: 'Hardy',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    } as SimPokemonInfo;
    const kingambit = {
      ...bulbasaur,
      name: 'Kingambit',
      species: 'Kingambit',
      maxhp: 404,
      hp: 404,
      ability: '',
      item: '',
      level: 100,
      stats: { atk: 369, def: 276, spa: 156, spd: 207, spe: 136 },
      types: ['Dark', 'Steel'],
      nature: 'Hardy',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    } as SimPokemonInfo;

    const result = calcSingleDamageRange(garchomp, kingambit, earthquake);

    expect(result.range).toBe('69.8% - 82.2%');
  });

  test('keeps normal STAB damage for reconstructed Pokémon that have not Terastallized', async () => {
    const { p1Team, p2Team } = buildTeamsFromReplay(fixtureReplay.log);
    const runtime = await reconstructBranchRuntime({
      format: fixtureReplay.formatid,
      p1Team,
      p2Team,
      replayLog: fixtureReplay.log,
      targetTurn: 1,
    });
    const state = createBranchState(runtime.battleStream, runtime.log, { p1Choices: [], p2Choices: [] });
    const earthquakeMove = state.p1Moves.find(move => move.name === 'Earthquake');
    expect(earthquakeMove).toBeTruthy();

    const result = calcSingleDamageRange(state.p1Active!, state.p2Active!, earthquakeMove!);

    expect(result.range).toBe('69.8% - 82.2%');
  });

  test('applies doubles spread damage reduction when requested', () => {
    const garchomp = {
      ...pikachu,
      name: 'Garchomp',
      species: 'Garchomp',
      level: 50,
      maxhp: 183,
      hp: 183,
      ability: '',
      item: '',
      stats: { atk: 182, def: 115, spa: 90, spd: 105, spe: 122 },
      types: ['Dragon', 'Ground'],
      nature: 'Hardy',
      evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    } as SimPokemonInfo;
    const kingambit = {
      ...bulbasaur,
      name: 'Kingambit',
      species: 'Kingambit',
      level: 50,
      maxhp: 207,
      hp: 207,
      ability: '',
      item: '',
      stats: { atk: 155, def: 140, spa: 80, spd: 105, spe: 70 },
      types: ['Dark', 'Steel'],
      nature: 'Hardy',
      evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    } as SimPokemonInfo;

    const singles = calcSingleDamageRange(garchomp, kingambit, earthquake, { gameType: 'Singles' });
    const doubles = calcSingleDamageRange(garchomp, kingambit, earthquake, { gameType: 'Doubles' });

    expect(singles.range).toBe('72.5% - 85%');
    expect(doubles.range).toBe('53.1% - 63.8%');
  });
});
