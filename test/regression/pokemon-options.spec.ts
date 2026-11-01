import { test, expect, describe } from 'vitest';
import {
  NATURES,
  getAbilityPool,
  getEveryAbilityPool,
  getEveryMovePool,
  getItemPool,
  getMovePool,
  getTeraTypePool,
} from '../../src/lib/pokemon-options';

describe('legal option pools', () => {
  test('move pool contains gen-legal moves and excludes illegal ones', async () => {
    const garchomp = await getMovePool('Garchomp', 9);
    expect(garchomp).toContain('Earthquake');
    expect(garchomp).toContain('Flamethrower');
    expect(garchomp).not.toContain('Spore');

    const gen3Machoke = await getMovePool('Machoke', 3);
    expect(gen3Machoke).toContain('Low Kick');
    expect(gen3Machoke).not.toContain('Scale Shot');
  });

  test('unknown species falls back to the full gen move list instead of blocking', async () => {
    const pool = await getMovePool('Definitely Not A Pokemon', 9);
    expect(pool.length).toBeGreaterThan(500);
    expect(pool).toContain('Tackle');
  });

  test('ability pool lists the species abilities and is empty before gen 3', () => {
    expect(getAbilityPool('Garchomp', 9).sort()).toEqual(['Rough Skin', 'Sand Veil']);
    expect(getAbilityPool('Machoke', 2)).toEqual([]);
  });

  // Round 83 (T308, GitHub issue #2): the editor takes a move or an ability the species cannot have, so it needs the
  // generation's whole list next to the species' own pool.
  test('the whole move list of a generation holds what the species cannot learn and nothing the Dex does not know', () => {
    const gen9 = getEveryMovePool(9);
    expect(gen9).toEqual(expect.arrayContaining(['Spore', 'Power Whip', 'Earthquake']));
    expect(gen9).not.toContain('Moon Landing');
    expect(new Set(gen9).size).toBe(gen9.length);
    expect(getEveryMovePool(3)).toContain('Spore');
    expect(getEveryMovePool(3)).not.toContain('Scale Shot');
    expect(getEveryMovePool(1)).toContain('Tackle');
  });

  test('the whole ability list of a generation holds every ability, and is empty before gen 3', () => {
    expect(getEveryAbilityPool(9)).toEqual(expect.arrayContaining(['Intimidate', 'Rough Skin']));
    expect(getEveryAbilityPool(9)).not.toContain('Foo Bar');
    expect(getEveryAbilityPool(3)).toContain('Intimidate');
    expect(getEveryAbilityPool(2)).toEqual([]);
    expect(getEveryAbilityPool(1)).toEqual([]);
  });

  test('item pool is gen-aware', () => {
    expect(getItemPool(9)).toContain('Choice Band');
    expect(getItemPool(3)).toContain('Leftovers');
    expect(getItemPool(3)).not.toContain('Choice Specs');
    expect(getItemPool(1)).toEqual([]);
  });

  test('tera types exist only in gen 9 and natures are the fixed 25', () => {
    const tera = getTeraTypePool(9);
    expect(tera).toContain('Steel');
    expect(tera).toContain('Stellar');
    expect(getTeraTypePool(8)).toEqual([]);
    expect(NATURES).toHaveLength(25);
    expect(NATURES).toContain('Jolly');
  });
});
