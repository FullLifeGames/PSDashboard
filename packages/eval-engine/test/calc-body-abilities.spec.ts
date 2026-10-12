import { describe, expect, test } from 'vitest';
import { Field, Move as CalcMove, calculate } from '@smogon/calc';
import { calcGenerationFor } from '@fulllifegames/replay-core';
import type { Battle, Pokemon } from '@pkmn/sim';
import { bodyOf, calcPokemon, type CalcBody } from '../src/calc/body';
import { checkedRolls, drawTurn, rollSet, rootOf } from './calc-roll-oracle';
import { battleOf } from './power-oracle';
import { set } from './move-oracle';

/** A set that can always Splash, so a turn has a move for the side that stays. */
const mon = (species: string, moves: string[], extra: Parameters<typeof set>[2] = {}) => set(species, [...moves, 'splash'], extra);

/**
 * Round 68 (T156): the ability the calc is given is the one the simulator lets act now. An ability the simulator
 * suppresses (Gastro Acid, an active Neutralizing Gas) goes to the calc as No Ability; a body still to come in gets the
 * entry stage of Intrepid Sword or Dauntless Shield only when the simulator would give it (its own handler, asked on a
 * stand-in with the holder's flags: Gen 9 gives it once per battle, Gen 8 every time, none under Neutralizing Gas).
 * The oracle is the simulator: the stage a body really holds after it switches in, and the kill table against the
 * logged damage at the drawn roll. Singles and doubles both (the doubles path shares bodyOf and the calc builder).
 */

type Kind = 'singles' | 'doubles';
const KINDS: Kind[] = ['singles', 'doubles'];
const format = (gen: number, kind: Kind) => (kind === 'singles' ? `gen${gen}customgame` : `gen${gen}doublescustomgame`);

/** The stage the calc holds for `mon` when it is priced as the attacker or defender of an Iron Head against `foe`. */
function calcStages(battle: Battle, mon: Pokemon, foe: Pokemon) {
  const gen = calcGenerationFor(battle.gen, battle.dex.currentMod);
  const move = new CalcMove(gen, 'Iron Head');
  const asAttacker = calculate(gen, calcPokemon(gen, bodyOf(battle, mon)), calcPokemon(gen, bodyOf(battle, foe)), move, new Field({}));
  const asDefender = calculate(gen, calcPokemon(gen, bodyOf(battle, foe)), calcPokemon(gen, bodyOf(battle, mon)), move, new Field({}));
  return { atk: asAttacker.attacker.boosts.atk, def: asDefender.defender.boosts.def };
}

/** One turn: the side of `incoming` brings it in for its first active (its team slot as it stands now); the other side Splashes. */
function switchIn(battle: Battle, kind: Kind, incoming: Pokemon) {
  const side = battle.sides.indexOf(incoming.side) as 0 | 1;
  const slot = incoming.side.pokemon.indexOf(incoming) + 1;
  const out = kind === 'singles' ? `switch ${slot}` : `switch ${slot}, move splash`;
  const stay = kind === 'singles' ? 'move splash' : 'move splash, move splash';
  battle.makeChoices(side === 0 ? out : stay, side === 0 ? stay : out);
}

/** Zacian leaves for the first Pokémon behind it (the second team slot in singles, the third in doubles). */
function switchOut(battle: Battle, kind: Kind, leaving: Pokemon) {
  switchIn(battle, kind, leaving.side.pokemon[kind === 'singles' ? 1 : 2]);
}

const bench = (battle: Battle, side: 0 | 1, index: number) => battle.sides[side].pokemon[index];

