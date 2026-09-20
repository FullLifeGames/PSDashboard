import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createMatchupCache, pairThreat, singleMoveFraction, threatGetter } from '../src/score/threat';
import { hazardEntryFraction } from '../src/score/hazards';
import { evalFeatures } from '../src/score/features';

/**
 * Round 54 (T57): after a Tera click the sim keeps `pokemon.types` at the
 * old types and carries the new one in `terastallized`. The static leaves
 * read the old types: smogtours-gen9ou-751207 t6, Body Press into a Ceruledge
 * that terastallized to Fighting priced 0 (Ghost is immune), while the damage
 * calc of the same engine saw a KO. 50 such false immunities stood on the
 * bank's 215 positions with a Tera body on the field.
 */

type SetOptions = { item?: string; ability?: string; teraType?: string };

const makeSet = (species: string, moves: string[], options: SetOptions = {}): PokemonSet => ({
  name: species, species, item: options.item ?? '', ability: options.ability ?? 'No Ability', moves,
  nature: 'Hardy',
  evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 100, gender: '',
  ...(options.teraType ? { teraType: options.teraType } : {}),
});

function makeBattle(p1: PokemonSet, p2: PokemonSet): Battle {
  const battle = new Battle({
    formatid: toID('gen9customgame'),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack([p1]) },
    p2: { name: 'Beta', team: Teams.pack([p2]) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

/** p1 clicks Tera on a turn in which nobody deals damage (slot 1 is Splash on both sides). */
function clickTera(battle: Battle) {
  battle.choose('p1', 'move 1 terastallize');
  battle.choose('p2', 'move 1');
  expect(battle.sides[0].active[0].terastallized).toBeTruthy();
}

describe('the defender type reads live after a Tera click (round 54)', () => {
  test('Body Press hits a Ceruledge that terastallized out of Ghost', () => {
    const battle = makeBattle(
      makeSet('Ceruledge', ['splash'], { teraType: 'Fighting' }),
      makeSet('Zamazenta', ['splash', 'bodypress']),
    );
    const [ceruledge, zamazenta] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    expect(singleMoveFraction(zamazenta, ceruledge, 'bodypress', battle)).toBe(0);
    clickTera(battle);
    expect(singleMoveFraction(zamazenta, ceruledge, 'bodypress', battle)).toBeGreaterThan(0.3);
  });

  test('the type chart follows: Tera Fairy drops Gholdengo\'s Steel resistances', () => {
    const battle = makeBattle(
      makeSet('Gholdengo', ['splash'], { teraType: 'Fairy' }),
      makeSet('Dragonite', ['splash', 'outrage', 'ironhead']),
    );
    const [gholdengo, dragonite] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    const steelBefore = singleMoveFraction(dragonite, gholdengo, 'ironhead', battle);
    clickTera(battle);
    // Dragon into Fairy is an immunity, Steel into Fairy is super effective (was resisted).
    expect(singleMoveFraction(dragonite, gholdengo, 'outrage', battle)).toBe(0);
    expect(singleMoveFraction(dragonite, gholdengo, 'ironhead', battle)).toBeCloseTo(steelBefore * 4, 6);
  });

  test('the memo answers like a fresh reading across the click', () => {
    const battle = makeBattle(
      makeSet('Ceruledge', ['splash'], { teraType: 'Fighting' }),
      makeSet('Zamazenta', ['splash', 'bodypress']),
    );
    const [ceruledge, zamazenta] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    const cached = threatGetter(battle, createMatchupCache());
    expect(cached(zamazenta, ceruledge)).toEqual(pairThreat(zamazenta, ceruledge, battle));
    clickTera(battle);
    expect(cached(zamazenta, ceruledge)).toEqual(pairThreat(zamazenta, ceruledge, battle));
    expect(cached(zamazenta, ceruledge).physical).toBeGreaterThan(0.3);
  });

  describe('hazards', () => {
    const entryAcrossTheClick = (species: string, teraType: string, hazard: string) => {
      const battle = makeBattle(makeSet(species, ['splash'], { teraType }), makeSet('Blissey', ['splash']));
      const side = battle.sides[0];
      side.addSideCondition(hazard, battle.sides[1].active[0]);
      const before = hazardEntryFraction(side.active[0], side, battle);
      clickTera(battle);
      return { before, after: hazardEntryFraction(side.active[0], side, battle) };
    };

    test('Stealth Rock prices the Tera type: Garchomp resists Rock, Tera Fire is weak to it', () => {
      const { before, after } = entryAcrossTheClick('Garchomp', 'Fire', 'stealthrock');
      expect(before).toBeCloseTo(0.0625, 6);
      expect(after).toBeCloseTo(0.25, 6);
    });

    test('Toxic Spikes spare a body that terastallized to Steel', () => {
      const { before, after } = entryAcrossTheClick('Dragapult', 'Steel', 'toxicspikes');
      expect(before).toBeCloseTo(0.06, 6);
      expect(after).toBe(0);
    });

    // Grounding goes through the sim's isGrounded(), which saw Tera before this round.
    test('Spikes already follow the grounding in both directions', () => {
      expect(entryAcrossTheClick('Garchomp', 'Flying', 'spikes')).toEqual({ before: 0.125, after: 0 });
      expect(entryAcrossTheClick('Corviknight', 'Steel', 'spikes')).toEqual({ before: 0, after: 0.125 });
    });
  });

  test('Black Sludge feeds a holder that terastallized to Poison', () => {
    const battle = makeBattle(
      makeSet('Gholdengo', ['splash'], { teraType: 'Poison', item: 'Black Sludge' }),
      makeSet('Blissey', ['splash']),
    );
    // One full-HP body a side: the bodies term is the holder's item multiplier minus 1.
    expect(evalFeatures(battle).bodies).toBeCloseTo(-0.1, 6);
    clickTera(battle);
    expect(evalFeatures(battle).bodies).toBeCloseTo(0.03, 6);
  });
});
