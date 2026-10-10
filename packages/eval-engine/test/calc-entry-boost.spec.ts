import { describe, expect, test } from 'vitest';
import { Generations } from '@smogon/calc';
import type { Battle, Pokemon } from '@pkmn/sim';
import { bodyOf, calcAddsStages } from '../src/calc/body';
import { boundaryEvent } from '../src/ko-odds';
import type { RollRecord } from '../src/pair/prng';
import { checkedRolls, drawTurn } from './calc-roll-oracle';
import { doublesRoot, pairSet } from './pair-battles';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 67, lane A (T100): entry boosts count once. The simulator puts
 * Dauntless Shield, Intrepid Sword, Download and Embody Aspect into the body's
 * stages when it comes in; @smogon/calc adds the same stage by itself. A body
 * on the field reaches the calc as "No Ability" when its ability is one the
 * calc boosts by itself; a body still to come in keeps the calc's stage.
 */

/** Runs `ask` with the bodies' abilities set to the simulator's "No Ability" and restores them. */
function neutral<T>(bodies: Pokemon[], ask: () => T): T {
  const saved = bodies.map(mon => mon.ability);
  for (const mon of bodies) (mon as { ability: string }).ability = 'noability';
  try {
    return ask();
  } finally {
    bodies.forEach((mon, index) => { (mon as { ability: string }).ability = saved[index]; });
  }
}

/** The defender's HP set between the calc's rolls with and without the doubled stage, so the kill share tells them apart. */
function hpBetween(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string) {
  defender.sethp(defender.maxhp);
  const doubled = boundaryEvent(battle, attacker, defender, moveId);
  expect(doubled).not.toBeNull();
  for (let hp = 1; hp <= defender.maxhp; hp++) {
    defender.sethp(hp);
    const plain = neutral([attacker, defender], () => boundaryEvent(battle, attacker, defender, moveId))!;
    if (plain.killFraction > 0 && plain.killFraction < 0.9) return;
  }
  throw new Error('no HP between the two readings');
}

/** Every hit of a drawn turn against its kill table (calc-roll-oracle.ts). */
function check(drawn: ReturnType<typeof drawTurn>) {
  const rolls = checkedRolls(drawn);
  expect(rolls.every(({ table }) => table !== null)).toBe(true);
  return { checked: rolls.length, mismatched: rolls.filter(({ holds }) => !holds).length };
}

const draw = drawTurn;

