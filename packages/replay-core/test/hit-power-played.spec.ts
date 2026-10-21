import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { historyPower, historyPowerMove } from '../src/spreads/hit-power';
import { FORMAT, KINDS, isDoubles, scaled, set, type Kind } from './fit-field-scenes';

/**
 * Round 73 (step 4, the census of the simulator's callers): `spreads/hit-power.ts` runs a Dex `basePowerCallback` on a recording
 * stand-in, with no battle behind it, so the callback has nothing to write to. Two specs hold it to the simulator:
 *  - `hit-power-census.spec.ts` sorts every move with a `basePowerCallback` in every generation (1 to 9) and in the Champions mod
 *    by what the callback reads, and holds the history class to exactly Last Respects and Rage Fist;
 *  - this spec plays real battles (Gen 9 singles and doubles, Champions singles and doubles), and at every use of a history move
 *    compares the base power the simulator's own damage step took (its `BasePower` event, first in line, before any modifier) with
 *    `historyPower` at the counts the battle held at that moment. A move of the class that this spec does not play fails the
 *    sweep test at the bottom, so a new history move needs its scene.
 */

Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);

const FALLEN = (nickname: string): PokemonSet => ({ ...set('Shedinja', '', 'Wonder Guard', ['Splash'], 'Hardy', {}), name: nickname });
/** Bulky foes that survive the whole scene: the history hits would otherwise knock the lone foe out and end the battle. */
const DONDOZO = () => set('Dondozo', '', 'Unaware', ['Crunch', 'Dragon Claw', 'Splash'], 'Bold', { hp: 252, def: 252, spd: 4 });
const BLISSEY = () => set('Blissey', '', 'Natural Cure', ['Crunch', 'Dragon Claw', 'Splash'], 'Calm', { hp: 252, spd: 252 });
const BASCULEGION = () => set('Basculegion', '', 'Swift Swim', ['Last Respects', 'Rage Fist', 'Splash'], 'Hardy', { hp: 252 });

interface Use { move: string; basePower: number; fainted: number; timesAttacked: number }

/** Plays the scene to its end; every use of Last Respects or Rage Fist is read at the simulator's BasePower event. */
function play(kind: Kind): Use[] {
  const doubles = isDoubles(kind);
  const battle = new Battle({
    formatid: toID(FORMAT[kind]), seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack((doubles
      ? [FALLEN('Shed1'), FALLEN('Shed2'), BASCULEGION(), BLISSEY()]
      : [FALLEN('Shed1'), FALLEN('Shed2'), BASCULEGION()]).map(body => scaled(body, kind))) },
    p2: { name: 'Beta', team: Teams.pack((doubles ? [DONDOZO(), BLISSEY()] : [DONDOZO()]).map(body => scaled(body, kind))) },
  });
  const uses: Use[] = [];
  // The highest priority runs before any ability, item or field modifier: the relayed value is the callback's own answer.
  battle.onEvent('BasePower', battle.format, 1e6, (basePower: number, attacker: { side: { totalFainted: number }; timesAttacked: number }, _defender: unknown, move: { id: string }) => {
    if (historyPowerMove(Dex.forGen(9), move.id)) uses.push({ move: move.id, basePower, fainted: attacker.side.totalFainted, timesAttacked: attacker.timesAttacked });
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  const steps: Array<[string?, string?]> = doubles
    ? [
      ['move splash, move splash', 'move crunch 1, move crunch 2'],
      ['switch 3, switch 4'],
      ['move lastrespects 1, move splash', 'move dragonclaw 1, move splash'],
      ['move ragefist 1, move splash', 'move dragonclaw 1, move splash'],
      ['move lastrespects 1, move splash', 'move splash, move splash'],
      ['move ragefist 1, move splash', 'move splash, move splash'],
    ]
    : [
      ['move splash', 'move crunch'],
      ['switch 2'],
      ['move splash', 'move crunch'],
      ['switch 3'],
      ['move lastrespects', 'move dragonclaw'],
      ['move ragefist', 'move dragonclaw'],
      ['move lastrespects', 'move splash'],
      ['move ragefist', 'move splash'],
    ];
  for (const [p1, p2] of steps) {
    if (p1) battle.choose('p1', p1);
    if (p2) battle.choose('p2', p2);
  }
  return uses;
}

describe('the history power equals the simulator\'s base power on a played battle', () => {
  const dex = (kind: Kind) => (kind.startsWith('champions') ? Dex.mod('champions') : Dex.forGen(9));
  const played = new Map<Kind, Use[]>();

  test.each(KINDS)('%s: every use of a history move prices as the simulator did', kind => {
    const uses = play(kind);
    played.set(kind, uses);
    expect(uses.length, JSON.stringify(uses)).toBeGreaterThanOrEqual(4);
    for (const use of uses) {
      expect(historyPower(dex(kind) as never, use.move, use), `${use.move} at ${use.fainted} fallen, ${use.timesAttacked} hits`).toBe(use.basePower);
    }
    // The counts really moved: the battle did not stay at zero, where every callback answers its floor.
    expect(Math.max(...uses.map(use => use.fainted))).toBeGreaterThan(0);
    expect(Math.max(...uses.map(use => use.timesAttacked))).toBeGreaterThan(0);
  });

  test('the scenes play every move of the history class, in every game type', () => {
    const history = Dex.forGen(9).moves.all().filter(move => historyPowerMove(Dex.forGen(9) as never, move.id)).map(move => move.id).sort();
    for (const kind of KINDS) {
      const moves = [...new Set((played.get(kind) ?? play(kind)).map(use => use.move))].sort();
      expect(moves, kind).toEqual(history);
    }
  });
});
