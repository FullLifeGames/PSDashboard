import { describe, expect, test } from 'vitest';
import { Generations, Move, Pokemon, calculate } from '@smogon/calc';
import { Dex } from '@pkmn/dex';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/spread-inference';
import type { SpeedKnowledge } from '../src/spreads/scarf';
import type { SpreadCandidate } from '../src/spreads/ladder';
import type { DamageObservation, PokemonEvs, SpeedOrderObservation } from '../src/types';
import { toId } from '../src/ids';

/**
 * Round 63 (T117): an observed move order is a hard limit for both sides.
 * Before the ladder, every order holds: a plausible usage spread yields
 * first, then any legal Speed (the side without its own Speed evidence
 * first, the second mover on a tie), then a Choice Scarf. A repaired order
 * ends strict, a cycle tied; a knock-out on a victim that may have clicked
 * a move below priority 0 binds while a set fits it and goes first when
 * none does.
 */
const gen = Generations.get(9);
type Side = 'p1' | 'p2';
type Sets = { p1: PokemonSet[]; p2: PokemonSet[] };
const evs = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): PokemonEvs => ({ hp, atk, def, spa, spd, spe });
const mon = (species: string, nature: string, spread: PokemonEvs, item = '', moves = ['Protect']): PokemonSet => ({
  name: species, species, item, ability: '', moves, nature, evs: spread,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
});
const usage = (...entries: [string, PokemonEvs, number][]) => entries.map(([nature, spread, probability]) => ({ nature, evs: spread, probability }));
const knowledge = (entries: Record<string, Partial<SpeedKnowledge>>): Map<string, SpeedKnowledge> =>
  new Map(Object.entries(entries).map(([key, value]) => [key, {
    itemKnown: false, scarfRuledOut: false, spreadKnown: false, spreads: [], ...value,
  }]));
const race = (first: Side, firstSpecies: string, second: Side, secondSpecies: string, turn: number, extra: Partial<SpeedOrderObservation> = {}): SpeedOrderObservation =>
  ({ firstSide: first, firstSpecies, secondSide: second, secondSpecies, turn, ...extra });

const entryOf = (solved: Map<string, SpreadCandidate>, side: Side, species: string) => solved.get(`${side}:${toId(species)}`);
const setOf = (sets: Sets, side: Side, species: string) => sets[side].find(set => toId(set.species) === toId(species))!;
/** The solved spread, else the set's. */
const spreadOf = (solved: Map<string, SpreadCandidate>, sets: Sets, side: Side, species: string) =>
  entryOf(solved, side, species) ?? setOf(sets, side, species);
/** The Speed stat the solve leaves the mon (no item). */
const statOf = (solved: Map<string, SpreadCandidate>, sets: Sets, side: Side, species: string) => {
  const spread = spreadOf(solved, sets, side, species);
  return new Pokemon(gen, species, { nature: spread.nature, evs: spread.evs }).stats.spe;
};
/** The race's Speed: the stat times the Scarf the order names, else the solve's item, else the set's. */
function raceSpeed(solved: Map<string, SpreadCandidate>, sets: Sets, side: Side, species: string, held?: boolean): number {
  const item = entryOf(solved, side, species)?.item ?? setOf(sets, side, species).item;
  return statOf(solved, sets, side, species) * ((held ?? toId(item ?? '') === 'choicescarf') ? 1.5 : 1);
}
/** First minus second for every order (positive: strict, zero: tied). */
const margins = (solved: Map<string, SpreadCandidate>, sets: Sets, orders: SpeedOrderObservation[]) => orders.map(order =>
  raceSpeed(solved, sets, order.firstSide, order.firstSpecies, order.firstScarf) -
  raceSpeed(solved, sets, order.secondSide, order.secondSpecies, order.secondScarf));
const usedUsage = (spread: { nature: string; evs: PokemonEvs }, spreads: { nature: string; evs: PokemonEvs }[]) =>
  spreads.some(entry => entry.nature === spread.nature && JSON.stringify(entry.evs) === JSON.stringify(spread.evs));