describe('entry boosts count once in the odds (T100)', () => {
  test('singles: Zacian-Crowned\'s Intrepid Sword stage reaches the kill odds once', () => {
    const battle = battleOf('gen9customgame',
      [set('Zacian-Crowned', ['ironhead'], { ability: 'Intrepid Sword', item: 'Rusted Sword' })],
      [set('Snorlax', ['splash'], { ability: 'Battle Armor' })]);
    const [zacian, snorlax] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    expect(zacian.boosts.atk).toBe(1);
    hpBetween(battle, zacian, snorlax, 'ironhead');
    const plain = neutral([zacian], () => boundaryEvent(battle, zacian, snorlax, 'ironhead'));
    expect(boundaryEvent(battle, zacian, snorlax, 'ironhead')).toEqual(plain);
  });

  test('singles: a Zamazenta-Crowned still to come in keeps the stage the simulator gives it on entry', () => {
    const battle = battleOf('gen9customgame',
      [set('Garchomp', ['earthquake'])],
      [set('Snorlax', ['splash']), set('Zamazenta-Crowned', ['splash'], { ability: 'Dauntless Shield', item: 'Rusted Shield' })]);
    const [garchomp, zamazenta] = [battle.sides[0].active[0], battle.sides[1].pokemon[1]];
    expect(zamazenta.isActive).toBe(false);
    expect(zamazenta.boosts.def).toBe(0);
    const entered = (() => {
      const saved = zamazenta.boosts.def;
      zamazenta.boosts.def = 1;
      try {
        return neutral([zamazenta], () => boundaryEvent(battle, garchomp, zamazenta, 'earthquake'));
      } finally {
        zamazenta.boosts.def = saved;
      }
    })();
    expect(boundaryEvent(battle, garchomp, zamazenta, 'earthquake')).toEqual(entered);
  });

  test('doubles: Zacian-Crowned\'s Iron Head lands on its kill table at every drawn roll', () => {
    const root = doublesRoot(
      [pairSet('Zacian', 'Zacian-Crowned', ['Iron Head', 'Protect'], { ability: 'Intrepid Sword', item: 'Rusted Sword' }), pairSet('Mate', 'Corviknight', ['Roost', 'Protect'])],
      [pairSet('Tank', 'Snorlax', ['Rest', 'Protect'], { ability: 'Battle Armor' }), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
    );
    const result = check(draw(root, 'move ironhead 1, move roost', 'move rest, move softboiled'));
    expect(result).toEqual({ checked: 1, mismatched: 0 });
  });

  test('doubles: a hit into Zamazenta-Crowned reads its Dauntless Shield stage once', () => {
    const root = doublesRoot(
      [pairSet('Chomp', 'Garchomp', ['Earthquake', 'Protect']), pairSet('Mate', 'Corviknight', ['Roost', 'Protect'])],
      [pairSet('Shield', 'Zamazenta-Crowned', ['Splash', 'Protect'], { ability: 'Dauntless Shield', item: 'Rusted Shield' }), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'], { ability: 'Battle Armor' })],
    );
    const drawn = draw(root, 'move earthquake, move protect', 'move splash, move softboiled');
    const intoShield = drawn.records.some(record => record.kind === 'roll' && (record as RollRecord).key === 'p1a:earthquake>p2a');
    expect(intoShield).toBe(true);
    expect(check(drawn).mismatched).toBe(0);
  });

  test('doubles: Porygon-Z reaches the calc with Download, never with the species\' first ability (Adaptability)', () => {
    const root = doublesRoot(
      [pairSet('Zed', 'Porygon-Z', ['Hyper Voice', 'Protect'], { ability: 'Download' }), pairSet('Mate', 'Corviknight', ['Roost', 'Protect'])],
      [pairSet('Tank', 'Snorlax', ['Rest', 'Protect'], { ability: 'Battle Armor' }), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'], { ability: 'Battle Armor' })],
    );
    const result = check(draw(root, 'move hypervoice, move roost', 'move rest, move softboiled'));
    expect(result.checked).toBe(2);
    expect(result.mismatched).toBe(0);
  });
});

describe('the abilities the calc boosts by itself are read from the calc (T100)', () => {
  test('per gen: Download from gen 4, Dauntless Shield and Intrepid Sword from gen 8, the four Embody Aspects in gen 9', () => {
    const found = (gen: number) => [...Generations.get(gen as 9).abilities].map(ability => ability.name).filter(name => calcAddsStages(gen, name)).sort();
    expect(found(3)).toEqual([]);
    for (const gen of [4, 5, 6, 7]) expect(found(gen), `gen ${gen}`).toEqual(['Download']);
    expect(found(8)).toEqual(['Dauntless Shield', 'Download', 'Intrepid Sword']);
    expect(found(9)).toEqual([
      'Dauntless Shield', 'Download', 'Embody Aspect (Cornerstone)', 'Embody Aspect (Hearthflame)', 'Embody Aspect (Teal)',
      'Embody Aspect (Wellspring)', 'Intrepid Sword',
    ]);
  });

  test('the body carries the battle\'s mod, for the one place the calc Pokémon is built', () => {
    const battle = battleOf('gen9customgame', [set('Garchomp', ['earthquake'])], [set('Snorlax', ['splash'])]);
    expect(bodyOf(battle, battle.sides[0].active[0]).mod).toBe(battle.dex.currentMod);
    expect(bodyOf(battle, battle.sides[0].active[0]).onField).toBe(true);
    expect(bodyOf(battle, battle.sides[1].pokemon[0]).species).toBe('Snorlax');
  });
});
