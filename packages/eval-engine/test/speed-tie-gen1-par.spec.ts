import { describe, expect, test } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { speedTie } from '../src/search/leaf';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { cheapOracle, SLOT_A } from './speed-tie-oracle';

/**
 * Round 72 (T196b): Gen 1 paralysis in the simulator's order. The Gen 1 mod quarters the speed when a move inflicts
 * paralysis (`modifyStat('spe', 0.25)` at the hit, data/mods/gen1/scripts.js), not when `setStatus('par')` runs alone, so
 * the sweep's "foe paralyzed" scenario (setStatus) shows no change in Gen 1 and a played turn is the check that counts:
 * the tree plays the simulator, and the simulator moves the paralyzed body last.
 */

const FORMAT = 'gen1customgame';
const fast = (species: string, moves: string[]) => set(species, moves, { evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } });
const mover = (log: string[], from: number) => log.slice(from).filter(line => line.startsWith('|move|')).map(line => line.split('|')[2].slice(0, 2));

/** Starmie (fast) paralyzed by Snorlax's Thunder Wave in turn one; the position after it is the board. */
function paralyzed(seed: string): Battle {
  const battle = battleOf(FORMAT, [fast('Starmie', ['tackle'])], [fast('Snorlax', ['thunderwave', 'tackle'])], seed);
  battle.makeChoices('move tackle', 'move thunderwave');
  return battle;
}

describe('Gen 1: a paralyzed faster body moves after the slower one', () => {
  test('the quartered speed is the action speed, the played order follows it, and speedTie says no tie', () => {
    let played = 0;
    for (const seed of ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20', '21,22,23,24']) {
      const battle = paralyzed(seed);
      const [starmie, snorlax] = [battle.sides[0].active[0] as Pokemon, battle.sides[1].active[0] as Pokemon];
      if (starmie.status !== 'par') continue; // Thunder Wave missed or the move was blocked in this seed
      expect(starmie.getStat('spe', false, false), seed).toBeLessThan(starmie.getStat('spe', true, true));
      expect(starmie.getActionSpeed(), seed).toBeLessThan(snorlax.getActionSpeed());
      expect(speedTie(battle as never, 'move tackle', 'move tackle'), seed).toBe(false);
      expect(cheapOracle(battle, ...SLOT_A)('tackle', 'tackle'), seed).toBe(false);
      const from = battle.log.length;
      battle.makeChoices('move tackle', 'move tackle');
      const order = mover(battle.log, from);
      if (order.length < 2) continue; // fully paralyzed this turn
      played++;
      expect(order, seed).toEqual(['p2', 'p1']);
    }
    expect(played).toBeGreaterThan(0);
  });

  test('setStatus alone leaves the Gen 1 speed as it was, which is why the sweep reads no change there', () => {
    const battle = battleOf(FORMAT, [fast('Starmie', ['tackle'])], [fast('Snorlax', ['tackle'])]);
    const starmie = battle.sides[0].active[0] as Pokemon;
    const before = starmie.getActionSpeed();
    starmie.setStatus('par');
    expect(starmie.getActionSpeed()).toBe(before);
  });
});
