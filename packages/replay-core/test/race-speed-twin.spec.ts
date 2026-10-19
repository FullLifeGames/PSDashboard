import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID } from '@pkmn/sim';
import { raceSpeed, scarfedSpeed } from '../src/spreads/race-speed';

/**
 * Round 72 (T239): the Scarf holder of the spread solver's race comes from the twin factory. It races at the speed the
 * simulator's own getStat gives a Choice Scarf holder in each generation, the way the hand-written battle it replaced
 * did: held here against that battle, built by hand, in every generation 1 to 9.
 */

const STATS = [1, 2, 99, 100, 101, 200, 301, 599, 1000];

function byHand(gen: number, stat: number): number {
  const team = (item: string) => Teams.pack([{
    name: 'Smeargle', species: 'Smeargle', item, ability: 'Own Tempo', moves: ['Splash'], nature: 'Hardy', gender: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
  }]);
  const battle = new Battle({
    formatid: toID(`gen${gen}customgame`), seed: '1,2,3,4',
    p1: { name: 'A', team: team('Choice Scarf') }, p2: { name: 'B', team: team('') },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) battle.makeChoices('team 1', 'team 1');
  const holder = battle.sides[0].active[0];
  holder.storedStats.spe = stat;
  return holder.getStat('spe', true);
}

describe('the Scarf holder of the race', () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('gen %i: the factory\'s holder races at the hand-built holder\'s speed', gen => {
    const scarf = Dex.forGen(gen).items.get('choicescarf');
    for (const stat of STATS) {
      const expected = scarf.exists && scarf.gen <= gen ? byHand(gen, stat) : stat;
      expect(scarfedSpeed(gen, stat), `${stat}`).toBe(expected);
      expect(raceSpeed(gen, stat, true)).toBe(expected);
      expect(raceSpeed(gen, stat, false)).toBe(stat);
    }
  });
});
