import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import { koOddsForOptions } from '../src/cell-blend';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { anchorRoot, doublesRoot, pairSet, PLAYED } from './pair-battles';

/**
 * Round 69 (T146, integrator request for T177): the odds name the attacker that makes them, its slot and species,
 * so the doubles label can say who attacks. The expected values come from the battle the test builds.
 */

describe('KoOddsInfo.attacker', () => {
  test('doubles: the slot of the attacking move and its species, the second slot included', () => {
    const battle = positionBattle(anchorRoot());
    // PLAYED[0] is "move lifedew, move playrough 2": the second slot's Play Rough makes the odds.
    const slot = battle.sides[0].active.findIndex(mon => mon?.moves.includes('playrough'));
    expect(slot).toBe(1);
    const [odds] = koOddsForOptions(battle, 'p1', [PLAYED[0]]);
    expect(odds?.attacker).toEqual({ slot, species: battle.sides[0].active[slot]!.species.name });
  });

  test('doubles: the first slot too, on the other side', () => {
    const root = doublesRoot(
      [pairSet('Pikachu', 'Pikachu', ['Protect', 'Growl']), pairSet('Eevee', 'Eevee', ['Protect', 'Growl'])],
      [pairSet('Machamp', 'Machamp', ['Karate Chop', 'Rock Slide']), pairSet('Snorlax', 'Snorlax', ['Tackle', 'Protect'])],
      battle => { for (const mon of battle.sides[0].active) mon!.sethp(30); },
    );
    const battle = positionBattle(root);
    const [odds] = koOddsForOptions(battle, 'p2', ['move rockslide, move protect']);
    expect(odds).not.toBeNull();
    expect(odds?.attacker).toEqual({ slot: 0, species: battle.sides[1].active[0]!.species.name });
  });

  test('singles: slot 0 and the attacker species', () => {
    const sim = new Battle({
      formatid: toID('gen9customgame'), seed: '1,2,3,4',
      p1: { name: 'A', team: Teams.pack([pairSet('Jolt', 'Jolteon', ['Thunder'])]) },
      p2: { name: 'B', team: Teams.pack([pairSet('Champ', 'Machamp', ['Close Combat'])]) },
    });
    if (sim.sides.some(side => side.requestState === 'teampreview')) {
      sim.choose('p1', 'team 1');
      sim.choose('p2', 'team 1');
    }
    sim.sides[1].active[0]!.sethp(1);
    const battle = positionBattle(createRootPosition(JSON.stringify(State.serializeBattle(sim))));
    const [odds] = koOddsForOptions(battle, 'p1', ['move thunder']);
    expect(odds).toEqual({ accuracy: 0.7, killFraction: 1, attacker: { slot: 0, species: battle.sides[0].active[0]!.species.name } });
  });
});
