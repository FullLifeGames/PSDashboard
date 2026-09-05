import { test, expect, describe } from 'vitest';
import { Generations, Pokemon, Move, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/spread-inference';
import { buildSolveContext, observationError } from '../src/spreads/fit';
import { toId } from '../src/ids';
import type { SpeedKnowledge } from '../src/spreads/scarf';
import type { DamageObservation, PokemonEvs } from '../src/types';

const gen = Generations.get(9);

const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: '', moves,
  nature: 'Hardy',
  evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 50, gender: '',
});

/** A mid-roll hit computed forward with the TRUE spreads — the ground truth. */
function observe(moveName: string, defEvs: Partial<Record<'hp' | 'def' | 'spd', number>>, defNature: string, lethal = false): DamageObservation {
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
    moveId: toId(moveName),
    observedFraction: mid / defender.maxHP(),
    lethal,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '',
    screens: [], weather: '',
  };
}

const sets = {
  p1: [set('Uxie', ['Stealth Rock', 'U-turn'])],
  p2: [set('Landorus-Therian', ['U-turn', 'Knock Off'])],
};

describe('damage-consistent spread inference', () => {
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

  test('a lethal hit is a lower bound: overkill rungs are not refuted, short rungs are', () => {
    // Truth: an uninvested Uxie. Two clean hits say so; the third hit
    // knocked out an Uxie that had 5% left. Read as a damage reading,
    // "5%" punishes every rung whose weakest roll exceeds 5% and pulls the
    // solve toward bulk (573756: p1 Toxapex was fitted as physically
    // defensive off its own knock-out); read as a bound it refutes nothing.
    const clean = [observe('U-turn', {}, 'Hardy'), observe('Knock Off', {}, 'Hardy')];
    const lethal: DamageObservation = { ...observe('Knock Off', {}, 'Hardy', true), observedFraction: 0.05 };
    const inferred = inferSpreads([...clean, lethal], sets, 'gen9customgame');
    const uxie = inferred.get('p1:uxie');
    expect(uxie).toBeTruthy();
    expect(uxie!.evs.def).toBe(0);
    expect(uxie!.evs.hp).toBe(0);
    // Control: the same line read as an exact 5% does not reproduce the truth.
    const misread = inferSpreads([...clean, { ...lethal, lethal: false }], sets, 'gen9customgame').get('p1:uxie');
    expect(misread === undefined || misread.evs.hp > 0 || misread.evs.def > 0).toBe(true);
    // Direct: 5% left is overkill for every rung, so the line refutes none;
    // a mid roll left refutes the rung whose best roll cannot reach it.
    const ctx = buildSolveContext([...clean, lethal], sets, 'gen9customgame', []);
    const uninvested = { nature: 'Hardy', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } };
    const bulky = { nature: 'Bold', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } };
    expect(observationError(ctx, lethal, 'p1:uxie', uninvested)).toBe(0);
    expect(observationError(ctx, lethal, 'p1:uxie', bulky)).toBe(0);
    const midLeft = { ...lethal, observedFraction: clean[1].observedFraction };
    expect(observationError(ctx, midLeft, 'p1:uxie', uninvested)).toBe(0);
    expect(observationError(ctx, midLeft, 'p1:uxie', bulky)).toBeGreaterThan(0);
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

describe('speed-order constraints', () => {
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

  // Round 37: Choice Scarf decisions from orders no plausible spread of the
  // first mover reproduces. Usage spreads stand in for the Smogon stats.
  const usage = (entries: [string, number, number][]) =>
    entries.map(([nature, spe, probability]) => ({ nature, probability, evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe } }));
  const knowledge = (entries: [string, Partial<SpeedKnowledge>][]): Map<string, SpeedKnowledge> => new Map(entries.map(([key, value]) => [key, {
    itemKnown: false, scarfRuledOut: false, spreadKnown: false, spreads: [], ...value,
  }]));
  const speOf = (species: string, candidate: { nature: string; evs: PokemonEvs } | undefined, fallback: PokemonSet) =>
    new Pokemon(gen, species, { level: 100, nature: candidate?.nature ?? fallback.nature, evs: candidate?.evs ?? fallback.evs }).stats.spe;
  const magOrder = { firstSide: 'p1' as const, firstSpecies: 'Magnezone', secondSide: 'p2' as const, secondSpecies: 'Garchomp', turn: 72 };
  const tuskOrder = { firstSide: 'p1' as const, firstSpecies: 'Gholdengo', secondSide: 'p2' as const, secondSpecies: 'Great Tusk', turn: 6 };
  const jolly = (set: PokemonSet): PokemonSet => ({ ...set, nature: 'Jolly' });

  test('a mover that cannot reach the order at full Speed holds a Choice Scarf (573756 Magnezone)', () => {
    // Magnezone (base 60, 240 at most) moved before a Jolly 252 Garchomp (333). Garchomp's usage:
    // Jolly and Adamant 252 dominate, a Careful 16-Spe wall is a 10% remainder outside the camp.
    const sets = { p1: [{ ...speedSet('Magnezone', 0), moves: ['Flash Cannon'] }], p2: [jolly(speedSet('Garchomp', 252))] };
    const solved = inferSpreads([], sets, 'gen8', [magOrder], knowledge([
      ['p1:magnezone', { spreads: usage([['Timid', 252, 0.44], ['Bold', 176, 0.1]]) }],
      ['p2:garchomp', { spreads: usage([['Jolly', 252, 0.5], ['Adamant', 252, 0.3], ['Careful', 16, 0.1]]) }],
    ]));
    const magnezone = solved.get('p1:magnezone')!;
    expect(magnezone.item).toBe('Choice Scarf');
    expect(magnezone.itemReason).toBe('moved-first');
    // Neutral 252 with the Scarf (328) stays under 333: the plus nature carries the order.
    expect(magnezone.nature).toBe('Timid');
    expect(magnezone.evs.spe).toBe(252);
    // Garchomp keeps its prior Speed: the order is explained by the Scarf.
    expect(speOf('Garchomp', solved.get('p2:garchomp'), sets.p2[0])).toBe(333);
  });

  test('a species that never invests in Speed gets no Scarf (Ho-Oh)', () => {
    const sets = { p1: [speedSet('Ho-Oh', 0)], p2: [speedSet('Koraidon', 252)] };
    const hoOhOrder = { firstSide: 'p1' as const, firstSpecies: 'Ho-Oh', secondSide: 'p2' as const, secondSpecies: 'Koraidon', turn: 3 };
    const solved = inferSpreads([], sets, 'gen9', [hoOhOrder], knowledge([
      ['p1:hooh', { spreads: usage([['Impish', 0, 0.6], ['Careful', 8, 0.3]]) }],
      ['p2:koraidon', { spreads: usage([['Jolly', 252, 0.9]]) }],
    ]));
    expect(solved.get('p1:hooh')?.item).toBeUndefined();
  });

  test('an opponent with a common slow spread makes the order reachable: no Scarf', () => {
    // Gholdengo (293 at most) before a Great Tusk whose usage splits into a 252-Spe sweeper and a 0-Spe wall (210).
    const sets = { p1: [speedSet('Gholdengo', 0)], p2: [speedSet('Great Tusk', 252)] };
    const solved = inferSpreads([], sets, 'gen9', [tuskOrder], knowledge([
      ['p1:gholdengo', { spreads: usage([['Timid', 252, 0.6]]) }],
      ['p2:greattusk', { spreads: usage([['Jolly', 252, 0.5], ['Impish', 0, 0.4]]) }],
    ]));
    expect(solved.get('p1:gholdengo')?.item).toBeUndefined();
  });

  test('a confident fast guess counts like knowledge (camp rule)', () => {
    // Same pair, but the wall is a 6% oddity: Tusk is measured at its Jolly 252 (300) and Gholdengo holds the Scarf.
    const sets = { p1: [speedSet('Gholdengo', 0)], p2: [speedSet('Great Tusk', 252)] };
    const solved = inferSpreads([], sets, 'gen9', [tuskOrder], knowledge([
      ['p1:gholdengo', { spreads: usage([['Timid', 252, 0.6]]) }],
      ['p2:greattusk', { spreads: usage([['Jolly', 252, 0.9], ['Impish', 0, 0.06]]) }],
    ]));
    expect(solved.get('p1:gholdengo')?.item).toBe('Choice Scarf');
  });

  test('a known opponent spread beats the usage floor', () => {
    const sets = { p1: [speedSet('Gholdengo', 0)], p2: [jolly(speedSet('Great Tusk', 252))] };
    const solved = inferSpreads([], sets, 'gen9', [tuskOrder], knowledge([
      ['p1:gholdengo', { spreads: usage([['Timid', 252, 0.6]]) }],
      ['p2:greattusk', { spreadKnown: true, spreads: usage([['Jolly', 252, 0.5], ['Impish', 0, 0.4]]) }],
    ]));
    expect(solved.get('p1:gholdengo')?.item).toBe('Choice Scarf');
  });

  test('a known mover spread caps its top speed: no Scarf on 0 Speed EVs', () => {
    const sets = { p1: [speedSet('Magnezone', 0)], p2: [speedSet('Garchomp', 252)] };
    const solved = inferSpreads([], sets, 'gen8', [magOrder], knowledge([
      ['p1:magnezone', { spreadKnown: true }],
      ['p2:garchomp', { spreads: usage([['Jolly', 252, 0.9]]) }],
    ]));
    expect(solved.get('p1:magnezone')?.item).toBeUndefined();
  });

  test('a guessed Scarf the order contradicts is dropped (Kyogre)', () => {
    // Koraidon (405 at most) moved before a Kyogre built with a guessed Scarf (306 × 1.5 = 459); without the Scarf a common spread fits.
    const sets = { p1: [speedSet('Koraidon', 252)], p2: [speedSet('Kyogre', 252, 'Choice Scarf')] };
    const kyogreOrder = { firstSide: 'p1' as const, firstSpecies: 'Koraidon', secondSide: 'p2' as const, secondSpecies: 'Kyogre', turn: 4 };
    const solved = inferSpreads([], sets, 'gen9', [kyogreOrder], knowledge([
      ['p1:koraidon', { spreads: usage([['Jolly', 252, 0.9]]) }],
      ['p2:kyogre', { spreads: usage([['Timid', 252, 0.5], ['Modest', 0, 0.3]]) }],
    ]));
    const kyogre = solved.get('p2:kyogre')!;
    expect(kyogre.item).toBe('');
    expect(kyogre.itemReason).toBe('moved-second');
  });

  test('known items and ruled-out Scarfs are never touched', () => {
    const sets = { p1: [speedSet('Magnezone', 0)], p2: [speedSet('Garchomp', 252)] };
    for (const known of [{ itemKnown: true }, { scarfRuledOut: true }]) {
      const solved = inferSpreads([], sets, 'gen8', [magOrder], knowledge([
        ['p1:magnezone', { ...known, spreads: usage([['Timid', 252, 0.44]]) }],
        ['p2:garchomp', { spreads: usage([['Jolly', 252, 0.9]]) }],
      ]));
      expect(solved.get('p1:magnezone')?.item).toBeUndefined();
    }
  });

  test('without knowledge the solver behaves as before', () => {
    const sets = { p1: [speedSet('Noivern', 0)], p2: [speedSet('Iron Valiant', 252)] };
    const solved = inferSpreads([], sets, 'gen9', [order]);
    expect(solved.get('p1:noivern')?.item).toBeUndefined();
  });
});

describe('goodness-of-fit forfeit', () => {
  test('contradictory observations keep the prior instead of a least-bad spread', () => {
    // Two readings of the SAME pairing that no spread can satisfy at once
    // (video-read HP bars): 10% and 60% from one un-boosted Knock Off.
    const contradictory = ['0.10', '0.60'].map(fraction => ({
      attackerSpecies: 'Landorus-Therian',
      defenderSpecies: 'Uxie',
      attackerSide: 'p2' as const,
      moveId: 'knockoff',
      observedFraction: Number(fraction),
      lethal: false,
      attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '',
      screens: [], weather: '',
    }));
    const solved = inferSpreads(contradictory, sets, 'gen9');
    // The evidence is unreliable — neither Uxie nor Landorus gets a solved
    // overlay; their priors (the built guesses) stand.
    expect(solved.has('p1:uxie')).toBe(false);
    expect(solved.has('p2:landorustherian')).toBe(false);
  });

  test('a typeless HP observation is fitted with the set\'s resolved type', () => {
    // The protocol only ever records "hiddenpower"; the builder substitutes
    // the typed variant into the set. Fitting the observation with the
    // IV-default type instead (x1 Dark vs x4 Ice on Landorus) makes the
    // solver explain a near-KO with absurd bulk assumptions — 653785:
    // Dragonite survived the real t24 hit at 24/335, the Dark-fitted sim
    // rolled a kill and the reconstruction lost its final turns.
    const gen7 = Generations.get(7);
    const attacker = new Pokemon(gen7, 'Manectric', {
      level: 50, nature: 'Hardy',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    });
    const trueDefender = new Pokemon(gen7, 'Landorus-Therian', {
      level: 50, nature: 'Calm', evs: { hp: 252, spd: 252 },
    });
    const result = calculate(gen7, attacker, trueDefender, new Move(gen7, 'Hidden Power Ice'));
    const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
    const mid = rolls[Math.floor(rolls.length / 2)];
    const hpObservation: DamageObservation = {
      attackerSpecies: 'Manectric', defenderSpecies: 'Landorus-Therian',
      attackerSide: 'p1', moveId: 'hiddenpower',
      observedFraction: mid / trueDefender.maxHP(),
      lethal: false,
      attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    };
    const typedSets = {
      p1: [set('Manectric', ['Hidden Power Ice', 'Thunderbolt'])],
      p2: [set('Landorus-Therian', ['Earthquake', 'U-turn'])],
    };
    const inferred = inferSpreads([hpObservation, hpObservation], typedSets, 'gen7customgame');
    const lando = inferred.get('p2:landorustherian');
    expect(lando).toBeTruthy();
    expect(lando!.evs.hp).toBe(252);
    expect(lando!.evs.spd).toBe(252);
  });
});

describe('evidence that cannot measure keeps the prior', () => {
  type Side = { species: string; side: 'p1' | 'p2'; nature: string; evs: PokemonSet['evs']; item?: string };
  const mon = (species: string, side: 'p1' | 'p2', nature: string, evs: PokemonSet['evs'], item = ''): Side => ({ species, side, nature, evs, item });
  const asSet = (m: Side, moves: string[]): PokemonSet => ({
    name: m.species, species: m.species, item: m.item ?? '', ability: '', moves,
    nature: m.nature, evs: m.evs,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100, gender: '',
  });
  /** A mid-roll hit computed forward with the TRUE spreads of both sides (level 100). */
  function hit(attacker: Side, defender: Side, moveName: string, lethal = false): DamageObservation {
    const a = new Pokemon(gen, attacker.species, { level: 100, nature: attacker.nature, evs: attacker.evs, item: attacker.item || undefined });
    const d = new Pokemon(gen, defender.species, { level: 100, nature: defender.nature, evs: defender.evs });
    const result = calculate(gen, a, d, new Move(gen, moveName));
    const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
    const mid = rolls[Math.floor(rolls.length / 2)];
    return {
      attackerSpecies: attacker.species, defenderSpecies: defender.species, attackerSide: attacker.side,
      moveId: toId(moveName), observedFraction: mid / d.maxHP(), lethal,
      attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    };
  }
  const offensive = { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 };
  const bulky = { hp: 252, atk: 0, def: 0, spa: 0, spd: 252, spe: 4 };

  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    test(`knock-outs alone keep the prior's offense investment (${formatid})`, () => {
      // Prior: the curated Swords Dance Garchomp (252 Atk / 252 Spe). It was
      // seen attacking twice, both hits knock-outs (lower bounds any Atk
      // reaches), and it took one Magnezone hit whose damage a bulky spread
      // explains better. 573756: the old solve traded the whole offense
      // for bulk (252 HP / 252 SpD / 0 Atk) and fielded a 0-Atk sweeper.
      const garchomp = mon('Garchomp', 'p2', 'Jolly', offensive);
      const magnezone = mon('Magnezone', 'p1', 'Modest', { hp: 0, atk: 0, def: 4, spa: 252, spd: 0, spe: 252 }, 'Choice Specs');
      const clefable = mon('Clefable', 'p1', 'Bold', { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 });
      const sets = {
        p1: [asSet(magnezone, ['Flash Cannon']), asSet(clefable, ['Moonblast'])],
        p2: [asSet(garchomp, ['Earthquake', 'Swords Dance'])],
      };
      const observations = [
        { ...hit(garchomp, clefable, 'Earthquake'), observedFraction: 0.3, lethal: true },
        { ...hit(garchomp, magnezone, 'Earthquake'), observedFraction: 0.5, lethal: true },
        hit(magnezone, { ...garchomp, evs: bulky }, 'Flash Cannon'),
      ];
      const solved = inferSpreads(observations, sets, formatid).get('p2:garchomp');
      const evs = solved?.evs ?? sets.p2[0].evs;
      expect(evs.atk).toBe(252);
      // Control: the same Magnezone line with a CLEAN Garchomp hit measured
      // at 0 Atk lets the offense go — that evidence can tell.
      const measured = [
        hit({ ...garchomp, evs: bulky }, clefable, 'Earthquake'),
        hit({ ...garchomp, evs: bulky }, magnezone, 'Earthquake'),
        hit(magnezone, { ...garchomp, evs: bulky }, 'Flash Cannon'),
      ];
      const weak = inferSpreads(measured, sets, formatid).get('p2:garchomp');
      expect(weak?.evs.atk).toBe(0);
    });
  }

  test('a move order no rung can repair keeps the prior Speed', () => {
    // Garchomp moved after a Toxapex (base 35: even 252+ Speed stays below
    // an uninvested Garchomp) — the real Toxapex must have carried a Scarf
    // the build does not know. Every rung violates the order alike, so the
    // order measures nothing about Garchomp; the old solve let the budget
    // shave the prior's 252 Spe to 0 for the bulk rung the damage lines
    // asked for. Garchomp carries the most lines, so the greedy solve
    // takes it first and its bulk, not the attackers' offense, explains them.
    const garchomp = mon('Garchomp', 'p2', 'Jolly', offensive);
    const toxapex = mon('Toxapex', 'p1', 'Bold', { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 });
    const clefable = mon('Clefable', 'p1', 'Bold', { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 });
    const magnezone = mon('Magnezone', 'p1', 'Modest', { hp: 0, atk: 0, def: 4, spa: 252, spd: 0, spe: 252 }, 'Choice Specs');
    const sets = {
      p1: [asSet(toxapex, ['Scald']), asSet(clefable, ['Moonblast']), asSet(magnezone, ['Flash Cannon'])],
      p2: [asSet(garchomp, ['Earthquake'])],
    };
    const order = { firstSide: 'p1' as const, firstSpecies: 'Toxapex', secondSide: 'p2' as const, secondSpecies: 'Garchomp', turn: 4 };
    const observations = [
      hit(clefable, { ...garchomp, evs: bulky }, 'Moonblast'),
      hit(clefable, { ...garchomp, evs: bulky }, 'Moonblast'),
      hit(magnezone, { ...garchomp, evs: bulky }, 'Flash Cannon'),
      hit(magnezone, { ...garchomp, evs: bulky }, 'Flash Cannon'),
    ];
    const solved = inferSpreads(observations, sets, 'gen9ou', [order]).get('p2:garchomp');
    const evs = solved?.evs ?? sets.p2[0].evs;
    expect(evs.spe).toBe(252);
    expect(solved?.nature ?? sets.p2[0].nature).toBe('Jolly');
    // Control: without the order the same lines buy full bulk and Speed gives way.
    const free = inferSpreads(observations, sets, 'gen9ou', []).get('p2:garchomp');
    expect(free?.evs.spd).toBe(252);
    expect(free?.evs.spe ?? 0).toBeLessThan(252);
  });
});
