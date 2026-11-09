import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, replayBringList, type ReplayData, type SmogonUsageStats,
} from '@fulllifegames/replay-core';
import type { PokemonSet } from '@pkmn/sim';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { BRING_WORLD_CAP, blendWorlds, bringWorlds, type BringWorld } from '../src/branch/bring-worlds';
import { loadSimMods } from '../src/forward/sim-mods';
import { searchPosition } from '../src/search';
import { serializeLiveBattle } from '../src/serialize';
import type { EvalResult } from '../src/types';

/**
 * Round 89 (#124, stage 2): the blend on real scenes. Each world of a short-side game is rebuilt to a turn and searched (matrix
 * depth 1, one sample, the static leaf), then the worlds are blended. The unknown body is one choice string in every world, so the
 * blended rows hold one switch to it, labelled with the heaviest world's candidate; the known bodies of the full side never
 * include a body the game never fielded; the blended score is the weighted sum. Doubles (Champions VGC, VGC Scarlet/Violet) and
 * singles (a synthetic Battle Stadium Singles log: the corpus holds none).
 */
const entry = (species: string, rawCount: number) =>
  [species.toLowerCase().replace(/[^a-z0-9]/g, ''), { species, rawCount, abilities: [], items: [], moves: [], spreads: [] }] as const;
const statsOf = (counts: [string, number][]): SmogonUsageStats => ({
  format: 'test', month: '2026-10', source: 'test', pokemon: Object.fromEntries(counts.map(([species, rawCount]) => entry(species, rawCount))),
});
const fixture = (file: string) => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf-8')) as ReplayData;

function mon(name: string, move: string): PokemonSet {
  return {
    name, species: name, item: '', ability: '', moves: [move, 'Protect'], nature: 'Serious',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50,
  };
}

/** One world's position at `turn` (the boundary before it), searched light. */
async function evaluateWorld(replay: ReplayData, world: BringWorld, teams: { p1Team: PokemonSet[]; p2Team: PokemonSet[] }, turn: number): Promise<EvalResult> {
  const format = getBranchSimulatorFormat(replay);
  await loadSimMods(format);
  const snapshots = parseReplayLog(replay.log);
  const runtime = await reconstructBranchRuntime({
    format, ...teams, replayLog: replay.log, targetTurn: turn, snapshot: snapshots[Math.min(turn - 1, snapshots.length - 1)],
    bringOnly: { p1: world.p1, p2: world.p2, guessed: world.guessed }, deadlineMs: 120_000,
  });
  const battle = runtime.battleStream.battle!;
  expect(battle.ended).toBe(false);
  return searchPosition(serializeLiveBattle(battle), { depth: 1, samples: 1, tera: false });
}

/** The short side's rows that switch to the last party slot, the slot of the unknown body in every world. */
const guessRows = (result: EvalResult, side: 'p1' | 'p2', slots: number) =>
  result.perSide[side].filter(row => new RegExp(`switch ${slots}\\b`).test(row.choice));
const named = (label: string, species: string) => label.includes(`→ ${species.split('-')[0]}`);

/**
 * The unknown body is one choice string in every world: a row switches to the last party slot exactly when its label names the
 * world's own candidate, and the blended rows hold the strings the heaviest world ranks (the frame), named for its candidate only.
 * Returns how many the blended rows hold.
 */
