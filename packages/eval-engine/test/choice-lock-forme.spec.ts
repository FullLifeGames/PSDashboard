import { describe, expect, test } from 'vitest';
import { Dex, type PokemonSet } from '@pkmn/sim';
import type { OpponentTeamInfo, RevealedPokemonInfo } from '@fulllifegames/replay-core';
import { calcGenerationFor } from '@fulllifegames/replay-core';
import { corroborateChoiceItem } from '../src/choice-lock';
import { isBodyOf } from '../src/choice-lock-defender';
import { battleOf } from './power-oracle';
import { set } from './move-oracle';

/**
 * Round 69 (lane A's request for T190, here with T193): a log names the battle forme a body stands in (Aegislash-Blade
 * after Stance Change), but the built set is the base species'. The Choice item check matches the body to its set by
 * the Dex (battleOnly, changesFrom, the species a Mega Stone turns into), not by the logged name, and prices the hit
 * with the forme's stats on the set's nature and spread. The oracle is the simulator: the damage a real Stance Change
 * body deals or takes in one turn, read as the fraction of the defender's HP. Singles and doubles are the same function.
 */
const PARTNER = () => set('Blissey', ['splash'], { ability: 'Natural Cure' });

/** A turn in `format`: the choices are for the first slot of each side, the partner only splashes. */
function play(format: string, p1: PokemonSet, p2: PokemonSet, choices: { p1: string; p2: string }) {
  const doubles = format.includes('doubles');
  const battle = battleOf(format, doubles ? [p1, PARTNER()] : [p1], doubles ? [p2, PARTNER()] : [p2]);
  const target = battle.sides[1].active[0];
  const before = target.hp;
  battle.makeChoices(doubles ? `${choices.p1}, move splash` : choices.p1, doubles ? `${choices.p2}, move splash` : choices.p2);
  const log = battle.log.join('\n');
  expect(log).not.toMatch(/\|-crit\|/);
  expect(before).toBe(target.maxhp);
  return { log, fraction: (before - target.hp) / target.maxhp };
}

const observation = (attackerSpecies: string, defenderSpecies: string, moveId: string, fraction: number) => [{
  attackerSpecies, defenderSpecies, attackerSide: 'p1' as const, moveId, observedFraction: fraction, lethal: false,
  attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
}];

/** The inference of the defenders' side: Aegislash with the item the log showed. */
function shown(species: string, item: string): Record<'p1' | 'p2', OpponentTeamInfo> {
  const field = (value: string, source: string) => ({ value, source, probability: 1 }) as RevealedPokemonInfo['item'];
  const mon = {
    species, moves: [], ability: field('', 'unknown'), item: field(item, 'revealed'), teraType: field('', 'unknown'),
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, level: 100, gender: '',
  } as unknown as RevealedPokemonInfo;
  return { p1: { pokemon: [] }, p2: { pokemon: [mon] } };
}

describe('a battle forme reaches the Choice item check through its base species (lane A request)', () => {
  for (const format of ['gen9customgame', 'gen9doublescustomgame']) {
    const kind = format.includes('doubles') ? 'doubles' : 'singles';
    const target = format.includes('doubles') ? ' 1' : '';

    test(`${kind}: a Choice Band Aegislash that hit as Aegislash-Blade corroborates the Band`, () => {
      const aegislash = () => set('Aegislash', ['ironhead', 'splash'], { item: 'Choice Band', ability: 'Stance Change', nature: 'Adamant' });
      const dusclops = () => set('Dusclops', ['tackle'], { ability: 'Pressure' });
      const { log, fraction } = play(format, aegislash(), dusclops(), { p1: `move ironhead${target}`, p2: `move tackle${target}` });
      expect(log).toMatch(/\|-formechange\|p1a: Aegislash\|Aegislash-Blade/);
      expect(fraction).toBeGreaterThan(0.05);
      const teams = { p1Team: [aegislash()], p2Team: [dusclops()] };
      expect(corroborateChoiceItem('p1', 'Aegislash', 'Choice Band', teams, observation('Aegislash-Blade', 'Dusclops', 'ironhead', fraction), 9)).toBe('corroborated');
    });

    test(`${kind}: an Assault Vest Aegislash hit as Aegislash-Blade keeps its set and its shown item, the Specs hit is corroborated`, () => {
      const vest = () => set('Aegislash', ['shadowsneak', 'splash'], { item: 'Assault Vest', ability: 'Stance Change' });
      const latios = () => set('Latios', ['psychic', 'splash'], { item: 'Choice Specs', ability: 'Levitate' });
      const { log, fraction } = play(format, latios(), vest(), { p1: `move psychic${target}`, p2: `move shadowsneak${target}` });
      expect(log).toMatch(/\|-formechange\|p2a: Aegislash\|Aegislash-Blade/);
      expect(fraction).toBeGreaterThan(0.05);
      const teams = { p1Team: [latios()], p2Team: [vest()] };
      const hit = observation('Latios', 'Aegislash-Blade', 'psychic', fraction);
      // The built Vest is a guess the item range keeps open (ambiguous); the log showing it makes the Specs the only reading.
      expect(corroborateChoiceItem('p1', 'Latios', 'Choice Specs', teams, hit, 9)).toBe('ambiguous');
      expect(corroborateChoiceItem('p1', 'Latios', 'Choice Specs', teams, hit, 9, undefined, shown('Aegislash', 'Assault Vest'))).toBe('corroborated');
    });
  }
});

describe('the Dex says which species a forme stands for', () => {
  const gen = calcGenerationFor(9);

  test('every forme a Mega Stone makes (the Mega-Z formes too) is a body of its base species, and of no other', () => {
    const pairs = Dex.items.all().flatMap(item => Object.entries(item.megaStone ?? {}));
    expect(pairs.map(([, forme]) => forme)).toContain('Garchomp-Mega-Z');
    for (const [base, forme] of pairs) {
      expect(isBodyOf(gen, forme, base), forme).toBe(true);
      expect(isBodyOf(gen, forme, 'Dusclops'), forme).toBe(false);
    }
  });

  test('battle formes follow battleOnly and changesFrom (Stance Change, Busted Disguise, Ash-Greninja up to the Bond form)', () => {
    expect(isBodyOf(gen, 'Aegislash-Blade', 'Aegislash')).toBe(true);
    expect(isBodyOf(gen, 'Mimikyu-Busted', 'Mimikyu')).toBe(true);
    expect(isBodyOf(gen, 'Greninja-Ash', 'Greninja-Bond')).toBe(true);
    expect(isBodyOf(gen, 'Aegislash', 'Aegislash-Blade')).toBe(false);
    expect(isBodyOf(gen, 'Aegislash-Blade', 'Mimikyu')).toBe(false);
  });
});
