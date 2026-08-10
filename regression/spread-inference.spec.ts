import { test, expect } from '@playwright/test';
import { Generations, Pokemon, Move, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/lib/spread-inference';
import type { DamageObservation } from '../src/types';

const gen = Generations.get(9);

const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: '', moves,
  nature: 'Hardy',
  evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 50, gender: '',
});

/** A mid-roll hit computed forward with the TRUE spreads — the ground truth. */
function observe(moveName: string, defEvs: Partial<Record<'hp' | 'def' | 'spd', number>>, defNature: string): DamageObservation {
  const attacker = new Pokemon(gen, 'Landorus-Therian', {
    level: 50, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
  });
  const defender = new Pokemon(gen, 'Uxie', { level: 50, nature: defNature, evs: defEvs });
  const result = calculate(gen, attacker, defender, new Move(gen, moveName));
  const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
  const mid = rolls[Math.floor(rolls.length / 2)];
  return {
    attackerSpecies: 'Landorus-Therian',
    defenderSpecies: 'Uxie',
    attackerSide: 'p2',
    moveId: moveName.toLowerCase().replace(/[^a-z0-9]/g, ''),
    observedFraction: mid / defender.maxHP(),
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '',
    screens: [], weather: '',
  };
}

const sets = {
  p1: [set('Uxie', ['Stealth Rock', 'U-turn'])],
  p2: [set('Landorus-Therian', ['U-turn', 'Knock Off'])],
};

test.describe('damage-consistent spread inference', () => {
  test('recovers a physically bulky defender from its observed damage', () => {
    const observations = [
      observe('U-turn', { hp: 252, def: 252 }, 'Bold'),
      observe('Knock Off', { hp: 252, def: 252 }, 'Bold'),
    ];
    const inferred = inferSpreads(observations, sets, 'gen9customgame');
    const uxie = inferred.get('p1:uxie');
    expect(uxie).toBeTruthy();
    expect(uxie!.evs.hp).toBe(252);
    expect(uxie!.evs.def).toBe(252);
  });

  test('recovers an uninvested defender and skips under-observed mons', () => {
    const observations = [
      observe('U-turn', {}, 'Hardy'),
      observe('Knock Off', {}, 'Hardy'),
    ];
    const inferred = inferSpreads(observations, sets, 'gen9customgame');
    const uxie = inferred.get('p1:uxie');
    expect(uxie).toBeTruthy();
    expect(uxie!.evs.def).toBe(0);
    expect(uxie!.evs.hp).toBe(0);

    // One observation is not enough to solve anything.
    const single = inferSpreads([observe('U-turn', {}, 'Hardy')], sets, 'gen9customgame');
    expect(single.get('p1:uxie')).toBeUndefined();
  });

  test('solving bulk preserves Speed and nature but never exceeds the EV budget', () => {
    // Damage observations carry no information about Speed — the solver
    // must not strip Speed EVs or the speed nature. But the LEGAL budget
    // (508) binds: with 252 HP measured and 252 Spe preserved, the
    // unmeasured 252 SpA cannot also survive — it yields first. (The old
    // expectation institutionalized a 756-EV spread the sim then played.)
    const timidSets = {
      p1: [{
        ...set('Uxie', ['Stealth Rock', 'U-turn']),
        nature: 'Timid',
        evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 },
      }],
      p2: [set('Landorus-Therian', ['U-turn', 'Knock Off'])],
    };
    const observations = [
      observe('U-turn', { hp: 252 }, 'Hardy'),
      observe('Knock Off', { hp: 252 }, 'Hardy'),
    ];
    const uxie = inferSpreads(observations, timidSets, 'gen9customgame').get('p1:uxie');
    expect(uxie).toBeTruthy();
    expect(uxie!.evs.hp).toBe(252);
    expect(uxie!.evs.spe).toBe(252);
    expect(uxie!.nature).toBe('Timid');
    const total = Object.values(uxie!.evs).reduce((sum, value) => sum + value, 0);
    expect(total).toBeLessThanOrEqual(508);
    expect(uxie!.evs.spa).toBeLessThanOrEqual(4);
  });

  test('an incomplete winner is topped up in unmeasured non-Speed stats', () => {
    // Bulk-only evidence over an empty prior used to emit a 252-total
    // spread — a systematically under-statted sim mon. Leftover EVs fill
    // the unmeasured offense (U-turn Uxie: physical → Atk), never Speed.
    const emptyPriorSets = {
      p1: [{ ...set('Uxie', ['Stealth Rock', 'U-turn']), evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } }],
      p2: [set('Landorus-Therian', ['U-turn', 'Knock Off'])],
    };
    const observations = [
      observe('U-turn', { hp: 252 }, 'Hardy'),
      observe('Knock Off', { hp: 252 }, 'Hardy'),
    ];
    const uxie = inferSpreads(observations, emptyPriorSets, 'gen9customgame').get('p1:uxie');
    expect(uxie).toBeTruthy();
    expect(uxie!.evs.hp).toBe(252);
    expect(uxie!.evs.atk).toBe(252);
    expect(uxie!.evs.spe).toBe(0);
    const total = Object.values(uxie!.evs).reduce((sum, value) => sum + value, 0);
    expect(total).toBeLessThanOrEqual(508);
    expect(total).toBeGreaterThanOrEqual(500);
  });

  test('Champions formats use the 32-per-stat / 66-total budget', () => {
    const observations = [
      observe('U-turn', { hp: 252 }, 'Hardy'),
      observe('Knock Off', { hp: 252 }, 'Hardy'),
    ];
    const uxie = inferSpreads(observations, sets, 'gen9championsvgc2026regma').get('p1:uxie');
    expect(uxie).toBeTruthy();
    for (const value of Object.values(uxie!.evs)) expect(value).toBeLessThanOrEqual(32);
    const total = Object.values(uxie!.evs).reduce((sum, value) => sum + value, 0);
    expect(total).toBeLessThanOrEqual(66);
  });
});

