import { describe, expect, test, vi } from 'vitest';
import { Battle, Dex, TeamValidator, type PokemonSet } from '@pkmn/sim';
import { Move, calculate } from '@smogon/calc';
import { buildTeamsFromReplay, parseReplayLogWithObservations } from '../src/index';
import { inferSpreads } from '../src/spread-inference';
import { buildCalcPokemon } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import { genNumOf } from '../src/ids';
import { evBudget } from '../src/spreads/ev-budget';
import { buildSolveContext, calcPokemon, spreadFor } from '../src/spreads/fit';
import type { PokemonEvs } from '../src/types';

vi.mock('../src/spread-inference', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/spread-inference')>();
  return { ...actual, inferSpreads: vi.fn(actual.inferSpreads) };
});

// The server fills a set without EVs with 252 in every stat in Gens 1 and 2 (no EV limit); Gens 3 and later start at 0.
const GENS = [{ num: 1, formatid: 'gen1customgame' }, { num: 2, formatid: 'gen2customgame' }];
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const STATS = ['atk', 'def', 'spa', 'spd', 'spe'] as const;

type Sheet = { species: string; moves: string[]; evs?: PokemonEvs };
const setOf = ({ species, moves, evs }: Sheet): PokemonSet => (
  { name: species, species, item: '', ability: '', moves, nature: '', evs, ivs: { ...ALL_31 }, level: 100, gender: '' } as unknown as PokemonSet
);

function serverBody(formatid: string, set: PokemonSet) {
  const played = JSON.parse(JSON.stringify(set)) as PokemonSet;
  new TeamValidator(formatid).validateSet(played, {});
  const foe = setOf({ species: 'Snorlax', moves: ['tackle'] });
  const battle = new Battle({ formatid: formatid as never, seed: [1, 2, 3, 4], p1: { team: [played] }, p2: { team: [foe] } } as never);
  const mon = battle.p1.pokemon[0];
  return { evs: played.evs, stats: mon.storedStats, maxHp: mon.maxhp };
}

const STARMIE = { species: 'Starmie', moves: ['Psychic'] };
const SNORLAX = { species: 'Snorlax', moves: ['Body Slam'] };

function hitPercent(gen: number): number {
  const calcGen = calcGenerationFor(gen);
  const make = (species: string) => buildCalcPokemon(calcGen, species, { level: 100, evs: { hp: 252, atk: 252, def: 252, spa: 252, spd: 252, spe: 252 } });
  const defender = make('Snorlax');
  const rolls = (calculate(calcGen, make('Starmie'), defender, new Move(calcGen, 'Psychic')).damage as number[]).map(Number);
  return Math.round(100 * rolls[Math.floor(rolls.length / 2)] / defender.maxHP());
}

const logOf = (gen: number, hits: number, percent = 20) => [
  '|player|p1|Alice|', '|player|p2|Bob|', '|teamsize|p1|1', '|teamsize|p2|1', `|gen|${gen}`, `|tier|[Gen ${gen}] Custom Game`, '|start',
  '|switch|p1a: Star|Starmie|100/100', '|switch|p2a: Snor|Snorlax|100/100', '|turn|1',
  ...Array.from({ length: hits }, (_, index) => [
    '|move|p1a: Star|Psychic|p2a: Snor', `|-damage|p2a: Snor|${100 - percent * (index + 1)}/100`, `|turn|${index + 2}`,
  ]).flat(),
].join('\n');

function build(log: string) {
  const { observations, speedOrders } = parseReplayLogWithObservations(log);
  return buildTeamsFromReplay(log, { observations, speedOrders });
}