describe('every observed order holds before the ladder (T117)', () => {
  test('singles: a plausible spread moves first, the mon without usage takes the rest (2663113816 t14)', () => {
    // Gholdengo (219) moved before Maushold (321), whose slowest legal Speed is 232: Gholdengo takes its
    // Timid 252 usage spread (293), Maushold (no usage, the second mover) comes down under it.
    const sets = {
      p1: [mon('Maushold-Four', 'Hardy', evs(0, 252, 0, 0, 4, 252), '', ['Population Bomb'])],
      p2: [mon('Gholdengo', 'Bold', evs(252, 0, 196, 0, 0, 60), 'Air Balloon', ['Make It Rain'])],
    };
    const orders = [race('p2', 'Gholdengo', 'p1', 'Maushold-Four', 14)];
    const gholdengo = usage(['Timid', evs(0, 0, 0, 252, 4, 252), 0.46], ['Bold', evs(252, 0, 196, 0, 0, 60), 0.07]);
    const solved = inferSpreads([], sets, 'gen9ou', orders, knowledge({ 'p2:gholdengo': { itemKnown: true, spreads: gholdengo } }));
    expect(margins(solved, sets, orders)[0]).toBeGreaterThan(0);
    expect(statOf(solved, sets, 'p2', 'Gholdengo')).toBe(293);
    expect(usedUsage(spreadOf(solved, sets, 'p2', 'Gholdengo'), gholdengo)).toBe(true);
    expect(entryOf(solved, 'p2', 'Gholdengo')?.item).toBeUndefined();
  });

  test('singles: a plain legal Speed explains the order, so no Scarf (Kingambit before Garchomp)', () => {
    // Kingambit reaches 218 at Jolly 252, a Scarf would not reach Garchomp's 333 (no round-37 Scarf);
    // Garchomp at 0 Speed with a minus nature (216) explains the order without one.
    const sets = {
      p1: [mon('Kingambit', 'Adamant', evs(0, 252, 4, 0, 0, 252), 'Leftovers', ['Iron Head'])],
      p2: [mon('Garchomp', 'Jolly', evs(0, 252, 4, 0, 0, 252), '', ['Earthquake'])],
    };
    const orders = [race('p1', 'Kingambit', 'p2', 'Garchomp', 5)];
    const solved = inferSpreads([], sets, 'gen9ou', orders, knowledge({
      'p1:kingambit': { spreads: usage(['Adamant', evs(0, 252, 4, 0, 0, 252), 0.5], ['Jolly', evs(0, 252, 4, 0, 0, 252), 0.4]) },
      'p2:garchomp': { spreads: usage(['Jolly', evs(0, 252, 4, 0, 0, 252), 0.9]) },
    }));
    expect(margins(solved, sets, orders)[0]).toBeGreaterThan(0);
    expect(entryOf(solved, 'p1', 'Kingambit')?.item).toBeUndefined();
    expect(entryOf(solved, 'p2', 'Garchomp')?.item).toBeUndefined();
  });

  test('doubles: a plausible spread before a legal one (937928 t3, Ogerpon between Landorus and Ninetales)', () => {
    const ninetales = usage(['Timid', evs(0, 0, 4, 252, 0, 252), 0.2], ['Sassy', evs(252, 0, 4, 0, 252, 0), 0.17]);
    const ogerpon = usage(['Jolly', evs(0, 252, 0, 0, 4, 252), 0.18], ['Jolly', evs(72, 252, 0, 0, 0, 184), 0.15]);
    const sets = {
      p1: [mon('Ninetales-Alola', 'Timid', evs(208, 0, 72, 36, 0, 192)), mon('Landorus', 'Timid', evs(0, 0, 4, 252, 0, 252))],
      p2: [mon('Ogerpon-Wellspring', 'Jolly', evs(120, 136, 0, 0, 0, 252))],
    };
    const orders = [race('p2', 'Ogerpon-Wellspring', 'p1', 'Landorus', 1), race('p1', 'Ninetales-Alola', 'p2', 'Ogerpon-Wellspring', 3)];
    const solved = inferSpreads([], sets, 'gen9doublesou', orders, knowledge({
      'p1:ninetalesalola': { itemKnown: true, spreads: ninetales },
      'p1:landorus': { itemKnown: true, spreads: usage(['Timid', evs(0, 0, 4, 252, 0, 252), 0.5]) },
      'p2:ogerponwellspring': { itemKnown: true, spreads: ogerpon },
    }));
    const [held, repaired] = margins(solved, sets, orders);
    expect(held).toBeGreaterThanOrEqual(0);
    expect(repaired).toBeGreaterThan(0);
    expect(usedUsage(spreadOf(solved, sets, 'p2', 'Ogerpon-Wellspring'), ogerpon)).toBe(true);
    expect(statOf(solved, sets, 'p1', 'Landorus')).toBe(331);
  });

  test('doubles: both sides move (937931 t1 and t9, Gholdengo before Ninetales and Kyurem)', () => {
    const gholdengo = usage(['Timid', evs(0, 0, 0, 252, 4, 252), 0.13], ['Modest', evs(252, 0, 0, 72, 0, 184), 0.06]);
    const ninetales = usage(['Timid', evs(0, 0, 4, 252, 0, 252), 0.2], ['Sassy', evs(252, 0, 4, 0, 252, 0), 0.17]);
    const kyurem = usage(['Timid', evs(92, 0, 88, 128, 4, 196), 0.2], ['Modest', evs(252, 0, 0, 224, 0, 32), 0.06]);
    const sets = {
      p1: [mon('Gholdengo', 'Modest', evs(248, 0, 40, 112, 24, 84))],
      p2: [mon('Ninetales-Alola', 'Timid', evs(208, 0, 72, 36, 0, 192)), mon('Kyurem', 'Timid', evs(92, 0, 88, 128, 4, 196))],
    };
    const orders = [race('p1', 'Gholdengo', 'p2', 'Ninetales-Alola', 1), race('p1', 'Gholdengo', 'p2', 'Kyurem', 9)];
    const solved = inferSpreads([], sets, 'gen9doublesou', orders, knowledge({
      'p1:gholdengo': { itemKnown: true, spreads: gholdengo },
      'p2:ninetalesalola': { itemKnown: true, spreads: ninetales },
      'p2:kyurem': { itemKnown: true, spreads: kyurem },
    }));
    for (const margin of margins(solved, sets, orders)) expect(margin).toBeGreaterThan(0);
    expect(statOf(solved, sets, 'p1', 'Gholdengo')).toBeGreaterThan(225);
    expect(statOf(solved, sets, 'p2', 'Ninetales-Alola')).toBeLessThan(332);
    expect(usedUsage(spreadOf(solved, sets, 'p1', 'Gholdengo'), gholdengo)).toBe(true);
    expect(usedUsage(spreadOf(solved, sets, 'p2', 'Ninetales-Alola'), ninetales)).toBe(true);
  });

  test('doubles: a chain against a Speed floor (2663093831, Ting-Lu above a Quiet 0 Sinistcha, below Incineroar)', () => {
    // Both sides field a Quiet 0 Sinistcha (158, the floor at 31 IVs): p1's outran Incineroar at t8, which
    // outran Ting-Lu at t4, which outran p2's at t12, so the chain must climb above 158.
    const orthworm = usage(['Careful', evs(252, 0, 4, 0, 252, 0), 0.39], ['Relaxed', evs(252, 0, 252, 0, 4, 0), 0.24]);
    const sets = {
      p1: [
        mon('Ting-Lu', 'Adamant', evs(248, 96, 40, 0, 124, 0), 'Clear Amulet'), mon('Orthworm', 'Careful', evs(252, 0, 4, 0, 252, 0), 'Sitrus Berry'),
        mon('Sinistcha', 'Quiet', evs(252, 0, 76, 8, 172, 0), 'Sitrus Berry'),
      ],
      p2: [mon('Sinistcha', 'Quiet', evs(252, 0, 76, 8, 172, 0), 'Sitrus Berry'), mon('Incineroar', 'Careful', evs(252, 0, 96, 0, 160, 0), 'Sitrus Berry')],
    };
    const orders = [
      race('p2', 'Incineroar', 'p1', 'Ting-Lu', 4), race('p2', 'Incineroar', 'p1', 'Orthworm', 7), race('p1', 'Sinistcha', 'p2', 'Incineroar', 8),
      race('p1', 'Ting-Lu', 'p2', 'Sinistcha', 12),
    ];
    const solved = inferSpreads([], sets, 'gen9doublesou', orders, knowledge({
      'p1:tinglu': { itemKnown: true, spreads: usage(['Adamant', evs(252, 252, 4, 0, 0, 0), 0.18], ['Relaxed', evs(252, 0, 252, 0, 4, 0), 0.08]) },
      'p1:orthworm': { itemKnown: true, spreads: orthworm },
      'p1:sinistcha': { itemKnown: true, spreads: usage(['Quiet', evs(252, 0, 76, 8, 172, 0), 0.12], ['Bold', evs(252, 0, 252, 4, 0, 0), 0.05]) },
      'p2:sinistcha': { itemKnown: true, spreads: usage(['Quiet', evs(252, 0, 76, 8, 172, 0), 0.12], ['Bold', evs(252, 0, 252, 4, 0, 0), 0.05]) },
      'p2:incineroar': { itemKnown: true, spreads: usage(['Careful', evs(252, 0, 96, 0, 160, 0), 0.11], ['Adamant', evs(252, 4, 96, 0, 156, 0), 0.1]) },
    }));
    const [held, orthwormRepaired, sinistchaHeld, tingLuRepaired] = margins(solved, sets, orders);
    expect(held).toBeGreaterThanOrEqual(0);
    expect(orthwormRepaired).toBeGreaterThan(0);
    expect(sinistchaHeld).toBeGreaterThanOrEqual(0);
    expect(tingLuRepaired).toBeGreaterThan(0);
    expect(statOf(solved, sets, 'p2', 'Sinistcha')).toBe(158);
    // Only Speed moves: Ting-Lu keeps its HP and SpD.
    expect([spreadOf(solved, sets, 'p1', 'Ting-Lu').evs.hp, spreadOf(solved, sets, 'p1', 'Ting-Lu').evs.spd]).toEqual([248, 124]);
    expect(usedUsage(spreadOf(solved, sets, 'p1', 'Orthworm'), orthworm)).toBe(true);
  });

  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    test(`a known spread never yields (${formatid}, Gholdengo before Raging Bolt)`, () => {
      const sets = {
        p1: [mon('Gholdengo', 'Bold', evs(252, 0, 196, 0, 0, 60), 'Air Balloon')],
        p2: [mon('Raging Bolt', 'Modest', evs(0, 0, 4, 252, 0, 252), 'Leftovers')],
      };
      const orders = [race('p1', 'Gholdengo', 'p2', 'Raging Bolt', 16)];
      const gholdengo = { itemKnown: true };
      const known = inferSpreads([], sets, formatid, orders, knowledge({
        'p1:gholdengo': gholdengo, 'p2:ragingbolt': { itemKnown: true, spreadKnown: true },
      }));
      expect(margins(known, sets, orders)[0]).toBeGreaterThan(0);
      expect(statOf(known, sets, 'p2', 'Raging Bolt')).toBe(249);
      expect(statOf(known, sets, 'p1', 'Gholdengo')).toBeGreaterThan(249);
      // Control: an unknown Raging Bolt is the second mover on a tie of evidence, so it yields.
      const open = inferSpreads([], sets, formatid, orders, knowledge({ 'p1:gholdengo': gholdengo, 'p2:ragingbolt': { itemKnown: true } }));
      expect(margins(open, sets, orders)[0]).toBeGreaterThan(0);
      expect(statOf(open, sets, 'p1', 'Gholdengo')).toBe(219);
    });

    test(`a cycle ends tied (${formatid}, 749828 t15 and t16)`, () => {
      const sets = {
        p1: [mon('Gholdengo', 'Bold', evs(252, 0, 196, 0, 0, 60), 'Air Balloon')],
        p2: [mon('Raging Bolt', 'Modest', evs(0, 0, 4, 252, 0, 252), 'Leftovers')],
      };
      const orders = [race('p2', 'Raging Bolt', 'p1', 'Gholdengo', 15), race('p1', 'Gholdengo', 'p2', 'Raging Bolt', 16)];
      const solved = inferSpreads([], sets, formatid, orders, knowledge({
        'p1:gholdengo': { itemKnown: true }, 'p2:ragingbolt': { itemKnown: true },
      }));
      expect(margins(solved, sets, orders)).toEqual([0, 0]);
    });

    test(`a weak knock-out binds while a set fits it (${formatid}, Sylveon over a Trick Room Cresselia)`, () => {
      const sets = {
        p1: [mon('Cresselia', 'Sassy', evs(240, 0, 132, 0, 136, 0), 'Safety Goggles', ['Trick Room', 'Psychic'])],
        p2: [mon('Sylveon', 'Quiet', evs(28, 0, 228, 252, 0, 0), 'Throat Spray', ['Hyper Voice'])],
      };
      const orders = [race('p2', 'Sylveon', 'p1', 'Cresselia', 1, { knockOut: true })];
      const solved = inferSpreads([], sets, formatid, orders, knowledge({
        'p1:cresselia': { itemKnown: true },
        'p2:sylveon': { itemKnown: true, spreads: usage(['Quiet', evs(28, 0, 228, 252, 0, 0), 0.27], ['Modest', evs(0, 0, 4, 252, 0, 252), 0.22]) },
      }));
      expect(margins(solved, sets, orders)[0]).toBeGreaterThan(0);
    });

    test(`a weak knock-out goes before any Scarf when no set fits it (${formatid}, Toxapex over a Trick Room Indeedee)`, () => {
      // Indeedee's slowest legal Speed (203) is above Toxapex's fastest (185).
      const build = (moves: string[]) => ({
        p1: [mon('Toxapex', 'Bold', evs(252, 0, 252, 0, 4, 0), '', ['Scald'])],
        p2: [mon('Indeedee', 'Sassy', evs(252, 0, 4, 0, 252, 0), '', moves)],
      });
      const orders = [race('p1', 'Toxapex', 'p2', 'Indeedee', 3, { knockOut: true })];
      const weak = build(['Trick Room', 'Psychic']);
      const dropped = inferSpreads([], weak, formatid, orders);
      expect(entryOf(dropped, 'p1', 'Toxapex')?.item).toBeUndefined();
      expect(statOf(dropped, weak, 'p2', 'Indeedee')).toBe(203);
      // Control: a victim that never runs below priority 0 is a full race, and only a Scarf explains it.
      const full = build(['Psychic', 'Dazzling Gleam']);
      const scarfed = inferSpreads([], full, formatid, orders);
      expect(entryOf(scarfed, 'p1', 'Toxapex')?.item).toBe('Choice Scarf');
      expect(margins(scarfed, full, orders)[0]).toBeGreaterThan(0);
    });
  }

  test('a replay without a broken order keeps every set', () => {
    const sets = {
      p1: [mon('Gholdengo', 'Timid', evs(0, 0, 0, 252, 4, 252))],
      p2: [mon('Raging Bolt', 'Modest', evs(0, 0, 4, 252, 0, 252))],
    };
    const solved = inferSpreads([], sets, 'gen9ou', [race('p1', 'Gholdengo', 'p2', 'Raging Bolt', 3)]);
    expect(statOf(solved, sets, 'p1', 'Gholdengo')).toBe(293);
    expect(statOf(solved, sets, 'p2', 'Raging Bolt')).toBe(249);
  });
});

