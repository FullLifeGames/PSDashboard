import './champions-mod';
import { describe, expect, test } from 'vitest';
import { Generations, Move, Pokemon, calculate } from '@smogon/calc';
import { Dex } from '@pkmn/dex';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/spread-inference';
import type { SpeedKnowledge } from '../src/spreads/scarf';
import type { SpreadCandidate } from '../src/spreads/ladder';
import type { DamageObservation, PokemonEvs, SpeedOrderObservation } from '../src/types';
import { toId } from '../src/ids';
import { buildSolveContext, observationError, speedError } from '../src/spreads/fit';
import { buildCalcPokemon } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import { buildTeamsFromReplay, solveReplaySpreads } from '../src/team-builder';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import type { SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { SmogonUsageStats } from '../src/smogon/stats-types';

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
const spreadOf = (solved: Map<string, SpreadCandidate>, sets: Sets, side: Side, species: string) =>
  entryOf(solved, side, species) ?? setOf(sets, side, species);
const statOf = (solved: Map<string, SpreadCandidate>, sets: Sets, side: Side, species: string) => {
  const spread = spreadOf(solved, sets, side, species);
  return new Pokemon(gen, species, { nature: spread.nature, evs: spread.evs }).stats.spe;
};
function raceSpeed(solved: Map<string, SpreadCandidate>, sets: Sets, side: Side, species: string, held?: boolean): number {
  const item = entryOf(solved, side, species)?.item ?? setOf(sets, side, species).item;
  return statOf(solved, sets, side, species) * ((held ?? toId(item ?? '') === 'choicescarf') ? 1.5 : 1);
}
const margins = (solved: Map<string, SpreadCandidate>, sets: Sets, orders: SpeedOrderObservation[]) => orders.map(order =>
  raceSpeed(solved, sets, order.firstSide, order.firstSpecies, order.firstScarf) -
  raceSpeed(solved, sets, order.secondSide, order.secondSpecies, order.secondScarf));
const usedUsage = (spread: { nature: string; evs: PokemonEvs }, spreads: { nature: string; evs: PokemonEvs }[]) =>
  spreads.some(entry => entry.nature === spread.nature && JSON.stringify(entry.evs) === JSON.stringify(spread.evs));

describe('every observed order holds before the ladder', () => {
  test('singles: a plausible spread moves first, the mon without usage takes the rest (2663113816 t14)', () => {
    // Gholdengo (219) moved before Maushold (321, slowest legal 232): Gholdengo takes its Timid 252 usage spread (293).
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
    // Kingambit reaches 218 at Jolly 252, a Scarf would not reach Garchomp's 333;
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
    expect(held).toBeGreaterThan(0);
    expect(orthwormRepaired).toBeGreaterThan(0);
    expect(sinistchaHeld).toBeGreaterThanOrEqual(0);
    expect(tingLuRepaired).toBeGreaterThan(0);
    expect(statOf(solved, sets, 'p2', 'Sinistcha')).toBe(158);
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
      const open = inferSpreads([], sets, formatid, orders, knowledge({ 'p1:gholdengo': gholdengo, 'p2:ragingbolt': { itemKnown: true } }));
      expect(margins(open, sets, orders)[0]).toBeGreaterThan(0);
      expect(statOf(open, sets, 'p1', 'Gholdengo')).toBe(219);
    });

    test(`a cycle ends tied, every other order strict (${formatid}, 749828 t15 and t16)`, () => {
      const sets = {
        p1: [mon('Gholdengo', 'Bold', evs(252, 0, 196, 0, 0, 60), 'Air Balloon'), mon('Clefable', 'Timid', evs(252, 0, 4, 0, 0, 252), 'Leftovers')],
        p2: [mon('Raging Bolt', 'Modest', evs(0, 0, 4, 252, 0, 252), 'Leftovers')],
      };
      const orders = [
        race('p2', 'Raging Bolt', 'p1', 'Gholdengo', 15), race('p1', 'Gholdengo', 'p2', 'Raging Bolt', 16),
        race('p2', 'Raging Bolt', 'p1', 'Clefable', 20),
      ];
      const solved = inferSpreads([], sets, formatid, orders, knowledge({
        'p1:gholdengo': { itemKnown: true }, 'p2:ragingbolt': { itemKnown: true }, 'p1:clefable': { itemKnown: true },
      }));
      const [back, forth, clefable] = margins(solved, sets, orders);
      expect([back, forth]).toEqual([0, 0]);
      expect(clefable).toBeGreaterThan(0);
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
    // Kingambit (Jolly 252: 218) before Garchomp: Brave 0 Speed (216) holds the order, a neutral one (240) breaks it.
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

const set = (species: string, nature: string, evs: PokemonEvs): PokemonSet => ({
  name: species, species, item: '', ability: '', moves: ['Protect'], nature, evs,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
});
const itemKnown = (keys: string[]): Map<string, SpeedKnowledge> => new Map(keys.map(key => [key, {
  itemKnown: true, scarfRuledOut: true, spreadKnown: false, spreads: [],
}]));
const speOf = (species: string, spread: { nature: string; evs: PokemonEvs }) =>
  new Pokemon(gen, species, { nature: spread.nature, evs: spread.evs }).stats.spe;

describe('battle formes in move orders', () => {
  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    test(`an order naming Ogerpon-Wellspring-Tera binds the Ogerpon-Wellspring set (913996 t9, ${formatid})`, () => {
      // Landorus (Timid 252: 331) moved before the terastallized Ogerpon (Jolly 252: 350).
      const sets = {
        p1: [set('Ogerpon-Wellspring', 'Jolly', { hp: 120, atk: 136, def: 0, spa: 0, spd: 0, spe: 252 })],
        p2: [set('Landorus', 'Timid', { hp: 0, atk: 0, def: 4, spa: 252, spd: 0, spe: 252 })],
      };
      const order: SpeedOrderObservation = {
        firstSide: 'p2', firstSpecies: 'Landorus', secondSide: 'p1', secondSpecies: 'Ogerpon-Wellspring-Tera', turn: 9,
      };
      const solved = inferSpreads([], sets, formatid, [order], itemKnown(['p1:ogerponwellspring', 'p2:landorus']));
      const ogerpon = solved.get('p1:ogerponwellspring') ?? sets.p1[0];
      expect(speOf('Ogerpon-Wellspring', ogerpon)).toBeLessThanOrEqual(331);
    });
  }

  for (const formatid of ['gen9vgc2026regi', 'gen9ou']) {
    test(`Terapagos-Terastal races on its own base Speed (85) with the Terapagos spread (2630110359 t2 shape, ${formatid})`, () => {
      // Terastal Modest 0 Speed: 206 (the set's Terapagos would be 141); Garchomp Jolly 252: 333.
      const sets = {
        p1: [set('Terapagos', 'Modest', { hp: 252, atk: 0, def: 4, spa: 252, spd: 0, spe: 0 })],
        p2: [set('Garchomp', 'Jolly', { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 })],
      };
      const order: SpeedOrderObservation = {
        firstSide: 'p1', firstSpecies: 'Terapagos-Terastal', secondSide: 'p2', secondSpecies: 'Garchomp', turn: 2,
      };
      const solved = inferSpreads([], sets, formatid, [order], itemKnown(['p1:terapagos', 'p2:garchomp']));
      const terapagos = solved.get('p1:terapagos') ?? sets.p1[0];
      const garchomp = solved.get('p2:garchomp') ?? sets.p2[0];
      expect(speOf('Terapagos-Terastal', terapagos)).toBeGreaterThan(speOf('Garchomp', garchomp));
    });
  }

  for (const formatid of ['gen6ou', 'gen6doublesou']) {
    test(`a Mega races on its own base Speed with the base set's spread (649664 t20 shape, ${formatid})`, () => {
      // Lopunny Jolly 0 Speed: 270, as Lopunny-Mega 336; the known Latias runs Timid 252: 350.
      const sets = {
        p1: [{ ...set('Lopunny', 'Jolly', { hp: 4, atk: 252, def: 0, spa: 0, spd: 252, spe: 0 }), item: 'Lopunnite' }],
        p2: [set('Latias', 'Timid', { hp: 0, atk: 0, def: 4, spa: 252, spd: 0, spe: 252 })],
      };
      const order: SpeedOrderObservation = {
        firstSide: 'p1', firstSpecies: 'Lopunny-Mega', secondSide: 'p2', secondSpecies: 'Latias', turn: 20,
      };
      const known = new Map([...itemKnown(['p1:lopunny']), ['p2:latias', { itemKnown: true, scarfRuledOut: true, spreadKnown: true, spreads: [] }]]);
      const solved = inferSpreads([], sets, formatid, [order], known);
      const lopunny = solved.get('p1:lopunny') ?? sets.p1[0];
      expect(speOf('Lopunny-Mega', lopunny)).toBeGreaterThan(350);
      expect(speOf('Latias', solved.get('p2:latias') ?? sets.p2[0])).toBe(350);
    });
  }
});

describe('spread-offense-release', () => {
  const WORLDS = [
    { name: 'gen9ou', formatid: 'gen9ou', gen: calcGenerationFor(9), level: 100, max: 252 },
    { name: 'gen9doublesou', formatid: 'gen9doublesou', gen: calcGenerationFor(9), level: 100, max: 252 },
    { name: 'Champions singles', formatid: 'gen9championsou', gen: calcGenerationFor(0), level: 50, max: 32 },
    { name: 'Champions doubles', formatid: 'gen9championsvgc2026regma', gen: calcGenerationFor(0), level: 50, max: 32 },
  ];
  type World = (typeof WORLDS)[number];
  type Mon = { species: string; side: 'p1' | 'p2'; nature: string; evs: PokemonEvs };

  const evs = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
  const asSet = (m: Mon, level: number, moves: string[]): PokemonSet => ({
    name: m.species, species: m.species, item: '', ability: '', moves, nature: m.nature, evs: m.evs,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level, gender: '',
  });
  function hit(world: World, attacker: Mon, defender: Mon, moveName: string, rollIndex = 15): DamageObservation {
    const body = (m: Mon) => buildCalcPokemon(world.gen, m.species, { level: world.level, nature: m.nature, evs: m.evs });
    const a = body(attacker);
    const d = body(defender);
    const result = calculate(world.gen, a, d, new Move(world.gen, moveName));
    const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
    return {
      attackerSpecies: attacker.species, defenderSpecies: defender.species, attackerSide: attacker.side,
      moveId: toId(moveName), observedFraction: rolls[Math.min(rollIndex, rolls.length - 1)] / d.maxHP(), lethal: false,
      attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    };
  }
  const speedOf = (world: World, m: Mon) => buildCalcPokemon(world.gen, m.species, { level: world.level, nature: m.nature, evs: m.evs }).stats.spe;
  const first = (side: 'p1' | 'p2', species: string, secondSpecies: string) => ({
    firstSide: side, firstSpecies: species, secondSide: side === 'p1' ? 'p2' as const : 'p1' as const, secondSpecies, turn: 3,
  });

  for (const world of WORLDS) {
    const { max } = world;
    const clefable: Mon = { species: 'Clefable', side: 'p1', nature: 'Bold', evs: evs({ hp: max, def: max }) };
    const toxapex: Mon = { species: 'Toxapex', side: 'p1', nature: 'Bold', evs: evs({ hp: max, def: max }) };
    const lucario: Mon = { species: 'Lucario', side: 'p1', nature: 'Jolly', evs: evs({ atk: max, spe: max }) };

    describe(`the offense nature opens beside a kept Speed (${world.name})`, () => {
      const prior: Mon = { species: 'Garchomp', side: 'p2', nature: 'Jolly', evs: evs({ atk: max, spe: max }) };
      const truth: Mon = { ...prior, nature: 'Adamant' };
      const sets = {
        p1: [asSet(clefable, world.level, ['Moonblast']), asSet(toxapex, world.level, ['Scald']), asSet(lucario, world.level, ['Close Combat'])],
        p2: [asSet(prior, world.level, ['Earthquake', 'Swords Dance'])],
      };
      const lines = (body: Mon) => [
        hit(world, body, clefable, 'Earthquake'), hit(world, body, toxapex, 'Earthquake'), hit(world, body, clefable, 'Earthquake'),
      ];
      const solve = (observations: DamageObservation[], opponent = 'Clefable') =>
        inferSpreads(observations, sets, world.formatid, [first('p2', 'Garchomp', opponent)]).get('p2:garchomp');

      test('clean lines of a stronger nature than the kept Jolly give the Adamant body, Speed kept', () => {
        const solved = solve(lines(truth));
        expect(solved?.nature).toBe('Adamant');
        expect(solved?.evs.atk).toBe(max);
        expect(solved?.evs.spe).toBe(max);
      });

      test('the order price keeps the Jolly body when the Adamant body would no longer move first', () => {
        expect(speedOf(world, prior)).toBeGreaterThan(speedOf(world, lucario));
        expect(speedOf(world, truth)).toBeLessThan(speedOf(world, lucario));
        const solved = solve(lines(truth), 'Lucario');
        expect(solved?.nature ?? 'Jolly').toBe('Jolly');
        expect(solved?.evs.spe ?? max).toBe(max);
      });

      test('lines the Jolly body already fits keep it (the tempo gives way only for a lower fit error)', () => {
        const solved = solve(lines(prior));
        expect(solved?.nature ?? 'Jolly').toBe('Jolly');
        expect(solved?.evs.spe ?? max).toBe(max);
      });

      test('a bulk nature never takes the kept Speed, whatever the defender lines read', () => {
        const bulky = [...lines(truth), hit(world, clefable, truth, 'Moonblast'), hit(world, toxapex, truth, 'Scald')];
        const solved = solve(bulky);
        expect(['Jolly', 'Adamant']).toContain(solved?.nature ?? 'Jolly');
      });

      test('the fit error of the solved body does not rise above the prior\'s', () => {
        for (const body of [truth, prior]) {
          const observations = lines(body);
          const solved = solve(observations)!;
          const ctx = buildSolveContext(observations, sets, world.formatid, [first('p2', 'Garchomp', 'Clefable')]);
          const total = (spread: { evs: PokemonEvs; nature: string }) =>
            observations.reduce((sum, obs) => sum + observationError(ctx, obs, 'p2:garchomp', spread), 0) + speedError(ctx, 'p2:garchomp', spread);
          expect(total(solved ?? prior)).toBeLessThanOrEqual(total(prior) + 1e-12);
        }
      });
    });

    describe(`the opening follows the seen hit class (${world.name})`, () => {
      const prior: Mon = { species: 'Gengar', side: 'p2', nature: 'Timid', evs: evs({ spa: max, spe: max }) };
      const truth: Mon = { ...prior, nature: 'Modest' };
      const sets = {
        p1: [asSet(clefable, world.level, ['Moonblast']), asSet(toxapex, world.level, ['Scald'])],
        p2: [asSet(prior, world.level, ['Shadow Ball', 'Sludge Bomb'])],
      };

      test('special lines open Modest, not a physical or bulk nature', () => {
        const observations = [hit(world, truth, clefable, 'Shadow Ball'), hit(world, truth, toxapex, 'Shadow Ball'), hit(world, truth, clefable, 'Shadow Ball')];
        const solved = inferSpreads(observations, sets, world.formatid, [first('p2', 'Gengar', 'Clefable')]).get('p2:gengar');
        expect(solved?.nature).toBe('Modest');
        expect(solved?.evs.spa).toBe(max);
        expect(solved?.evs.spe).toBe(max);
      });
    });
  }

  test('a Pokemon without clean attacker lines never gets an offense nature from the opening', () => {
    const world = WORLDS[0];
    const prior: Mon = { species: 'Garchomp', side: 'p2', nature: 'Jolly', evs: evs({ atk: 252, spe: 252 }) };
    const clefable: Mon = { species: 'Clefable', side: 'p1', nature: 'Bold', evs: evs({ hp: 252, def: 252 }) };
    const sets = { p1: [asSet(clefable, 100, ['Moonblast'])], p2: [asSet(prior, 100, ['Earthquake'])] };
    const observations = [hit(world, clefable, prior, 'Moonblast'), hit(world, clefable, prior, 'Moonblast')];
    const solved = inferSpreads(observations, sets, 'gen9ou', [first('p2', 'Garchomp', 'Clefable')]).get('p2:garchomp');
    expect(solved?.nature ?? 'Jolly').toBe('Jolly');
  });
});

describe('spread-published-iv', () => {
  const gen = Generations.get(9);
  const evs = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): PokemonEvs => ({ hp, atk, def, spa, spd, spe });
  const set = (species: string, nature: string, spread: PokemonEvs, ivs: Partial<PokemonEvs> = {}, level = 100): PokemonSet => ({
    name: species, species, item: '', ability: '', moves: ['Protect'], nature, evs: spread,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...ivs }, level, gender: '',
  });
  const knowledge = (spreadKnown: boolean): Map<string, SpeedKnowledge> =>
    new Map([['p2:incineroar', { itemKnown: true, scarfRuledOut: true, spreadKnown, spreads: [] }]]);
  const order = (turn = 8): SpeedOrderObservation => ({ firstSide: 'p1', firstSpecies: 'Sinistcha', secondSide: 'p2', secondSpecies: 'Incineroar', turn });
  const speedOf = (species: string, nature: string, spread: PokemonEvs, ivs: Partial<PokemonEvs>) =>
    new Pokemon(gen, species, { level: 100, nature, evs: spread, ivs }).stats.spe;

  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    describe(`a seen order that refutes a published Speed IV (${formatid})`, () => {
      const trickRoom = { atk: 0, spe: 0 };
      const sinistcha = set('Sinistcha', 'Quiet', evs(252, 0, 4, 252, 0, 0), trickRoom);
      const solve = (incineroar: PokemonSet, orders = [order()]) => {
        const sets = { p1: [sinistcha], p2: [incineroar] };
        return inferSpreads([], sets, formatid, orders, knowledge(true)).get('p1:sinistcha');
      };

      test('the IV goes to 31 and no Speed EV is bought', () => {
        const incineroar = set('Incineroar', 'Careful', evs(252, 0, 4, 0, 252, 0));
        // The scene: the published body (130) is slower than Incineroar (156), IV 31 alone (158) is faster.
        const rival = speedOf('Incineroar', 'Careful', incineroar.evs, incineroar.ivs!);
        expect(speedOf('Sinistcha', 'Quiet', sinistcha.evs, sinistcha.ivs!)).toBeLessThan(rival);
        expect(speedOf('Sinistcha', 'Quiet', sinistcha.evs, { ...sinistcha.ivs, spe: 31 })).toBeGreaterThan(rival);
        const solved = solve(incineroar);
        expect(solved?.ivs?.spe).toBe(31);
        expect(solved?.ivs?.atk).toBe(0);
        expect(solved?.evs.spe).toBe(0);
        expect(solved?.nature).toBe('Quiet');
      });

      test('a rival IV 31 cannot beat still plays IV 31, with the fewest Speed EVs', () => {
        const incineroar = set('Incineroar', 'Jolly', evs(0, 252, 0, 0, 4, 40));
        const rival = speedOf('Incineroar', 'Jolly', incineroar.evs, incineroar.ivs!);
        expect(speedOf('Sinistcha', 'Quiet', sinistcha.evs, { ...sinistcha.ivs, spe: 31 })).toBeLessThan(rival);
        const solved = solve(incineroar);
        expect(solved?.ivs?.spe).toBe(31);
        const body = solved!;
        expect(speedOf('Sinistcha', body.nature, body.evs, body.ivs!)).toBeGreaterThan(rival);
        const fewest = (ivs: Partial<PokemonEvs>) => Array.from({ length: 64 }, (_, i) => i * 4)
          .find(spe => speedOf('Sinistcha', body.nature, { ...body.evs, spe }, ivs) > rival) ?? 252;
        expect(body.evs.spe).toBe(fewest(body.ivs!));
        expect(fewest(sinistcha.ivs!)).toBeGreaterThan(body.evs.spe);
      });

      test('an order the published body already keeps leaves the IV alone', () => {
        const incineroar = set('Incineroar', 'Careful', evs(252, 0, 4, 0, 252, 0));
        const slowLast: SpeedOrderObservation = { firstSide: 'p2', firstSpecies: 'Incineroar', secondSide: 'p1', secondSpecies: 'Sinistcha', turn: 8 };
        const solved = solve(incineroar, [slowLast]);
        expect(solved?.ivs?.spe ?? 0).toBe(0);
        expect(solved?.evs?.spe ?? 0).toBe(0);
      });
    });
  }

  describe('a Champions body has no IV to restore', () => {
    test('the order is settled on Stat Points and the IVs stay as published', () => {
      const level = 50;
      const slow = set('Garchomp', 'Quiet', evs(32, 0, 0, 0, 0, 0), { spe: 0 }, level);
      const fast = set('Lucario', 'Jolly', evs(0, 32, 0, 0, 0, 32), {}, level);
      const solved = inferSpreads([], { p1: [slow], p2: [fast] }, 'gen9championsou', [
        { firstSide: 'p1', firstSpecies: 'Garchomp', secondSide: 'p2', secondSpecies: 'Lucario', turn: 4 },
      ], new Map([['p2:lucario', { itemKnown: true, scarfRuledOut: true, spreadKnown: true, spreads: [] }]])).get('p1:garchomp');
      expect(solved?.ivs).toBeUndefined();
      const body = buildCalcPokemon(calcGenerationFor(0), 'Garchomp', { level, nature: solved?.nature ?? 'Quiet', evs: solved?.evs ?? slow.evs });
      const rival = buildCalcPokemon(calcGenerationFor(0), 'Lucario', { level, nature: 'Jolly', evs: fast.evs });
      expect(body.stats.spe).toBeGreaterThan(rival.stats.spe);
    });
  });

  describe('the IV the pre-solve restored reaches the build (two-stage solve)', () => {
    const published: SmogonSetAssumptions = {
      format: 'test', source: 's',
      pokemon: {
        sinistcha: {
          species: 'Sinistcha', sourceDetail: 's', item: { value: 'Sitrus Berry', sourceDetail: 's' },
          moves: ['Matcha Gotcha', 'Rage Powder', 'Trick Room', 'Shadow Ball'].map(value => ({ value, sourceDetail: 's' })),
          spread: { value: 'Quiet:252/0/76/8/172/0', nature: 'Quiet', evs: { hp: 252, atk: 0, def: 76, spa: 8, spd: 172, spe: 0 }, sourceDetail: 's' },
          ivs: { atk: 0, spe: 0 },
        },
      },
    };
    const usageStats: SmogonUsageStats = {
      format: 'test', month: 'm', source: 's',
      pokemon: { sinistcha: { species: 'Sinistcha', rawCount: 1000, abilities: [], spreads: [], items: [], moves: ['Matcha Gotcha', 'Rage Powder', 'Trick Room', 'Shadow Ball'].map(value => ({ value, probability: 0.9, sourceDetail: 'u' })) } },
    };
    const truth = new Pokemon(gen, 'Sinistcha', { level: 100, nature: 'Relaxed', evs: { hp: 252, def: 252, spa: 4 }, ivs: { atk: 0, spe: 31 } });
    const incineroar = new Pokemon(gen, 'Incineroar', { level: 100, nature: 'Hardy', evs: { hp: 252, atk: 252, spd: 4 } });
    const mid = (attacker: Pokemon, defender: Pokemon, move: string) => {
      const rolls = calculate(gen, attacker, defender, new Move(gen, move)).damage as number[];
      return rolls[Math.floor(rolls.length / 2)] / defender.maxHP();
    };
    const shadowBall = Math.round(100 * mid(truth, incineroar, 'Shadow Ball'));
    const knockOff = Math.round(100 * mid(incineroar, truth, 'Knock Off'));
    const turns = [1, 2].flatMap(turn => [
      `|turn|${turn}`,
      '|move|p2a: Sinistcha|Shadow Ball|p1a: Incineroar', `|-damage|p1a: Incineroar|${100 - shadowBall * turn}/100`,
      '|move|p1a: Incineroar|Knock Off|p2a: Sinistcha', `|-damage|p2a: Sinistcha|${100 - knockOff * turn}/100`,
    ]);
    const log = (doubles: boolean) => [
      '|player|p1|Alice|', '|player|p2|Bob|', ...(doubles ? ['|gametype|doubles'] : []), '|gen|9', `|tier|[Gen 9] ${doubles ? 'Doubles ' : ''}OU`,
      '|poke|p1|Incineroar, M|', ...(doubles ? ['|poke|p1|Amoonguss, M|'] : []), '|poke|p2|Sinistcha|', ...(doubles ? ['|poke|p2|Whimsicott, M|'] : []), '|start',
      '|switch|p1a: Incineroar|Incineroar, M|100/100', ...(doubles ? ['|switch|p1b: Amoonguss|Amoonguss, M|100/100'] : []),
      '|switch|p2a: Sinistcha|Sinistcha|100/100', ...(doubles ? ['|switch|p2b: Whimsicott|Whimsicott, M|100/100'] : []),
      ...turns,
    ].join(String.fromCharCode(10));

    for (const doubles of [false, true]) {
      test(`${doubles ? 'doubles' : 'singles'}: the built Sinistcha plays IV 31 in Speed and keeps Attack 0, no Speed EV`, () => {
        const text = log(doubles);
        const { observations, speedOrders } = parseReplayLogWithObservations(text);
        expect(speedOrders.length).toBeGreaterThan(0);
        const options = { speedOrders, usageStats, setAssumptions: published };
        const solved = solveReplaySpreads(text, observations, options);
        const built = buildTeamsFromReplay(text, { inferredSpreads: solved, usageStats, setAssumptions: published });
        const mon = built.p2Team.find(set => set.species === 'Sinistcha')!;
        const rival = built.p1Team.find(set => set.species === 'Incineroar')!;
        expect(mon.ivs?.spe).toBe(31);
        expect(mon.ivs?.atk).toBe(0);
        expect(mon.evs.spe).toBe(0);
        const speed = (set: PokemonSet) => new Pokemon(gen, set.species, { level: set.level, nature: set.nature, evs: set.evs, ivs: set.ivs }).stats.spe;
        expect(speed(mon)).toBeGreaterThan(speed(rival));
      });
    }
  });
});
