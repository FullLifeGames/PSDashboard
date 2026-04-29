import { test, expect } from '@playwright/test';
import { calcSingleDamageRange } from '../src/lib/damage-calc';
import type { BranchMoveOption, SimPokemonInfo } from '../src/hooks/useBranch';

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

test.describe('target-specific damage previews', () => {
  test('calculates different preview ranges for different selected targets', () => {
    const intoBulbasaur = calcSingleDamageRange(pikachu, bulbasaur, thunderbolt);
    const intoSquirtle = calcSingleDamageRange(pikachu, squirtle, thunderbolt);

    expect(intoBulbasaur.moveName).toBe('Thunderbolt');
    expect(intoSquirtle.maxPercent).toBeGreaterThan(intoBulbasaur.maxPercent);
    expect(intoSquirtle.range).not.toBe(intoBulbasaur.range);
  });
});