describe('the ladder keeps a minus-Speed nature the orders need', () => {
  /** A mid-roll hit computed forward with the true spreads (level 100). */
  function hit(attacker: PokemonSet, defender: PokemonSet, moveName: string): DamageObservation {
    const calc = (set: PokemonSet) => new Pokemon(gen, set.species, { nature: set.nature, evs: set.evs, item: set.item || undefined });
    const a = calc(attacker);
    const d = calc(defender);
    const { damage } = calculate(gen, a, d, new Move(gen, moveName));
    const rolls = (Array.isArray(damage) ? (damage as number[]).flat() : [Number(damage)]).map(Number);
    return {
      attackerSpecies: attacker.species, defenderSpecies: defender.species, attackerSide: 'p1', moveId: toId(moveName),
      observedFraction: rolls[Math.floor(rolls.length / 2)] / d.maxHP(), lethal: false,
      attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    };
  }

  test('a Brave Garchomp the order keeps slow takes the offense rung as Brave, not Adamant', () => {
    // Kingambit (Jolly 252: 218) moved before Garchomp: Brave 0 Speed (216) holds the order, any
    // neutral nature (240) breaks it. The damage lines ask for 252 Atk with a plus nature.
    const truth = mon('Garchomp', 'Brave', evs(0, 252, 4, 0, 0, 252), '', ['Earthquake']);
    const clefable = mon('Clefable', 'Bold', evs(252, 0, 252, 0, 4, 0));
    const sets = {
      p1: [mon('Garchomp', 'Brave', evs(252, 0, 4, 0, 252, 0), '', ['Earthquake'])],
      p2: [clefable, mon('Kingambit', 'Jolly', evs(0, 252, 4, 0, 0, 252))],
    };
    const observations = [hit(truth, clefable, 'Earthquake'), hit(truth, clefable, 'Earthquake')];
    const orders = [race('p2', 'Kingambit', 'p1', 'Garchomp', 8)];
    const solved = inferSpreads(observations, sets, 'gen9ou', orders, knowledge({
      'p1:garchomp': { itemKnown: true }, 'p2:kingambit': { itemKnown: true, spreadKnown: true },
    }));
    const garchomp = spreadOf(solved, sets, 'p1', 'Garchomp');
    expect(Dex.natures.get(garchomp.nature).minus).toBe('spe');
    expect(garchomp.evs.atk).toBe(252);
    expect(margins(solved, sets, orders)[0]).toBeGreaterThan(0);
  });
});
