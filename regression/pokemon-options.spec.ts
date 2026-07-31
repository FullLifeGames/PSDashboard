import { test, expect } from '@playwright/test';
import {
  NATURES,
  getAbilityPool,
  getItemPool,
  getMovePool,
  getTeraTypePool,
} from '../src/lib/pokemon-options';

test.describe('legal option pools', () => {
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