describe('an entry stage the simulator no longer gives is not priced (T156)', () => {
  for (const kind of KINDS) {
    test(`${kind}, Gen 9: a Zacian-Crowned that already used Intrepid Sword gets no second stage`, () => {
      const sword = { ability: 'Intrepid Sword', item: 'Rusted Sword' };
      const mates = kind === 'singles' ? [mon('Corviknight', ['splash'])] : [mon('Corviknight', ['splash']), mon('Corviknight', ['splash']), mon('Corviknight', ['splash'])];
      const battle = battleOf(format(9, kind), [mon('Zacian-Crowned', ['ironhead'], sword), ...mates], [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
      const zacian = bench(battle, 0, 0);
      expect(zacian.boosts.atk).toBe(1);
      switchOut(battle, kind, zacian);
      expect(zacian.isActive).toBe(false);
      const foe = battle.sides[1].active[0];
      const priced = calcStages(battle, zacian, foe).atk;
      const entryStage = bodyOf(battle, zacian).entryStage;
      switchIn(battle, kind, zacian);
      expect(zacian.isActive).toBe(true);
      expect(zacian.boosts.atk, 'the simulator gives the second entry nothing').toBe(0);
      expect(priced).toBe(0);
      expect(entryStage, 'the body says the simulator gives no stage').toBe(false);
    });

    test(`${kind}, Gen 9: a fresh Zamazenta-Crowned still to come in keeps its Dauntless Shield stage (the 0.11 result)`, () => {
      const battle = battleOf(format(9, kind), [mon('Garchomp', ['earthquake']), mon('Garchomp', ['earthquake']), mon('Garchomp', ['earthquake']), mon('Garchomp', ['earthquake'])],
        [mon('Snorlax', ['splash']), mon('Snorlax', ['splash']), mon('Zamazenta-Crowned', ['splash'], { ability: 'Dauntless Shield', item: 'Rusted Shield' })]);
      const shield = bench(battle, 1, 2);
      expect(shield.isActive).toBe(false);
      const foe = battle.sides[0].active[0];
      const priced = calcStages(battle, shield, foe).def;
      expect(priced).toBe(1);
      switchIn(battle, kind, shield);
      expect(shield.boosts.def).toBe(1);
    });

    test(`${kind}, Gen 9: a Zamazenta-Crowned still to come in under the foe's Neutralizing Gas gets no stage`, () => {
      const battle = battleOf(format(9, kind), [mon('Weezing', ['splash'], { ability: 'Neutralizing Gas' }), mon('Weezing', ['splash'], { ability: 'Neutralizing Gas' }), mon('Garchomp', ['splash']), mon('Garchomp', ['splash'])],
        [mon('Snorlax', ['splash']), mon('Snorlax', ['splash']), mon('Zamazenta-Crowned', ['splash'], { ability: 'Dauntless Shield', item: 'Rusted Shield' })]);
      const shield = bench(battle, 1, 2);
      const foe = battle.sides[0].active[0];
      expect(foe.ability).toBe('neutralizinggas');
      const priced = calcStages(battle, shield, foe).def;
      switchIn(battle, kind, shield);
      expect(shield.boosts.def, 'the simulator gives the entry nothing under the gas').toBe(0);
      expect(priced).toBe(0);
      expect(bodyOf(battle, shield).ability, 'the ability the gas suppresses').toBe('No Ability');
    });

    test(`${kind}, Gen 8: Intrepid Sword gives its stage on every entry, as the calc does by itself`, () => {
      const sword = { ability: 'Intrepid Sword', item: 'Rusted Sword' };
      const mates = kind === 'singles' ? [mon('Corviknight', ['splash'])] : [mon('Corviknight', ['splash']), mon('Corviknight', ['splash']), mon('Corviknight', ['splash'])];
      const battle = battleOf(format(8, kind), [mon('Zacian-Crowned', ['ironhead'], sword), ...mates], [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
      const zacian = bench(battle, 0, 0);
      switchOut(battle, kind, zacian);
      const foe = battle.sides[1].active[0];
      const priced = calcStages(battle, zacian, foe).atk;
      switchIn(battle, kind, zacian);
      expect(zacian.boosts.atk).toBe(1);
      expect(priced).toBe(1);
    });
  }

  test('a body from the picker or a built set carries no simulator flags and keeps its entry stage', () => {
    const gen = calcGenerationFor(9);
    const body: CalcBody = {
      species: 'Zacian-Crowned', level: 100, ability: 'Intrepid Sword', item: 'Rusted Sword', nature: 'Hardy', evs: {}, ivs: {},
      boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, tera: null, onField: false,
    };
    expect(body.entryStage).toBeUndefined();
    expect(calcPokemon(gen, body).abilityOn).toBe(true);
    expect(calcPokemon(gen, { ...body, entryStage: false }).abilityOn).toBeFalsy();
    expect(calcPokemon(gen, { ...body, entryStage: true }).abilityOn).toBe(true);
  });
});

describe('an ability the simulator suppresses reaches the calc as No Ability (T156)', () => {
  for (const kind of KINDS) {
    const choices = kind === 'singles'
      ? ['move dragonclaw', 'move splash'] as const
      : ['move dragonclaw 1, move splash', 'move splash, move splash'] as const;
    const teams = (extra: Partial<Parameters<typeof rollSet>[2]> = {}) => kind === 'singles'
      ? { p1: [rollSet('Garchomp', ['dragonclaw'])], p2: [rollSet('Dragonite', ['splash'], { ability: 'Multiscale', ...extra })] }
      : { p1: [rollSet('Garchomp', ['dragonclaw']), rollSet('Corviknight', ['splash'])], p2: [rollSet('Dragonite', ['splash'], { ability: 'Multiscale', ...extra }), rollSet('Corviknight', ['splash'])] };

    test(`${kind}: Multiscale under Gastro Acid prices as no Multiscale, and Multiscale without it still halves`, () => {
      const { p1, p2 } = teams();
      for (const acid of [true, false]) {
        const root = rootOf(format(9, kind) as 'gen9customgame', p1, p2, battle => {
          if (acid) expect(battle.sides[1].active[0].addVolatile('gastroacid')).toBeTruthy();
        });
        const drawn = drawTurn(root, choices[0], choices[1]);
        const rolls = checkedRolls(drawn);
        expect(rolls.length, `hits (acid ${acid})`).toBe(1);
        expect(rolls[0].table, `table (acid ${acid})`).not.toBeNull();
        expect(rolls[0].holds, `the kill table holds the logged damage (acid ${acid})`).toBe(true);
        expect(rolls[0].roll.snapshot.defender.ability).toBe(acid ? 'No Ability' : 'Multiscale');
      }
    });
  }
});
