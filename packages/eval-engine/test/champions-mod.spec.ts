import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { Battle, Dex, type PokemonSet } from '@pkmn/sim';
import { Generations, Pokemon as CalcPokemon } from '@smogon/calc';
import { Scripts } from '@pkmn/mods/champions';
import {
  buildTeamsFromReplay, calcEvs, calcIvs, evBudget, getBranchSimulatorFormat, parseReplayLogWithObservations, replayBringOnly,
} from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 67 (T145): Pokémon Champions battles run on the Champions mod of @pkmn/mods. The checkers hold the
 * simulator's stats against the mod's own statModify (Stat Points in the sets' evs: base + SP + 20, HP base + SP + 75
 * at level 50) for every Champions species and nature, and the calculator's stats (the spread solver's reading,
 * EV 8·SP − 4 with every IV 31) against the simulator's.
 */
type Stat = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
const STATS: Stat[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const GRID = [0, 1, 2, 15, 31, 32];
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const FORMATS = { singles: { id: 'gen9championsou', team: 6 }, doubles: { id: 'gen9championsdoublescustomgame', team: 24 } } as const;

// The mod first: every test below builds or reads Champions battles.
await loadSimMods('gen9championsou');

const championsDex = () => Dex.dexes.champions;
/**
 * Every out-of-battle forme of the Champions dex, legal or not: the Champions games of the corpus field species the
 * mod's FormatsData of 0.10.11 still marks illegal (regulation M-C's Rillaboom, Cinderace, Golisopod), and the
 * formula does not depend on legality. Shedinja's fixed HP stays out.
 */
const championsSpecies = () => championsDex().species.all()
  .filter(species => species.exists && !species.battleOnly && !species.maxHP)
  .map(species => species.name);
/** statModify outside the simulator: the mod's own formula, no level clause. */
function serverStat(set: PokemonSet, stat: Stat): number {
  const context = { trunc: championsDex().trunc, ruleTable: new Map(), dex: championsDex() };
  const modify = Scripts.statModify as unknown as (this: unknown, base: Record<Stat, number>, set: PokemonSet, stat: Stat) => number;
  return modify.call(context, championsDex().species.get(set.species).baseStats as Record<Stat, number>, set, stat);
}
/** One set per species and nature, Stat Points rotating over the grid. */
function checkerSets(): PokemonSet[] {
  const natures = Dex.natures.all().map(nature => nature.name);
  return championsSpecies().flatMap((species, s) => natures.map((nature, n) => ({
    name: species, species, item: '', ability: '', moves: ['Splash'], nature, gender: '', level: 50, ivs: { ...ALL_31 },
    evs: Object.fromEntries(STATS.map((stat, k) => [stat, GRID[(s + n + k) % GRID.length]])) as Record<Stat, number>,
  } as PokemonSet)));
}
/** The simulator's stats for every set, built in teams of the format's size. */
function simulatorStats(formatid: string, size: number, sets: PokemonSet[]): Record<Stat, number>[] {
  const out: Record<Stat, number>[] = [];
  for (let start = 0; start < sets.length; start += size) {
    const team = sets.slice(start, start + size);
    const battle = new Battle({ formatid: formatid as never, seed: '1,2,3,4', p1: { name: 'A', team }, p2: { name: 'B', team: team.slice(0, 1) } });
    for (const pokemon of battle.sides[0].pokemon) out.push({ ...pokemon.storedStats, hp: pokemon.maxhp } as Record<Stat, number>);
  }
  return out;
}

describe('Champions battles run on the Champions mod (T145)', () => {
  test('after loadSimMods a Champions format resolves to the Champions mod, once', async () => {
    for (const { id } of Object.values(FORMATS)) {
      const format = Dex.formats.get(id);
      expect(format.exists, id).toBe(true);
      expect(format.mod, id).toBe('champions');
      expect(Dex.forFormat(format), id).toBe(championsDex());
    }
    await loadSimMods('gen9championsvgc2026regmbbo3');
    expect(Dex.formats.getRuleTable(Dex.formats.get('gen9championsou')).evLimit).toBe(evBudget('gen9championsou').total);
  });

  let checked: PokemonSet[] | null = null;
  const sets = () => (checked ??= checkerSets());
  for (const [kind, { id, team }] of Object.entries(FORMATS)) {
    test(`a Champions battle computes every stat by the mod's statModify (${kind})`, () => {
      expect(sets().length).toBeGreaterThan(250 * 25);
      const simulated = simulatorStats(id, team, sets());
      const wrong = sets().flatMap((set, i) => STATS.filter(stat => simulated[i][stat] !== serverStat(set, stat))
        .map(stat => `${set.species} ${set.nature} ${stat}: ${simulated[i][stat]} vs ${serverStat(set, stat)}`));
      expect(wrong.slice(0, 10)).toEqual([]);
    });
  }

  test('the calculator reads a Champions body as the simulator plays it', () => {
    const gen = Generations.get(9);
    const budget = evBudget('gen9championsou');
    const simulated = simulatorStats(FORMATS.doubles.id, FORMATS.doubles.team, sets());
    const unknown = new Set<string>();
    const wrong: string[] = [];
    sets().forEach((set, i) => {
      let calc: CalcPokemon;
      try {
        calc = new CalcPokemon(gen, set.species, { level: 50, nature: set.nature, evs: calcEvs(set.evs, budget), ivs: calcIvs({ ...ALL_31, spe: 0 }, budget) });
      } catch {
        unknown.add(set.species);
        return;
      }
      const stats = { ...calc.stats, hp: calc.maxHP() } as Record<Stat, number>;
      for (const stat of STATS) if (stats[stat] !== simulated[i][stat]) wrong.push(`${set.species} ${set.nature} ${stat}: ${stats[stat]} vs ${simulated[i][stat]}`);
    });
    expect(wrong.slice(0, 10)).toEqual([]);
    // Species names @smogon/calc 0.11 does not know (cosmetic formes, names it spells apart): their bodies go uncompared.
    expect([...unknown].length, [...unknown].join(', ')).toBeLessThan(championsSpecies().length / 10);
  });

  test('Champions stats ignore IVs', () => {
    const sets = championsSpecies().slice(0, 40).map(species => ({
      name: species, species, item: '', ability: '', moves: ['Splash'], nature: 'Adamant', gender: '', level: 50,
      evs: { hp: 32, atk: 32, def: 0, spa: 0, spd: 2, spe: 0 },
    }));
    const at = (iv: number) => simulatorStats(FORMATS.singles.id, 6, sets.map(set => ({ ...set, ivs: { hp: iv, atk: iv, def: iv, spa: iv, spd: iv, spe: iv } }) as PokemonSet));
    expect(at(0)).toEqual(at(31));
  });

  const replays = { singles: 'gen9championsou-2693832490', doubles: 'gen9championsvgc2026regmbbo3-2679053861' } as const;
  for (const [kind, id] of Object.entries(replays)) {
    test(`a Champions replay reconstructs on the mod, Stat Points as the server reads them (${kind})`, async () => {
      const replay = JSON.parse(readFileSync(new URL(`./fixtures/champions/${id}.json`, import.meta.url), 'utf-8')) as { id: string; format: string; formatid: string; log: string };
      const { snapshots } = parseReplayLogWithObservations(replay.log);
      const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
      const format = getBranchSimulatorFormat(replay);
      const runtime = await reconstructBranchRuntime({
        format, p1Team, p2Team, replayLog: replay.log, targetTurn: 3, snapshot: snapshots[2], bringOnly: replayBringOnly(replay, snapshots),
      });
      const battle = runtime.battleStream.battle!;
      expect(battle.dex.currentMod).toBe('champions');
      expect(battle.format.id).toBe(format);
      expect(battle.gameType).toBe(kind);
      for (const side of battle.sides) {
        for (const pokemon of side.pokemon) {
          expect(pokemon.canTerastallize, pokemon.name).toBeFalsy();
          expect(pokemon.maxhp, pokemon.name).toBe(serverStat({ ...pokemon.set, species: pokemon.baseSpecies.name }, 'hp'));
          for (const stat of ['atk', 'def', 'spa', 'spd', 'spe'] as const) {
            expect(pokemon.storedStats[stat], `${pokemon.name} ${stat}`).toBe(serverStat({ ...pokemon.set, species: pokemon.species.name }, stat));
          }
        }
      }
    });
  }
});
