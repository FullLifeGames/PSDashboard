import { describe, expect, test } from 'vitest';
import { Generations, Move, Pokemon, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay } from '../src/team-builder';
import { inferSpreads } from '../src/spread-inference';
import { evBudget } from '../src/spreads/ev-budget';
import { buildSolveContext, observationError, speedStat } from '../src/spreads/fit';
import { hpEvsForMaxHp } from '../src/spreads/max-hp';
import { readableOrders } from '../src/spreads/order-limit';
import { decideScarfs, type SpeedKnowledge } from '../src/spreads/scarf';
import type { SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { DamageObservation, PokemonEvs, SpeedOrderObservation } from '../src/types';
import { toId } from '../src/ids';

/**
 * Round 67 (T145): Pokémon Champions replaces EVs by Stat Points (0 to 32 per stat, 66 in total) and the
 * server computes a stat as base + SP + 20 (HP base + SP + 75) at level 50 (@pkmn/mods champions,
 * Scripts.statModify). The spread solver handed the points to @smogon/calc as EVs: a full 32-SP Speed made a
 * Champions mon 4 points faster instead of 32. The solver now reads Stat Points through the calculator as
 * EV 8·SP − 4 (0 at 0) with every IV 31, which gives the server's stat on every level (checked against
 * statModify in the engine's champions-mod spec), steps one point at a time, never lowers an IV (Champions
 * has none to lower), and a Scarlet/Violet spread reaches the Stat Point scale by the exact level-50 inverse.
 */
const gen = Generations.get(9);
type Side = 'p1' | 'p2';
const sp = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): PokemonEvs => ({ hp, atk, def, spa, spd, spe });
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mon = (species: string, nature: string, spread: PokemonEvs, extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name: species, species, item: '', ability: '', moves: ['Protect'], nature, evs: spread, ivs: { ...ALL_31 }, level: 50, gender: '', ...extra,
});
const race = (first: Side, firstSpecies: string, second: Side, secondSpecies: string, turn = 1): SpeedOrderObservation =>
  ({ firstSide: first, firstSpecies, secondSide: second, secondSpecies, turn });
const knowledge = (entries: Record<string, Partial<SpeedKnowledge>>): Map<string, SpeedKnowledge> =>
  new Map(Object.entries(entries).map(([key, value]) => [key, { itemKnown: false, scarfRuledOut: false, spreadKnown: false, spreads: [], ...value }]));
/** The calculator's own view of a Champions body, for building observations the replay would show. */
const calcEvs = (spread: PokemonEvs) => Object.fromEntries(Object.entries(spread).map(([stat, value]) => [stat, value >= 1 ? 8 * value - 4 : 0]));

const CHAMPIONS = { singles: 'gen9championsou', doubles: 'gen9championsvgc2026regmbbo3' } as const;

describe('the spread solver reads Champions Stat Points (T145)', () => {
  for (const [kind, format] of Object.entries(CHAMPIONS)) {
    test(`each Stat Point is one stat point, and the set's IVs do not count (${kind})`, () => {
      // Garchomp, base Speed 102: 122 at 0 SP, 154 at 32 SP on a neutral nature; a published Speed IV of 0 has
      // no meaning in Champions (statModify reads no IV).
      const sets = { p1: [mon('Garchomp', 'Hardy', sp(0, 0, 0, 0, 0, 0), { ivs: { ...ALL_31, spe: 0 } })], p2: [] };
      const ctx = buildSolveContext([], sets, format, []);
      const at = (points: number) => speedStat(ctx, 'p1', 'Garchomp', { evs: sp(0, 0, 0, 0, 0, points), nature: 'Hardy' });
      expect(at(0)).toBe(122);
      for (let points = 0; points <= 32; points++) expect(at(points)).toBe(122 + points);
    });

    test(`damage lines read both bodies on the Stat Point scale (${kind})`, () => {
      const attacker = mon('Garchomp', 'Adamant', sp(0, 32, 0, 0, 2, 32), { moves: ['Rock Slide'] });
      const defender = mon('Corviknight', 'Impish', sp(32, 0, 32, 0, 2, 0), { moves: ['Roost'] });
      const a = new Pokemon(gen, 'Garchomp', { level: 50, nature: 'Adamant', evs: calcEvs(attacker.evs), ivs: ALL_31 });
      const d = new Pokemon(gen, 'Corviknight', { level: 50, nature: 'Impish', evs: calcEvs(defender.evs), ivs: ALL_31 });
      const rolls = (calculate(gen, a, d, new Move(gen, 'Rock Slide')).damage as number[]).flat().map(Number);
      const observation: DamageObservation = {
        attackerSpecies: 'Garchomp', defenderSpecies: 'Corviknight', attackerSide: 'p1', moveId: 'rockslide',
        observedFraction: rolls[0] / d.maxHP(), lethal: false, attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
      };
      const ctx = buildSolveContext([observation], { p1: [attacker], p2: [defender] }, format, []);
      expect(observationError(ctx, observation, 'p1:garchomp', { evs: attacker.evs, nature: 'Adamant' })).toBe(0);
    });

    test(`a settled order steps one Stat Point (${kind})`, () => {
      // Charizard's sheet says 14 SP Speed (134); Garchomp moved first from 0 SP (122): 13 SP (135) is the
      // smallest Speed that keeps the order, not the 16 SP a 4-point step would land on.
      const sets = { p1: [mon('Garchomp', 'Hardy', sp(32, 32, 0, 0, 2, 0))], p2: [mon('Charizard', 'Hardy', sp(0, 0, 0, 32, 2, 14))] };
      const solved = inferSpreads([], sets, format, [race('p1', 'Garchomp', 'p2', 'Charizard')], knowledge({ 'p2:charizard': { spreadKnown: true } }));
      expect(solved.get('p1:garchomp')?.evs.spe).toBe(13);
    });

    test(`a Champions solve never lowers a Speed IV (${kind})`, () => {
      // Heracross (known, 105) moved before Garchomp, whose slowest legal Speed is Brave 0 SP (109). Scarlet/Violet
      // would lower Garchomp's Speed IV; Champions has no IVs to lower, so the order stays unexplained.
      const sets = { p1: [mon('Heracross', 'Hardy', sp(32, 32, 0, 0, 2, 0))], p2: [mon('Garchomp', 'Jolly', sp(2, 32, 0, 0, 0, 32))] };
      const solved = inferSpreads([], sets, format, [race('p1', 'Heracross', 'p2', 'Garchomp')], knowledge({ 'p1:heracross': { spreadKnown: true } }));
      expect(solved.get('p2:garchomp')?.ivs).toBeUndefined();
    });

    test(`a Champions usage spread counts as tempo-invested on its own scale (${kind})`, () => {
      // Every Garchomp runs Jolly 32 SP Speed (169) and still moved before a 32-SP Timid Dragapult (213): it holds a
      // Scarf (253). The tempo camp read 32 against the EV threshold of 200 and never let a Scarf in.
      const sets = { p1: [mon('Garchomp', 'Jolly', sp(2, 32, 0, 0, 0, 32))], p2: [mon('Dragapult', 'Timid', sp(2, 0, 0, 32, 0, 32))] };
      const orders = readableOrders([race('p1', 'Garchomp', 'p2', 'Dragapult')], sets, 9);
      const ctx = buildSolveContext([], sets, format, orders);
      const decisions = decideScarfs(ctx, knowledge({
        'p1:garchomp': { spreads: [{ nature: 'Jolly', evs: sp(2, 32, 0, 0, 0, 32), probability: 1 }] },
        'p2:dragapult': { spreadKnown: true },
      }));
      expect(decisions.get('p1:garchomp')).toBe('holds');
    });
  }

  test('max HP inverts on the Stat Point scale', () => {
    // Garchomp, base HP 108: 215 HP is 32 SP (108 + 32 + 75), 183 HP is 0 SP.
    expect(hpEvsForMaxHp(108, 50, 215, 0, 31, evBudget('gen9championsou'))).toBe(32);
    expect(hpEvsForMaxHp(108, 50, 183, 32, 31, evBudget('gen9championsou'))).toBe(0);
    expect(hpEvsForMaxHp(108, 50, 200, 0, 31, evBudget('gen9championsou'))).toBe(17);
    // The Scarlet/Violet scale is untouched (573756: Garchomp 409 HP at level 100 is 208 EVs).
    expect(hpEvsForMaxHp(108, 100, 409, 0)).toBe(208);
  });
});

