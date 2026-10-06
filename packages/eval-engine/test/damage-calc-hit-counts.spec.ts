import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { hitCounts, type HitCount } from '../src/damage-calc';
import { set } from './move-oracle';
import { battleOf, powerInTurn } from './power-oracle';

/**
 * T124 point 3: the hit counts the preview prices are the ones the
 * simulator's hit loop draws (battle-actions hitStepMoveHitLoop). Its rules
 * live inline there, so damage-calc mirrors them, and this checker holds the
 * mirror against the simulator: the array the loop samples in a real turn of
 * every generation, the counts Loaded Dice leaves over many seeded turns,
 * and Skill Link's top count.
 */

const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const gear = (species: string, ability = '', item = '') => ({ species, ability, item });

/** The distribution of a sampled array: each value with its share, fewest hits first. */
function shares(values: readonly number[]): HitCount[] {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a - b).map(([hits, count]) => ({ hits, chance: count / values.length }));
}

/** Hits that connected in one turn of `id` (every BasePower event is one hit on the lone foe). */
function hitsInTurn(format: string, attacker: PokemonSet, defender: PokemonSet, id: string, seed: string): number {
  return powerInTurn(battleOf(format, [attacker], [defender], seed), { p1: 'move 1', p2: 'move 1' }, id).length;
}

describe('the hit counts the preview prices are the simulator\'s', () => {
  test('2 to 5 hits: the array the hit loop samples, in every generation', () => {
    for (let gen = 1; gen <= 9; gen++) {
      const format = `gen${gen}customgame`;
      const ability = gen >= 3 ? 'No Ability' : undefined;
      const battle = battleOf(format, [set('Jolteon', ['pinmissile'], { ability })], [splash('Snorlax', { ability })]);
      const sampled: number[][] = [];
      const sample = battle.sample.bind(battle);
      battle.sample = <T>(items: readonly T[]): T => {
        if (items.every(item => typeof item === 'number')) sampled.push(items as unknown as number[]);
        return sample(items);
      };
      battle.choose('p1', 'move 1');
      battle.choose('p2', 'move 1');
      expect(sampled.length, format).toBe(1);
      expect(hitCounts(gen, gear('Jolteon'), 'Pin Missile'), format).toEqual(shares(sampled[0]));
    }
  });

  test('Loaded Dice: a 2 to 5 hit move lands 4 or 5, Population Bomb 4 to 10, at the shares the simulator draws', () => {
    const seeds = Array.from({ length: 280 }, (_, index) => `${index + 1},2,3,4`);
    for (const id of ['bulletseed', 'populationbomb']) {
      const dice = set('Maushold', [id], { item: 'Loaded Dice' });
      // Shuckle outlasts ten hits; a turn whose first hit misses lands none and is left out.
      const counted = seeds.map(seed => hitsInTurn('gen9customgame', dice, splash('Shuckle'), id, seed)).filter(hits => hits > 0);
      const mirrored = hitCounts(9, gear('Maushold', '', 'Loaded Dice'), id)!;
      const seen = shares(counted);
      expect(seen.map(entry => entry.hits), id).toEqual(mirrored.map(entry => entry.hits));
      for (const [index, entry] of seen.entries()) {
        // Three standard errors of a share over this many turns.
        const tolerance = 3 * Math.sqrt(mirrored[index].chance * (1 - mirrored[index].chance) / counted.length);
        expect(Math.abs(entry.chance - mirrored[index].chance), `${id} ${entry.hits} hits`).toBeLessThan(tolerance);
      }
    }
    expect(hitCounts(9, gear('Maushold', '', 'Loaded Dice'), 'Bullet Seed')).toEqual([{ hits: 4, chance: 0.5 }, { hits: 5, chance: 0.5 }]);
  });

  test("an ability that sets the count gives the simulator's count: Skill Link the top, Battle Bond three", () => {
    const link = battleOf('gen9customgame', [set('Cinccino', ['bulletseed'], { ability: 'Skill Link' })], [splash('Snorlax')]);
    const linkHits = powerInTurn(link, { p1: 'move 1', p2: 'move 1' }, 'bulletseed').length;
    expect(linkHits).toBe(5);
    expect(hitCounts(9, gear('Cinccino', 'Skill Link'), 'Bullet Seed')).toEqual([{ hits: linkHits, chance: 1 }]);
    // Battle Bond's own onModifyMove gives Ash-Greninja's Water Shuriken three hits; plain Greninja draws 2 to 5.
    const ash = set('Greninja-Ash', ['watershuriken'], { ability: 'Battle Bond' });
    const drawn = Array.from({ length: 12 }, (_, index) => hitsInTurn('gen7customgame', ash, splash('Snorlax'), 'watershuriken', `${index + 1},2,3,4`));
    expect(new Set(drawn)).toEqual(new Set([3]));
    expect(hitCounts(7, gear('Greninja-Ash', 'Battle Bond'), 'Water Shuriken')).toEqual([{ hits: 3, chance: 1 }]);
    expect(hitCounts(7, gear('Greninja', 'Torrent'), 'Water Shuriken')?.map(entry => entry.hits)).toEqual([2, 3, 4, 5]);
  });

  test('fixed counts from the Dex leave the calc its own single count', () => {
    for (const name of ['Double Hit', 'Surging Strikes', 'Triple Dive', 'Dragon Darts', 'Population Bomb', 'Earthquake']) {
      expect(hitCounts(9, gear('Garchomp'), name), name).toBeNull();
    }
  });
});