function expectOneStringForTheGuess(results: EvalResult[], worlds: BringWorld[], blended: EvalResult, side: 'p1' | 'p2', slots: number, note: string): number {
  const candidates = worlds.map(world => world[side][slots - 1]);
  const seen = new Set<string>();
  results.forEach((result, index) => {
    const rows = guessRows(result, side, slots);
    for (const row of rows) {
      expect(named(row.label, candidates[index]), `${note}: world ${index} row "${row.choice}" names ${candidates[index]}: ${row.label}`).toBe(true);
      seen.add(row.choice);
    }
    const labelled = result.perSide[side].filter(row => named(row.label, candidates[index])).map(row => row.choice);
    expect(labelled.sort(), `${note}: world ${index}: only the last slot names the candidate`).toEqual(rows.map(row => row.choice).sort());
  });
  expect(seen.size, `${note}: a switch to the unknown body stands in some world`).toBeGreaterThan(0);
  const held = guessRows(blended, side, slots);
  expect(new Set(held.map(row => row.choice)), `${note}: the blended rows hold the heaviest world's strings`).toEqual(new Set(guessRows(results[0], side, slots).map(row => row.choice)));
  for (const row of held) {
    expect(named(row.label, candidates[0]), `${note}: blended row "${row.choice}" is named for the heaviest world: ${row.label}`).toBe(true);
    candidates.slice(1).filter(name => name.split('-')[0] !== candidates[0].split('-')[0])
      .forEach(name => expect(named(row.label, name), `${note}: the blended row names no lighter candidate (${name})`).toBe(false));
  }
  return held.length;
}

const SCENES = [
  {
    label: 'Champions VGC 2625939941 (doubles; P1 short)', file: 'gen9championsvgc2026regma-2625939941.json', short: 'p1' as const,
    stats: statsOf([['Kingambit', 717550], ['Ninetales-Alola', 168774], ['Ceruledge', 91889]]),
    order: ['Kingambit', 'Ninetales-Alola', 'Ceruledge'], noBody: ['Kangaskhan', 'Torkoal'], turns: [2, 4],
  },
  {
    // Round 89 (#124, B5b): 2630452654 fielded all four P2 bodies (Farigiraf came in and fainted within turn 2), so 2630181744
    // (P1 never fielded its fourth body) carries the VGC Scarlet/Violet scene; the counts are test data.
    label: 'VGC 2630181744 (doubles; P1 short)', file: 'gen9vgc2026regi-2630181744.json', short: 'p1' as const,
    stats: statsOf([['Incineroar', 400000], ['Amoonguss', 200000], ['Grimmsnarl', 50000]]),
    order: ['Incineroar', 'Amoonguss', 'Grimmsnarl'], noBody: [] as string[], turns: [2, 4, 6],
  },
];