describe('a Champions build stays on the Stat Point scale (T145)', () => {
  const logOf = (kind: 'singles' | 'doubles') => [
    '|player|p1|Alice|1|', '|player|p2|Bob|2|', `|gametype|${kind}`, '|gen|9',
    kind === 'singles' ? '|tier|[Gen 9 Champions] OU' : '|tier|[Gen 9 Champions] VGC 2026 Reg M-B (Bo3)',
    '|poke|p1|Corviknight, L50, M|', '|poke|p1|Garchomp, L50, M|', '|poke|p2|Kingambit, L50, M|', '|start',
    '|switch|p1a: Corviknight|Corviknight, L50, M|100/100', '|switch|p2a: Kingambit|Kingambit, L50, M|100/100', '|turn|1',
  ].join('\n');
  const assumptions = (spread: PokemonEvs, ivs?: Partial<PokemonEvs>): SmogonSetAssumptions => ({
    format: 'test', source: 'test', pokemon: {
      corviknight: {
        species: 'Corviknight', sourceDetail: 'test', moves: [{ value: 'Body Press', sourceDetail: 'test' }],
        spread: { value: 'Impish', sourceDetail: 'test', nature: 'Impish', evs: spread }, ...(ivs ? { ivs } : {}),
      },
    },
  });
  const built = (kind: 'singles' | 'doubles', setAssumptions: SmogonSetAssumptions, species: string) =>
    buildTeamsFromReplay(logOf(kind), { setAssumptions }).p1Team.find(set => toId(set.species) === toId(species))!;

  for (const kind of ['singles', 'doubles'] as const) {
    test(`a Scarlet/Violet spread reaches the Stat Point scale by the inverse, IVs stay 31 (${kind})`, () => {
      // A Scarlet/Violet analysis (EV scale, Speed IV 0) for Corviknight: 252/160/96 EVs give the stats of 32/20/12 SP
      // at level 50; clamping read them as 32/32/2.
      const corviknight = built(kind, assumptions(sp(252, 0, 160, 0, 96, 0), { spe: 0 }), 'Corviknight');
      expect(corviknight.evs).toEqual(sp(32, 0, 20, 0, 12, 0));
      expect(corviknight.ivs).toEqual(ALL_31);
    });

    test(`a Stat Point spread stays as published (${kind})`, () => {
      expect(built(kind, assumptions(sp(32, 0, 32, 0, 2, 0)), 'Corviknight').evs).toEqual(sp(32, 0, 32, 0, 2, 0));
    });

    test(`the no-data default reaches the Stat Point scale too (${kind})`, () => {
      // Garchomp's last-resort spread is 252 Atk / 4 SpD / 252 Spe: 32/1/32 SP, not 30/4/32 after a clamp and a shave.
      expect(built(kind, assumptions(sp(32, 0, 32, 0, 2, 0)), 'Garchomp').evs).toEqual(sp(0, 32, 0, 0, 1, 32));
    });
  }
});