for (const { num, formatid } of GENS) {
  describe(`a Gen ${num} replay builds at the server's start (${formatid})`, () => {
    const server = (sheet: Sheet) => serverBody(formatid, setOf(sheet));

    test('the solver gets 252 in every stat for a set the log tells nothing about', () => {
      const solver = vi.mocked(inferSpreads);
      solver.mockClear();
      build(logOf(num, 1));
      expect(solver).toHaveBeenCalled();
      const [, sets, hint] = solver.mock.calls[0];
      expect(hint).toBe(`gen${num}`);
      expect(sets.p1.map(set => set.species)).toEqual(['Starmie']);
      expect(sets.p1[0].evs).toEqual(server(STARMIE).evs);
      expect(sets.p2[0].evs).toEqual(server(SNORLAX).evs);
      expect(sets.p1[0].evs).toEqual({ hp: 252, atk: 252, def: 252, spa: 252, spd: 252, spe: 252 });
    });

    test('the built set is the server start, with or without a damage line', () => {
      for (const hits of [0, 1]) {
        const built = build(logOf(num, hits));
        expect(built.p1Team[0].evs, `${hits} hits`).toEqual(server(STARMIE).evs);
        expect(built.p2Team[0].evs, `${hits} hits`).toEqual(server(SNORLAX).evs);
      }
    });

    test('the built bodies equal the simulator\'s for a set without EVs: stats, maximum HP and one Special', () => {
      const built = build(logOf(num, 1, hitPercent(num)));
      const ctx = buildSolveContext([], { p1: built.p1Team, p2: built.p2Team }, `gen${num}`, []);
      for (const [side, sheet] of [['p1', STARMIE], ['p2', SNORLAX]] as const) {
        const oracle = server(sheet);
        const body = calcPokemon(ctx, side, sheet.species, spreadFor(ctx, side, sheet.species));
        expect(body.maxHP(), `${sheet.species} HP`).toBe(oracle.maxHp);
        for (const stat of STATS) expect(body.stats[stat], `${sheet.species} ${stat}`).toBe(oracle.stats[stat]);
        const played = serverBody(formatid, side === 'p1' ? built.p1Team[0] : built.p2Team[0]);
        expect(played.maxHp, `${sheet.species} played HP`).toBe(oracle.maxHp);
        expect(played.stats, `${sheet.species} played stats`).toEqual(oracle.stats);
      }
    });

    test('three hits of the damage the server body deals solve to the server start again: the prior explains them', () => {
      const built = build(logOf(num, 3, hitPercent(num)));
      expect(built.p1Team[0].evs).toEqual(server(STARMIE).evs);
      expect(built.p2Team[0].evs).toEqual(server(SNORLAX).evs);
    });

    test('a harder hit than the server body deals takes the HP EVs off the defender and nothing else: one Special, Speed kept', () => {
      const built = build(logOf(num, 2, Math.round(1.4 * hitPercent(num))));
      expect(built.p2Team[0].evs).toEqual({ ...server(SNORLAX).evs, hp: 0 });
      expect(built.p1Team[0].evs).toEqual(server(STARMIE).evs);
      for (const set of [built.p1Team[0], built.p2Team[0]]) expect(set.evs.spa, set.species).toBe(set.evs.spd);
    });
  });
}

describe('Gen 3 and later builds keep the species default prior', () => {
  for (const gen of [3, 4, 5, 6, 7, 8, 9]) {
    test(`Gen ${gen}: Starmie 0/0/0/252/4/252, Snorlax 252/252/0/0/4/0`, () => {
      const built = build(logOf(gen, 1));
      expect(built.p1Team[0].evs).toEqual({ hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 });
      expect(built.p2Team[0].evs).toEqual({ hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 });
      expect(evBudget(`gen${gen}`)).toEqual({ perStat: 252, total: 508, statPoints: false, start: 0, oneSpecial: false });
    });
  }
});

describe('the Gen 1 and 2 budget follows the generation of a format, checked against the simulator', () => {
  const formats = Dex.formats.all().filter(format => /^gen\d/.test(format.id) && !format.team);
  const startOf = (formatid: string): number => {
    const probe = { name: '', species: 'Pikachu', moves: [] } as unknown as { evs?: PokemonEvs };
    new TeamValidator(formatid).validateSet(probe as never, {});
    return probe.evs?.hp ?? 0;
  };

  test('the Dex lists formats of Gens 1 and 2 and of later generations', () => {
    const generations = new Set(formats.map(format => Dex.forFormat(format).gen));
    expect([...generations].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('one Special and the start belong to Gens 1 and 2, whatever the format is called', () => {
    for (const format of formats) {
      const gen = Dex.forFormat(format).gen;
      const budget = evBudget(format.id);
      expect(genNumOf(format.id), format.id).toBe(gen);
      expect(budget.oneSpecial, format.id).toBe(gen <= 2);
      expect(budget.total, format.id).toBe(gen <= 2 ? 6 * 252 : 508);
      expect(budget.start, format.id).toBe(gen <= 2 ? startOf(format.id) : 0);
    }
  });

  test('the hints the build passes name only the generation and read the same', () => {
    for (const gen of [1, 2]) {
      expect(evBudget(`gen${gen}`)).toEqual({ perStat: 252, total: 6 * 252, statPoints: false, start: 252, oneSpecial: true });
      expect(evBudget(`gen${gen}`)).toEqual(evBudget(`gen${gen}ou`));
    }
    for (const gen of [3, 9]) expect(evBudget(`gen${gen}`)).toEqual(evBudget(`gen${gen}ou`));
    expect(evBudget('')).toEqual(evBudget('gen9'));
  });
});
