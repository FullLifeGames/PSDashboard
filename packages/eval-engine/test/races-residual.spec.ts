import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { statusResidual } from '../src/score/races';

/**
 * Round 60 (T95) prover: the static's per-turn status residual against what
 * the simulator takes in one turn, gens 1 to 9. The fractions live in the
 * sim's code (data/conditions.js and the gen mods), not in its data, so the
 * static keeps a table and this test keeps the table honest.
 */
const chansey: PokemonSet = {
  name: 'Chansey', species: 'Chansey', item: '', ability: '', moves: ['Splash'], nature: '', gender: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
};

function lossInOneTurn(gen: number, status: 'brn' | 'psn'): { sim: number; table: number } {
  const battle = new Battle({
    formatid: toID(`gen${gen}customgame`), seed: '1,2,3,4',
    p1: { name: 'A', team: Teams.pack([chansey]) }, p2: { name: 'B', team: Teams.pack([chansey]) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) battle.makeChoices('team 1', 'team 1');
  const mon = battle.sides[0].active[0]!;
  mon.setStatus(status, mon);
  const before = mon.hp;
  battle.makeChoices('move 1', 'move 1');
  return { sim: (before - mon.hp) / mon.maxhp, table: statusResidual(mon) };
}

describe('status residual per generation (round 60, T95 prover)', () => {
  for (const gen of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    for (const status of ['brn', 'psn'] as const) {
      test(`gen ${gen} ${status}`, () => {
        const { sim, table } = lossInOneTurn(gen, status);
        expect(sim).toBeGreaterThan(0);
        expect(Math.abs(sim - table)).toBeLessThan(0.006);
      });
    }
  }
});