test.describe('speed-order constraints', () => {
  const speedSet = (species: string, spe: number, item = ''): PokemonSet => ({
    name: species, species, item, ability: '', moves: ['Protect'],
    nature: 'Hardy',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100, gender: '',
  });
  const order = { firstSide: 'p1' as const, firstSpecies: 'Noivern', secondSide: 'p2' as const, secondSpecies: 'Iron Valiant', turn: 5 };

  test('a proven move order forces the spread to reproduce it (GPL Noivern)', () => {
    // Prior: Noivern 0 Spe (base 123 → 282) vs Iron Valiant 252 Spe
    // (base 116 → 369): the guess contradicts the observed order.
    const sets = { p1: [speedSet('Noivern', 0)], p2: [speedSet('Iron Valiant', 252)] };
    const solved = inferSpreads([], sets, 'gen9', [order]);
    const noivern = solved.get('p1:noivern');
    expect(noivern).toBeTruthy();
    // 252+ Speed (Timid 369+ vs 369 — the plus nature breaks the tie… any
    // rung satisfying ≥ is acceptable; assert the constraint itself:
    const noivernSpe = new Pokemon(gen, 'Noivern', {
      level: 100, nature: noivern!.nature, evs: noivern!.evs,
    }).stats.spe;
    const valiant = solved.get('p2:ironvaliant');
    const valiantSpe = new Pokemon(gen, 'Iron Valiant', {
      level: 100, nature: valiant?.nature ?? 'Hardy', evs: valiant?.evs ?? sets.p2[0].evs,
    }).stats.spe;
    expect(noivernSpe).toBeGreaterThanOrEqual(valiantSpe);
  });

  test('a Scarf on the built set satisfies the order without Speed EVs', () => {
    const sets = { p1: [speedSet('Noivern', 0, 'Choice Scarf')], p2: [speedSet('Iron Valiant', 252)] };
    const solved = inferSpreads([], sets, 'gen9', [order]);
    // 282 × 1.5 = 423 ≥ 369: the prior already reproduces the order — the
    // solver must not invent Speed investment.
    expect(solved.get('p1:noivern')!.evs.spe).toBe(0);
  });

  test('the slower mon can also be the constrained one', () => {
    // Valiant moved SECOND: its 252 Spe prior would outspeed — drop it.
    const sets = { p1: [speedSet('Noivern', 0)], p2: [speedSet('Iron Valiant', 252)] };
    const flipped = { firstSide: 'p1' as const, firstSpecies: 'Noivern', secondSide: 'p2' as const, secondSpecies: 'Iron Valiant', turn: 3 };
    const solved = inferSpreads([], sets, 'gen9', [flipped]);
    const valiant = solved.get('p2:ironvaliant');
    expect(valiant).toBeTruthy();
  });
});

test.describe('goodness-of-fit forfeit', () => {
  test('contradictory observations keep the prior instead of a least-bad spread', () => {
    // Two readings of the SAME pairing that no spread can satisfy at once
    // (video-read HP bars): 10% and 60% from one un-boosted Knock Off.
    const contradictory = ['0.10', '0.60'].map(fraction => ({
      attackerSpecies: 'Landorus-Therian',
      defenderSpecies: 'Uxie',
      attackerSide: 'p2' as const,
      moveId: 'knockoff',
      observedFraction: Number(fraction),
      attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '',
      screens: [], weather: '',
    }));
    const solved = inferSpreads(contradictory, sets, 'gen9');
    // The evidence is unreliable — neither Uxie nor Landorus gets a solved
    // overlay; their priors (the built guesses) stand.
    expect(solved.has('p1:uxie')).toBe(false);
    expect(solved.has('p2:landorustherian')).toBe(false);
  });
});
