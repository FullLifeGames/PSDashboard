import { describe, expect, test } from 'vitest';
import { Field, Move as CalcMove, calculate, Generations } from '@smogon/calc';
import { calcGenerationFor } from '@fulllifegames/replay-core';
import type { Pokemon } from '@pkmn/sim';
import * as bodyModule from '../src/calc/body';
import { bodyOf, calcPokemon, type CalcBody, calcAddsStages } from '../src/calc/body';
import { checkedRolls, drawTurn, rollSet, rootOf, rollSet as setFromStellarFirstUse } from './calc-roll-oracle';
import { battleOf } from './power-oracle';
import { set } from './move-oracle';
import { Dex, type PokemonSet, Battle, Teams, toID } from '@pkmn/sim';
import { positionBattle, type SimPosition } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { boundaryEvent } from '../src/ko-odds';
import type { RollRecord } from '../src/pair/prng';
import { doublesRoot, pairSet } from './pair-battles';
import * as moveModule from '../src/calc/move';
import { calcMove } from '../src/calc/move';
import { pairKoOdds } from '../src/pair/odds';
import { killing, simDamages } from './sim-rolls';

const mon = (species: string, moves: string[], extra: Parameters<typeof set>[2] = {}) => set(species, [...moves, 'splash'], extra);

/**
 * The ability the calc is given is the one the simulator lets act now. An ability the simulator suppresses (Gastro Acid, an active
 * Neutralizing Gas) goes to the calc as No Ability; a body still to come in gets the entry stage of Intrepid Sword or Dauntless Shield
 * only when the simulator would give it (its own handler, asked on a stand-in with the holder's flags: Gen 9 gives it once per battle,
 * Gen 8 every time, none under Neutralizing Gas). The oracle is the simulator: the stage a body really holds after it switches in,
 * and the kill table against the logged damage at the drawn roll. Singles and doubles both (the doubles path shares bodyOf and the
 * calc builder).
 */

type Kind = 'singles' | 'doubles';
const KINDS: Kind[] = ['singles', 'doubles'];
const format = (gen: number, kind: Kind) => (kind === 'singles' ? `gen${gen}customgame` : `gen${gen}doublescustomgame`);

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

await loadSimMods('gen9championscustomgame');

describe('calc-champions-entry-stage', () => {


  const SP = { hp: 32, atk: 0, def: 0, spa: 32, spd: 0, spe: 0 };
  const set = (species: string, moves: string[], extra: Partial<PokemonSet> = {}) => rollSet(species, moves, { evs: SP, ...extra });
  const FORMAT = { singles: 'gen9championscustomgame', doubles: 'gen9championsdoublescustomgame' } as const;

  describe('entry stages in a Champions battle', () => {
    test('the probe reads the calculator itself, on generation 0 as on the others', () => {
      const gen0 = calcGenerationFor(9, 'champions');
      expect(gen0.num).toBe(0);
      const reads = (gen: number, ability: string) => calcAddsStages(gen, ability);
      // Whatever generation 0 does for Download, the probe and a calculation by hand agree: both come from the calculator.
      const byHand = (gen: number) => calcAddsStages(gen, 'Download');
      expect(reads(0, 'Download')).toBe(byHand(0));
      expect(reads(9, 'Download'), 'a generation the probe always read').toBe(true);
      expect(reads(0, 'Pressure'), 'an ability with no stage').toBe(false);
    });

    for (const game of ['singles', 'doubles'] as const) {
      test(`${game}: a Download body on the field lies on the kill table at the drawn roll (no second stage)`, () => {
        const doubles = game === 'doubles';
        const p1 = [set('Porygon-Z', ['Hyper Voice'], { ability: 'Download' }), ...(doubles ? [set('Corviknight', ['Roost'])] : [])];
        const p2 = [set('Snorlax', ['Splash'], { ability: 'No Ability' }), ...(doubles ? [set('Blissey', ['Splash'], { ability: 'No Ability' })] : [])];
        const root = rootOf(FORMAT[game], p1, p2);
        const battle = positionBattle(root);
        expect(battle.dex.currentMod).toBe('champions');
        expect(Dex.dexes.champions.abilities.get('download').exists).toBe(true);
        const choice = doubles ? 'move hypervoice, move roost' : 'move hypervoice';
        const hits = checkedRolls(drawTurn(root, choice, doubles ? 'move splash, move splash' : 'move splash'));
        expect(hits.length, 'a priced hit').toBeGreaterThan(0);
        expect(hits.filter(({ table }) => table === null).length, 'every hit priced').toBe(0);
        expect(hits.filter(({ holds }) => !holds).length, 'hits off the table').toBe(0);
      });
    }

    // Meganium-Mega's Mega Sol makes Weather Ball a Fire move of double power, which the calculator's generation 0 knows. The
    // simulator is the judge.
    for (const game of ['singles', 'doubles'] as const) {
      test(`${game}: a Mega Sol Weather Ball lies on the kill table at the drawn roll`, () => {
        const doubles = game === 'doubles';
        const p1 = [set('Meganium', ['Weather Ball'], { item: 'Meganiumite' }), ...(doubles ? [set('Corviknight', ['Roost'])] : [])];
        const p2 = [set('Corviknight', ['Splash'], { ability: 'No Ability' }), ...(doubles ? [set('Blissey', ['Splash'], { ability: 'No Ability' })] : [])];
        const root = rootOf(FORMAT[game], p1, p2);
        const needsTarget = doubles ? ' 1' : '';
        const choice = doubles ? `move weatherball${needsTarget} mega, move roost` : 'move weatherball mega';
        const hits = checkedRolls(drawTurn(root, choice, doubles ? 'move splash, move splash' : 'move splash'));
        expect(hits.length, 'a priced hit').toBeGreaterThan(0);
        expect(hits.filter(({ table }) => table === null).length, 'every hit priced').toBe(0);
        expect(hits.filter(({ holds }) => !holds).length, 'hits off the table').toBe(0);
        // A Fire hit of 100 power into a Steel type takes the whole body (Weather Ball's 50 power Normal hit takes a tenth).
        expect(Math.max(...hits[0].table!.normal), 'Mega Sol read').toBeGreaterThanOrEqual(hits[0].roll.snapshot.defender.hp);
      });
    }
  });
});