describe('#124: the blend of the worlds of a short-side game', () => {
  for (const scene of SCENES) {
    test(`${scene.label}: turns ${scene.turns.join(', ')} blend three worlds with one choice string for the unknown body`, async () => {
      const replay = fixture(scene.file);
      await loadSimMods(getBranchSimulatorFormat(replay));
      const worlds = bringWorlds(replayBringList(replay, parseReplayLog(replay.log), scene.stats), BRING_WORLD_CAP)!;
      expect(worlds).toHaveLength(3);
      expect(worlds.map(world => world[scene.short][3].split('-')[0])).toEqual(scene.order.map(name => name.split('-')[0]));
      const teams = buildTeamsFromReplay(replay.log);
      let held = 0;
      let differed = 0;
      for (const turn of scene.turns) {
        const results: EvalResult[] = [];
        for (const world of worlds) results.push(await evaluateWorld(replay, world, teams, turn));
        const weights = worlds.map(world => world.weight);
        const blended = blendWorlds(results, weights);

        held += expectOneStringForTheGuess(results, worlds, blended, scene.short, 4, `turn ${turn}`);
        for (const name of scene.noBody) {
          for (const row of [...blended.perSide.p1, ...blended.perSide.p2]) expect(row.label).not.toContain(name);
        }

        // The numbers are the weighted sums.
        const sum = (pick: (result: EvalResult) => number) => results.reduce((total, result, index) => total + pick(result) * weights[index], 0);
        expect(blended.score).toBeCloseTo(sum(result => result.score), 9);
        expect(blended.interval).toBeCloseTo(sum(result => result.interval), 9);
        const top = blended.perSide[scene.short][0];
        // The top row's ev is the mean over the worlds that rank its choice (the doubles search keeps a few combinations per world).
        const own = results.flatMap((result, index) => {
          const found = result.perSide[scene.short].find(row => row.choice === top.choice);
          return found ? [{ ev: found.ev, weight: weights[index] }] : [];
        });
        expect(own.length).toBeGreaterThan(0);
        expect(top.ev).toBeCloseTo(own.reduce((total, row) => total + row.ev * row.weight, 0) / own.reduce((total, row) => total + row.weight, 0), 9);
        // The ranking is the blended ev, descending.
        for (const side of ['p1', 'p2'] as const) {
          const evs = blended.perSide[side].map(row => row.ev);
          expect(evs).toEqual([...evs].sort((a, b) => b - a));
        }
        // The worlds differ at some turn: the blend is not the heaviest world's own score (before the unknown body can enter, the worlds agree).
        if (new Set(results.map(result => result.score.toFixed(9))).size > 1) differed++;
      }
      expect(differed, 'the worlds read differently at some turn').toBeGreaterThan(0);
      expect(held, "the heaviest world ranks a switch to the unknown body at some turn").toBeGreaterThan(0);
    }, 600_000);
  }

  test('Battle Stadium Singles (a synthetic log, P1 short by one body): three worlds blend, one string for the unknown body', async () => {
    const preview = ['Garchomp', 'Gholdengo', 'Kingambit', 'Dragonite', 'Corviknight', 'Glimmora'];
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|singles', '|gen|9', '|tier|[Gen 9] Battle Stadium Singles Regulation H',
      ...preview.map(name => `|poke|p1|${name}, L50|`), ...preview.map(name => `|poke|p2|${name}, L50|`), '|teampreview|3', '|start',
      '|switch|p1a: Garchomp|Garchomp, L50|100/100', '|switch|p2a: Kingambit|Kingambit, L50|100/100', '|turn|1',
      '|switch|p1a: Gholdengo|Gholdengo, L50|100/100', '|switch|p2a: Dragonite|Dragonite, L50|100/100', '|turn|2',
      '|switch|p2a: Corviknight|Corviknight, L50|100/100', '|turn|3',
      '|switch|p1a: Garchomp|Garchomp, L50|100/100', '|turn|4',
    ].join('\n');
    const replay = { id: 'synthetic-bss-blend', formatid: 'gen9battlestadiumsinglesregh', format: '[Gen 9] Battle Stadium Singles Regulation H', players: ['Alice', 'Bob'], log } as ReplayData;
    const stats = statsOf([['Kingambit', 500], ['Dragonite', 300], ['Corviknight', 150], ['Glimmora', 50]]);
    const worlds = bringWorlds(replayBringList(replay, parseReplayLog(log), stats), BRING_WORLD_CAP)!;
    expect(worlds).toHaveLength(3);
    // Distinct sets per body, so the worlds read differently.
    const moves: Record<string, string> = { Garchomp: 'Earthquake', Gholdengo: 'Make It Rain', Kingambit: 'Iron Head', Dragonite: 'Extreme Speed', Corviknight: 'Brave Bird', Glimmora: 'Sludge Wave' };
    const teams = { p1Team: preview.map(name => mon(name, moves[name])), p2Team: preview.map(name => mon(name, moves[name])) };
    const results: EvalResult[] = [];
    for (const world of worlds) results.push(await evaluateWorld(replay, world, teams, 3));
    const weights = worlds.map(world => world.weight);
    const blended = blendWorlds(results, weights);
    expectOneStringForTheGuess(results, worlds, blended, 'p1', 3, 'BSS turn 3');
    expect(blended.score).toBeCloseTo(results.reduce((total, result, index) => total + result.score * weights[index], 0), 9);
    // P2 never fields a Glimmora or a Gholdengo it did not bring.
    for (const row of blended.perSide.p2) expect(row.label).not.toMatch(/Glimmora|Gholdengo/);
  }, 600_000);
});