function neutral<T>(bodies: Pokemon[], ask: () => T): T {
  const saved = bodies.map(mon => mon.ability);
  for (const mon of bodies) (mon as { ability: string }).ability = 'noability';
  try {
    return ask();
  } finally {
    bodies.forEach((mon, index) => { (mon as { ability: string }).ability = saved[index]; });
  }
}

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
  test('per gen: Download from gen 4, Dauntless Shield and Intrepid Sword in gen 8, the four Embody Aspects in gen 9', () => {
    const found = (gen: number) => [...Generations.get(gen as 9).abilities].map(ability => ability.name).filter(name => calcAddsStages(gen, name)).sort();
    expect(found(3)).toEqual([]);
    for (const gen of [4, 5, 6, 7]) expect(found(gen), `gen ${gen}`).toEqual(['Download']);
    expect(found(8)).toEqual(['Dauntless Shield', 'Download', 'Intrepid Sword']);
    // Intrepid Sword and Dauntless Shield give their stage in Gen 9 only with abilityOn (calcOwnEntryStage).
    expect(found(9)).toEqual([
      'Download', 'Embody Aspect (Cornerstone)', 'Embody Aspect (Hearthflame)', 'Embody Aspect (Teal)', 'Embody Aspect (Wellspring)',
    ]);
  });

  test('the body carries the battle\'s mod, for the one place the calc Pokémon is built', () => {
    const battle = battleOf('gen9customgame', [set('Garchomp', ['earthquake'])], [set('Snorlax', ['splash'])]);
    expect(bodyOf(battle, battle.sides[0].active[0]).mod).toBe(battle.dex.currentMod);
    expect(bodyOf(battle, battle.sides[0].active[0]).onField).toBe(true);
    expect(bodyOf(battle, battle.sides[1].pokemon[0]).species).toBe('Snorlax');
  });
});

const EVS = [0, 100, 252, 255];
const SPECIES = ['Alakazam', 'Snorlax', 'Tauros', 'Starmie', 'Gengar'];

function team(ev: number): PokemonSet[] {
  return SPECIES.map(species => ({
    name: species, species, item: '', ability: '', moves: ['Splash'], nature: '', gender: '', level: 100,
    evs: { hp: ev, atk: ev, def: ev, spa: ev, spd: ev, spe: ev }, ivs: { hp: 30, atk: 30, def: 30, spa: 30, spd: 30, spe: 30 },
  }));
}

describe('a Gen 1 and Gen 2 body prices the simulator\'s stats at every EV (decision 6)', () => {
  for (const formatid of ['gen1customgame', 'gen2customgame']) {
    test(`${formatid}: calcPokemon on bodyOf gives the stored stats and the maximum HP at EVs ${EVS.join(', ')}`, () => {
      const wrong: string[] = [];
      for (const ev of EVS) {
        const sets = team(ev);
        const battle = new Battle({ formatid: toID(formatid) as never, seed: '1,2,3,4', p1: { name: 'A', team: Teams.pack(sets) }, p2: { name: 'B', team: Teams.pack(sets.slice(0, 1)) } });
        const gen = calcGenerationFor(battle.gen, battle.dex.currentMod);
        for (const mon of battle.sides[0].pokemon) {
          const calc = calcPokemon(gen, bodyOf(battle, mon));
          const stats = { ...calc.rawStats, hp: calc.maxHP() } as Record<string, number>;
          const simulated = { ...mon.storedStats, hp: mon.maxhp } as Record<string, number>;
          for (const stat of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) {
            // Gen 1 has one Special stat: the simulator keeps it in spa and spd, the calc in spa.
            if (battle.gen === 1 && stat === 'spd') continue;
            if (stats[stat] !== simulated[stat]) wrong.push(`ev ${ev} ${mon.species.name} ${stat}: ${stats[stat]} vs ${simulated[stat]}`);
          }
        }
      }
      expect(wrong.slice(0, 12)).toEqual([]);
    });
  }
});

const ownEntryStage = (bodyModule as unknown as { calcOwnEntryStage?: (gen: number, ability: string) => boolean }).calcOwnEntryStage;
const BODY: CalcBody = {
  species: 'Zacian-Crowned', level: 100, ability: 'Intrepid Sword', item: 'Rusted Sword', nature: 'Hardy', evs: {}, ivs: {},
  boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, tera: null, onField: false,
};

describe('the entry stages of 0.12 (decision 5)', () => {
  test('the calc adds a stage of its own for Download, the Embody Aspects and, in Gen 8, Sword and Shield', () => {
    const found = (gen: number) => [...Generations.get(gen as 9).abilities].map(ability => ability.name).filter(name => calcAddsStages(gen, name)).sort();
    expect(found(3)).toEqual([]);
    for (const gen of [4, 5, 6, 7]) expect(found(gen), `gen ${gen}`).toEqual(['Download']);
    expect(found(8)).toEqual(['Dauntless Shield', 'Download', 'Intrepid Sword']);
    expect(found(9)).toEqual(['Download', 'Embody Aspect (Cornerstone)', 'Embody Aspect (Hearthflame)', 'Embody Aspect (Teal)', 'Embody Aspect (Wellspring)']);
  });

  test('the calc adds a stage to its holder only with abilityOn for Intrepid Sword and Dauntless Shield in Gen 9, and nothing else', () => {
    expect(typeof ownEntryStage, 'calcOwnEntryStage in calc/body.ts').toBe('function');
    const found = (gen: number) => [...Generations.get(gen as 9).abilities].map(ability => ability.name).filter(name => ownEntryStage!(gen, name)).sort();
    expect(found(9)).toEqual(['Dauntless Shield', 'Intrepid Sword']);
    for (const gen of [3, 4, 5, 6, 7, 8]) expect(found(gen), `gen ${gen}`).toEqual([]);
  });

  test('singles and doubles share the builder: a body to come in gets abilityOn for Intrepid Sword once, a body on the field never', () => {
    const gen = Generations.get(9);
    expect(calcPokemon(gen, BODY).abilityOn, 'to come in').toBe(true);
    expect(calcPokemon(gen, { ...BODY, onField: true }).abilityOn, 'on the field').toBeFalsy();
    expect(calcPokemon(gen, { ...BODY, ability: 'Pressure' }).abilityOn, 'an ability with no entry stage').toBeFalsy();
  });
});

const FORMATS = ['gen9customgame', 'gen9doublescustomgame', 'gen9championscustomgame', 'gen9championsdoublescustomgame'] as const;
type Format = typeof FORMATS[number];

const CASES = [
  { label: 'Unseen Fist on a contact move', attacker: 'Urshifu', ability: 'Unseen Fist', move: 'Close Combat', moveId: 'closecombat' },
  { label: 'Unseen Fist on a move without contact', attacker: 'Urshifu', ability: 'Unseen Fist', move: 'Aura Sphere', moveId: 'aurasphere' },
  { label: 'Piercing Drill on a contact move', attacker: 'Excadrill', ability: 'Piercing Drill', move: 'Close Combat', moveId: 'closecombat' },
] as const;

function setOf(species: string, moves: string[], ability: string, champions: boolean): PokemonSet {
  const high = champions ? 32 : 252;
  return {
    name: species, species, item: '', ability, moves, nature: 'Hardy', gender: '', level: 50,
    evs: { hp: high, atk: high, def: 0, spa: high, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  };
}

interface Hit { loss: number; range: [number, number] | null; blocks: boolean | undefined }

function play(format: Format, scene: typeof CASES[number]): Hit {
  const champions = format.includes('champions');
  const doubles = format.includes('doubles');
  const p1 = [setOf(scene.attacker, [scene.move, 'Splash'], scene.ability, champions), ...(doubles ? [setOf('Corviknight', ['Splash'], 'Pressure', champions)] : [])];
  const p2 = [setOf('Amoonguss', ['Protect', 'Splash'], 'Regenerator', champions), ...(doubles ? [setOf('Blissey', ['Splash'], 'Natural Cure', champions)] : [])];
  const battle = new Battle({ formatid: toID(format) as never, seed: '1,2,3,4', p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  const [attacker, target] = [battle.sides[0].active[0], battle.sides[1].active[0]];
  const gen = calcGenerationFor(9, battle.dex.currentMod);
  const atkBody = bodyOf(battle, attacker);
  const defBody = bodyOf(battle, target);
  const protectBlocks = (moveModule as unknown as { protectBlocks?: (g: unknown, name: string, body: unknown) => boolean }).protectBlocks;
  const blocks = protectBlocks?.(gen, scene.move, atkBody);
  const before = target.hp;
  battle.choose('p1', doubles ? `move ${scene.moveId} 1, move splash` : `move ${scene.moveId}`);
  battle.choose('p2', doubles ? 'move protect, move splash' : 'move protect');
  const loss = before - target.hp;
  if (blocks === undefined) return { loss, range: null, blocks };
  const field = new Field({ gameType: doubles ? 'Doubles' : 'Singles', defenderSide: { isProtected: blocks } });
  const range = calculate(gen, calcPokemon(gen, atkBody), calcPokemon(gen, defBody), calcMove(gen, scene.move, atkBody), field).range();
  return { loss, range: [range[0], range[1]], blocks };
}

await loadSimMods('gen9championsou');

describe('Protect reaches the calculator as the simulator plays it (decision 4)', () => {
  for (const format of FORMATS) {
    test(`${format}: the simulator's loss of a Protecting target lies in the range of the engine's field`, () => {
      const hits = CASES.map(scene => ({ scene, ...play(format, scene) }));
      for (const { scene, loss, range, blocks } of hits) {
        expect(range, `${scene.label}: protectBlocks answered ${String(blocks)}`).not.toBeNull();
        const [min, max] = range!;
        expect(loss, `${scene.label}: simulator loss ${loss}, calc ${min}-${max}`).toBeGreaterThanOrEqual(min - 1);
        expect(loss, `${scene.label}: simulator loss ${loss}, calc ${min}-${max}`).toBeLessThanOrEqual(max + 1);
      }
      // Not vacuous: the move without contact is stopped, the two contact moves are not.
      expect(hits[1].loss).toBe(0);
      expect(hits[0].loss).toBeGreaterThan(0);
      expect(hits[2].loss).toBeGreaterThan(0);
    });
  }
});

describe('stellar-first-use', () => {
  const set = setFromStellarFirstUse;
  const garchomp = (tera: string): PokemonSet => set('Garchomp', ['Earthquake', 'Stone Edge', 'Flamethrower', 'Splash'], { teraType: tera });
  const wall = (species = 'Blissey'): PokemonSet => set(species, ['Splash'], { evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 252, spe: 0 } });

  /** The battle after the click turn: Garchomp has terastallized and spent its type, the foes are healed so no roll is cut short. */
  const afterClick = (choice: string, idle: string) => (battle: Battle) => {
    battle.choose('p1', choice);
    battle.choose('p2', idle);
    for (const mon of battle.sides[1].active) mon?.sethp(mon.maxhp);
  };

  describe('singles: the odds read the first use from the spent types', () => {
    const key = { script: 'p1a:earthquake>p2a', target: { side: 1 as const, slot: 0 } };
    const rootOfTurn = (tera: string, setup?: (battle: Battle) => void, hp?: number) => rootOf('gen9customgame', [garchomp(tera)], [wall()], battle => {
      setup?.(battle);
      if (hp) battle.sides[1].active[0]!.sethp(hp);
    });

    function expectRolls(root: SimPosition, choice: string, clicks: boolean, hp: number, damages: { normal: number[]; crit: number[] }): void {
      const battle = positionBattle(root);
      const event = boundaryEvent(battle, battle.sides[0].active[0], battle.sides[1].active[0], choice, { attacker: clicks })!;
      expect(event.normalKillRolls).toBe(killing(damages.normal, hp));
      expect(event.critKillRolls).toBe(killing(damages.crit, hp));
    }

    test.each(['earthquake', 'flamethrower'])('%s: the click turn is a first use, the next turn a second one, each as the simulator rolls it', move => {
      const script = { ...key, script: `p1a:${move}>p2a` };
      const first = simDamages(rootOfTurn('Stellar'), `move ${move} terastallize`, 'move splash', script);
      const hpFirst = [...first.normal].sort((a, b) => a - b)[8];
      expect(killing(first.normal, hpFirst)).toBeGreaterThan(0);
      expect(killing(first.normal, hpFirst)).toBeLessThan(16);
      expectRolls(rootOfTurn('Stellar', undefined, hpFirst), move, true, hpFirst, first);

      const spent = afterClick(`move ${move} terastallize`, 'move splash');
      const second = simDamages(rootOfTurn('Stellar', spent), `move ${move}`, 'move splash', script);
      const hpSecond = [...second.normal].sort((a, b) => a - b)[8];
      expect(Math.max(...second.normal)).toBeLessThan(Math.max(...first.normal));
      expect(killing(second.normal, hpSecond)).toBeGreaterThan(0);
      expect(killing(second.normal, hpSecond)).toBeLessThan(16);
      expectRolls(rootOfTurn('Stellar', spent, hpSecond), move, false, hpSecond, second);
      const after = positionBattle(rootOfTurn('Stellar', spent));
      expect(bodyOf(after, after.sides[0].active[0]).stellarBoostedTypes).toEqual([move === 'earthquake' ? 'Ground' : 'Fire']);
    });

    test('a body whose Tera type is not Stellar reads as before: the table is the simulator\'s', () => {
      const first = simDamages(rootOfTurn('Fire'), 'move earthquake terastallize', 'move splash', key);
      const hp = [...first.normal].sort((a, b) => a - b)[8];
      expectRolls(rootOfTurn('Fire', undefined, hp), 'earthquake', true, hp, first);
    });
  });

  describe('doubles: the kill table of a Stellar hit holds the simulator\'s rolls', () => {
    const STONE_EDGE = 'move stoneedge 1 terastallize, move splash';
    const NEXT = 'move stoneedge 1, move splash';
    const IDLE = 'move splash, move splash';
    const doubles = (tera: string, setup?: (battle: Battle) => void) => rootOf('gen9doublescustomgame', [garchomp(tera), wall('Snorlax')], [wall(), wall('Chansey')], setup);

    test('the click turn: a first use of Rock', () => {
      const checked = checkedRolls(drawTurn(doubles('Stellar'), STONE_EDGE, IDLE));
      expect(checked.length).toBe(1);
      expect(checked.every(entry => entry.holds)).toBe(true);
      expect(checked[0].roll.snapshot.attacker.stellarBoostedTypes).toEqual([]);
    });

    test('the next turn: Rock is spent, a second use hits without the boost', () => {
      const root = doubles('Stellar', afterClick(STONE_EDGE, IDLE));
      const checked = checkedRolls(drawTurn(root, NEXT, IDLE));
      expect(checked.length).toBe(1);
      expect(checked.every(entry => entry.holds)).toBe(true);
      expect(checked[0].roll.snapshot.attacker.stellarBoostedTypes).toContain('Rock');
    });

    test('a first use of another type after the click is boosted again', () => {
      const root = doubles('Stellar', afterClick(STONE_EDGE, IDLE));
      const checked = checkedRolls(drawTurn(root, 'move flamethrower 1, move splash', IDLE));
      expect(checked.length).toBe(1);
      expect(checked.every(entry => entry.holds)).toBe(true);
    });

    test('the option\'s headline equals the simulator on the click turn', () => {
      const key = { script: 'p1a:stoneedge>p2a', target: { side: 1 as const, slot: 0 } };
      const make = (hp?: number) => doubles('Stellar', battle => { if (hp) battle.sides[1].active[0]!.sethp(hp); });
      const damages = simDamages(make(), STONE_EDGE, IDLE, key);
      const hp = [...damages.normal].sort((a, b) => a - b)[8];
      const [odds] = pairKoOdds(positionBattle(make(hp)), 'p1', [STONE_EDGE]);
      // Stone Edge crits more often (a ratio of 2 reads 1/8).
      const crit = 1 / 8;
      expect(odds?.killFraction).toBeCloseTo((1 - crit) * killing(damages.normal, hp) / 16 + crit * killing(damages.crit, hp) / 16, 10);
    });
  });
});
