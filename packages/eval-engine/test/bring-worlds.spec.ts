import { describe, expect, test } from 'vitest';
import {
  parseReplayLog,
  replayBringList,
  replayBringOnly,
  type BringList,
  type SmogonUsageStats,
  buildTeamsFromReplay,
  getBranchSimulatorFormat,
  type ReplayData,
} from '@fulllifegames/replay-core';
import { BRING_WORLD_CAP, bringWorlds, blendValues, blendWorlds, type BringWorld } from '../src/branch/bring-worlds';
import type { EvalLine, EvalMatrix, EvalResult, ForcedWin, RankedChoice } from '../src/types';
import { readFileSync } from 'node:fs';
import type { PokemonSet } from '@pkmn/sim';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { loadSimMods } from '../src/forward/sim-mods';
import { searchPosition } from '../src/search';
import { serializeLiveBattle } from '../src/serialize';

const PREVIEW = ['Garchomp', 'Gholdengo', 'Kingambit', 'Dragonite', 'Corviknight', 'Glimmora'];

function log(gametype: 'singles' | 'doubles', tier: string, preview: { p1: string[]; p2: string[] }, played: { p1: string[]; p2: string[] }, count?: number): string {
  const leads = gametype === 'singles' ? 1 : 2;
  const enter = (side: 'p1' | 'p2', index: number) => {
    const name = played[side][index];
    return name === undefined ? [] : [`|switch|${side}${'ab'[index < leads ? index : 0]}: ${name}|${name}, L50|100/100`];
  };
  const rounds = Math.max(played.p1.length, played.p2.length) - leads;
  return [
    '|player|p1|Alice|', '|player|p2|Bob|', `|gametype|${gametype}`, '|gen|9', `|tier|${tier}`,
    ...preview.p1.map(name => `|poke|p1|${name}, L50|`), ...preview.p2.map(name => `|poke|p2|${name}, L50|`),
    count === undefined ? '|teampreview' : `|teampreview|${count}`, '|start',
    ...Array.from({ length: leads }, (_, index) => [...enter('p1', index), ...enter('p2', index)]).flat(),
    '|turn|1',
    ...Array.from({ length: Math.max(rounds, 0) }, (_, round) => [...enter('p1', leads + round), ...enter('p2', leads + round), `|turn|${round + 2}`]).flat(),
  ].join('\n');
}

const BSS_TIER = '[Gen 9] Battle Stadium Singles Regulation H';
const BSS_ID = 'gen9battlestadiumsinglesregh';
const VGC_TIER = '[Gen 9] VGC 2026 Regulation I';
const VGC_ID = 'gen9vgc2026regi';

const bssLog = log('singles', BSS_TIER, { p1: PREVIEW, p2: PREVIEW }, { p1: ['Garchomp', 'Gholdengo'], p2: ['Kingambit', 'Dragonite', 'Corviknight'] }, 3);
const listOf = (text: string, formatid: string, stats?: SmogonUsageStats | null) => replayBringList({ formatid, log: text }, parseReplayLog(text), stats);

function usage(counts: Record<string, number>): SmogonUsageStats {
  const pokemon: SmogonUsageStats['pokemon'] = {};
  for (const [species, rawCount] of Object.entries(counts)) {
    pokemon[species.toLowerCase().replace(/[^a-z0-9]/g, '')] = { species, rawCount, abilities: [], items: [], moves: [], spreads: [] };
  }
  return { format: 'test', month: '2026-10', source: 'test', pokemon };
}

const names = (side: { candidates: { species: string }[] }) => side.candidates.map(candidate => candidate.species);
const weights = (side: { candidates: { weight: number }[] }) => side.candidates.map(candidate => candidate.weight);

describe('replayBringList: the weights of a short side', () => {
  test('Battle Stadium Singles: the candidates are the preview bodies P1 never fielded, in preview order', () => {
    const list = listOf(bssLog, BSS_ID)!;
    expect(list.count).toBe(3);
    expect(list.p1.fielded).toEqual(['Garchomp', 'Gholdengo']);
    expect(list.p1.open).toBe(1);
    expect(names(list.p1)).toEqual(['Kingambit', 'Dragonite', 'Corviknight', 'Glimmora']);
    expect(weights(list.p1).every(weight => Math.abs(weight - 0.25) < 1e-9)).toBe(true);
    expect(list.p2.open).toBe(0);
    expect(list.p2.candidates).toEqual([]);
  });

  test('a candidate weighs by the usage count of its species, and a missing one takes the smallest count present', () => {
    const list = listOf(bssLog, BSS_ID, usage({ Kingambit: 500, Dragonite: 300, Corviknight: 200 }))!;
    expect(names(list.p1)).toEqual(['Kingambit', 'Dragonite', 'Corviknight', 'Glimmora']);
    // Glimmora is not in the stats: it takes 200, the smallest count present. Total 1,200.
    expect(weights(list.p1).map(weight => Math.round(weight * 1200))).toEqual([500, 300, 200, 200]);
    expect(weights(list.p1).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 9);
  });

  test('the formes of a species add up: Urshifu-* weighs both Urshifu entries', () => {
    const text = log('singles', BSS_TIER, { p1: ['Garchomp', 'Gholdengo', 'Urshifu-*', 'Dragonite', 'Corviknight', 'Glimmora'], p2: PREVIEW },
      { p1: ['Garchomp', 'Gholdengo'], p2: ['Kingambit', 'Dragonite', 'Corviknight'] }, 3);
    const stats = usage({ 'Urshifu-Rapid-Strike': 300, 'Urshifu-Single-Strike': 100, Dragonite: 400, Corviknight: 200 });
    const list = listOf(text, BSS_ID, stats)!;
    expect(names(list.p1)).toEqual(['Urshifu-*', 'Dragonite', 'Corviknight', 'Glimmora']);
    expect(weights(list.p1).map(weight => Math.round(weight * 1200))).toEqual([400, 400, 200, 200]);
  });

  test('no stats, empty stats and stats with no count give equal weights', () => {
    for (const stats of [undefined, null, usage({}), usage({ Kingambit: 0, Dragonite: 0 })]) {
      const list = listOf(bssLog, BSS_ID, stats)!;
      expect(weights(list.p1).every(weight => Math.abs(weight - 0.25) < 1e-9)).toBe(true);
    }
  });

  test('doubles: a side two bodies short has open 2', () => {
    const text = log('doubles', VGC_TIER, { p1: PREVIEW, p2: PREVIEW }, { p1: ['Garchomp', 'Gholdengo'], p2: ['Kingambit', 'Dragonite'] });
    const list = listOf(text, VGC_ID)!;
    expect(list.count).toBe(4);
    expect(list.p1.open).toBe(2);
    expect(list.p2.open).toBe(2);
    expect(names(list.p1)).toEqual(['Kingambit', 'Dragonite', 'Corviknight', 'Glimmora']);
    expect(names(list.p2)).toEqual(['Garchomp', 'Gholdengo', 'Corviknight', 'Glimmora']);
  });

  test('a bring-all format has no list', () => {
    const text = log('doubles', '[Gen 9] Doubles OU', { p1: PREVIEW, p2: PREVIEW }, { p1: ['Garchomp', 'Gholdengo'], p2: ['Kingambit', 'Dragonite'] });
    expect(listOf(text, 'gen9doublesou')).toBeNull();
  });
});

const side = (fielded: string[], candidates: [string, number][], open: number) => ({
  fielded, open, candidates: candidates.map(([species, weight]) => ({ species, weight })),
});

describe('bringWorlds: once per game', () => {
  test('a bring-all game gives no worlds', () => {
    expect(bringWorlds(null, BRING_WORLD_CAP)).toBeNull();
  });

  test('a pinned game gives one world of weight 1 whose lists are the lists of replayBringOnly', () => {
    const text = log('singles', BSS_TIER, { p1: PREVIEW, p2: PREVIEW }, { p1: ['Garchomp', 'Gholdengo', 'Glimmora'], p2: ['Kingambit', 'Dragonite', 'Corviknight'] }, 3);
    const snapshots = parseReplayLog(text);
    const worlds = bringWorlds(listOf(text, BSS_ID), BRING_WORLD_CAP)!;
    const pinned = replayBringOnly({ formatid: BSS_ID, log: text }, snapshots)!;
    expect(worlds).toHaveLength(1);
    expect(worlds[0]).toEqual({ p1: pinned.p1, p2: pinned.p2, guessed: { p1: 0, p2: 0 }, weight: 1 });
  });

  test('one open body gives a world per candidate, the guess last, the heaviest first, ties by preview order', () => {
    const list: BringList = { count: 3, p1: side(['A', 'B'], [['C', 0.2], ['D', 0.5], ['E', 0.3]], 1), p2: side(['X', 'Y', 'Z'], [], 0) };
    const worlds = bringWorlds(list, 5)!;
    expect(worlds.map(world => world.p1)).toEqual([['A', 'B', 'D'], ['A', 'B', 'E'], ['A', 'B', 'C']]);
    expect(worlds.map(world => world.weight)).toEqual([0.5, 0.3, 0.2]);
    expect(worlds.every(world => world.guessed.p1 === 1 && world.guessed.p2 === 0 && world.p2.join() === 'X,Y,Z')).toBe(true);

    const tied: BringList = { count: 3, p1: side(['A', 'B'], [['C', 1 / 3], ['D', 1 / 3], ['E', 1 / 3]], 1), p2: side(['X', 'Y', 'Z'], [], 0) };
    expect(bringWorlds(tied, 5)!.map(world => world.p1[2])).toEqual(['C', 'D', 'E']);
  });

  test('two open bodies give a world per pair, the weight the product of the shares', () => {
    const list: BringList = { count: 4, p1: side(['A', 'B'], [['C', 0.5], ['D', 0.3], ['E', 0.2]], 2), p2: side(['W', 'X', 'Y', 'Z'], [], 0) };
    const worlds = bringWorlds(list, 10)!;
    expect(worlds.map(world => world.p1.slice(2).join('+'))).toEqual(['C+D', 'C+E', 'D+E']);
    // Products 0.15, 0.10, 0.06 over their sum 0.31.
    expect(worlds.map(world => world.weight)).toEqual([0.15 / 0.31, 0.10 / 0.31, 0.06 / 0.31].map(weight => expect.closeTo(weight, 9)));
    expect(worlds.every(world => world.guessed.p1 === 2)).toBe(true);
  });

  test('both sides short: the worlds are the product of the side worlds, the cap keeps the heaviest three and renormalizes', () => {
    const list: BringList = {
      count: 3,
      p1: side(['A', 'B'], [['C', 0.6], ['D', 0.4]], 1),
      p2: side(['W', 'X'], [['Y', 0.7], ['Z', 0.3]], 1),
    };
    const all = bringWorlds(list, 10)!;
    expect(all).toHaveLength(4);
    expect(all.map(world => `${world.p1[2]}${world.p2[2]}`)).toEqual(['CY', 'DY', 'CZ', 'DZ']);
    expect(all.reduce((sum, world) => sum + world.weight, 0)).toBeCloseTo(1, 9);

    const capped = bringWorlds(list, BRING_WORLD_CAP)!;
    expect(capped.map(world => `${world.p1[2]}${world.p2[2]}`)).toEqual(['CY', 'DY', 'CZ']);
    expect(capped.every(world => world.guessed.p1 === 1 && world.guessed.p2 === 1)).toBe(true);
    // 0.42, 0.28, 0.18 over 0.88.
    expect(capped.map(world => world.weight)).toEqual([0.42 / 0.88, 0.28 / 0.88, 0.18 / 0.88].map(weight => expect.closeTo(weight, 9)));
    expect(capped.reduce((sum, world) => sum + world.weight, 0)).toBeCloseTo(1, 9);
  });

  test('a game under the cap keeps every world with its own weights', () => {
    const list: BringList = { count: 3, p1: side(['A', 'B'], [['C', 0.7], ['D', 0.3]], 1), p2: side(['X', 'Y', 'Z'], [], 0) };
    const worlds = bringWorlds(list, BRING_WORLD_CAP)!;
    expect(worlds).toHaveLength(2);
    expect(worlds.map(world => world.weight)).toEqual([expect.closeTo(0.7, 9), expect.closeTo(0.3, 9)]);
  });
});

const row = (choice: string, ev: number, extra: Partial<RankedChoice> = {}): RankedChoice => ({
  choice, label: choice.toUpperCase(), worstCase: ev - 0.1, expected: ev - 0.05, ev, punishedBy: 'reply', ...extra,
});

function result(over: Partial<EvalResult> = {}): EvalResult {
  return {
    score: 0.2, interval: 0.1, depthCompleted: 2, gameValue: 0.2,
    perSide: { p1: [row('a', 0.3), row('b', 0.1)], p2: [row('x', -0.2), row('y', -0.4)] },
    ...over,
  };
}

const forced = (side: 'p1' | 'p2'): ForcedWin => ({ side, turns: 2, mass: 1, caveat: 'none', engineScore: 0.5, states: 10 });

describe('blendValues', () => {
  test('one value comes back exactly, whatever its weight', () => {
    expect(blendValues([0.1 + 0.2], [0.37])).toBe(0.1 + 0.2);
    expect(blendValues([-0.7], [1])).toBe(-0.7);
  });

  test('the weighted mean, normalized by the weights that are present', () => {
    expect(blendValues([1, 0], [0.75, 0.25])).toBeCloseTo(0.75, 12);
    expect(blendValues([1, 0, 0.5], [0.3, 0.1, 0.1])).toBeCloseTo((0.3 + 0.05) / 0.5, 12);
  });
});

describe('blendWorlds', () => {
  test('one world returns the same object: pinned and bring-all games stay byte-identical', () => {
    const only = result();
    expect(blendWorlds([only], [1])).toBe(only);
    expect(blendWorlds([only], [0.4])).toBe(only);
  });

  test('score, interval and gameValue are weighted means, depthCompleted the minimum', () => {
    const blended = blendWorlds([
      result({ score: 0.4, interval: 0.2, gameValue: 0.5, depthCompleted: 3 }),
      result({ score: -0.4, interval: 0.6, gameValue: -0.3, depthCompleted: 2 }),
    ], [0.75, 0.25]);
    expect(blended.score).toBeCloseTo(0.2, 12);
    expect(blended.interval).toBeCloseTo(0.3, 12);
    expect(blended.gameValue).toBeCloseTo(0.3, 12);
    expect(blended.depthCompleted).toBe(2);
  });

  test('gameValue and trend appear only when every world has them', () => {
    const missing = blendWorlds([result({ gameValue: 0.5, trend: 0.1 }), result({ gameValue: undefined, trend: 0.3 })], [0.5, 0.5]);
    expect(missing.gameValue).toBeUndefined();
    expect(missing.trend).toBeCloseTo(0.2, 12);
    const none = blendWorlds([result({ trend: 0.1 }), result({ trend: undefined })], [0.5, 0.5]);
    expect(none.trend).toBeUndefined();
    expect('trend' in none).toBe(false);
  });

  test('the heaviest world is the frame, whatever its place in the list', () => {
    const light = result({ score: 0, engine: { id: 'light', name: 'light' }, perSide: { p1: [row('a', 0.3, { label: 'Light A', punishedBy: 'light reply' })], p2: [] } });
    const heavy = result({ score: 0, engine: { id: 'heavy', name: 'heavy' }, perSide: { p1: [row('a', 0.1, { label: 'Heavy A', punishedBy: 'heavy reply', line: [{ p1: 'a', p2: 'x' }] })], p2: [] } });
    const blended = blendWorlds([light, heavy], [0.3, 0.7]);
    expect(blended.engine?.id).toBe('heavy');
    expect(blended.perSide.p1[0].label).toBe('Heavy A');
    expect(blended.perSide.p1[0].punishedBy).toBe('heavy reply');
    expect(blended.perSide.p1[0].line).toEqual([{ p1: 'a', p2: 'x' }]);
    expect(blended.perSide.p1[0].ev).toBeCloseTo(0.3 * 0.3 + 0.7 * 0.1, 12);
    expect(blended.perSide.p1[0].worstCase).toBeCloseTo(0.3 * 0.2 + 0.7 * 0, 12);
    expect(blended.perSide.p1[0].expected).toBeCloseTo(0.3 * 0.25 + 0.7 * 0.05, 12);
  });

  test('a row one world lacks blends over the worlds that hold it; a row only a lighter world ranks is dropped; the rows re-sort by the blended ev', () => {
    const heavy = result({ perSide: { p1: [row('a', 0.2), row('b', 0.1), row('c', 0.05)], p2: [row('x', -0.1)] } });
    const light = result({ perSide: { p1: [row('b', 0.9), row('a', 0), row('d', 0.99)], p2: [row('x', -0.1)] } });
    const blended = blendWorlds([light, heavy], [0.4, 0.6]);
    // a: 0.12, b: 0.06 + 0.36 = 0.42, c: only the heavy world holds it (its own 0.05), d: only the light one, dropped.
    expect(blended.perSide.p1.map(entry => entry.choice)).toEqual(['b', 'a', 'c']);
    expect(blended.perSide.p1.map(entry => entry.ev)).toEqual([expect.closeTo(0.42, 12), expect.closeTo(0.12, 12), expect.closeTo(0.05, 12)]);
  });

  test('lines: the engine line is the line of the blended best row, from whichever world holds it; the played line stays', () => {
    const line = (side: 'p1' | 'p2', label: string, roles: EvalLine['for'], end: number): EvalLine =>
      ({ side, label, choice: label.toLowerCase(), for: roles, visits: 10, end, endFainted: 0, steps: [] });
    const heavy = result({
      perSide: { p1: [row('a', 0.3), row('b', 0.25)], p2: [row('x', -0.2), row('y', -0.4)] },
      lines: [line('p1', 'A', ['engine'], 0.31), line('p2', 'X', ['engine', 'played'], -0.2)],
    });
    const light = result({
      perSide: { p1: [row('b', 0.6), row('a', 0)], p2: [row('x', -0.2), row('y', -0.4)] },
      lines: [line('p1', 'B', ['engine'], 0.61), line('p1', 'A', ['played'], 0.01), line('p2', 'X', ['engine'], -0.19)],
    });
    const blended = blendWorlds([heavy, light], [0.6, 0.4]);
    expect(blended.perSide.p1[0].label).toBe('B');
    const seen = [...(blended.lines ?? [])].sort((a, b) => a.side.localeCompare(b.side) || a.label.localeCompare(b.label));
    expect(seen.map(entry => [entry.side, entry.label, entry.for, entry.end])).toEqual([
      ['p1', 'A', ['played'], 0.01], ['p1', 'B', ['engine'], 0.61], ['p2', 'X', ['engine', 'played'], -0.2],
    ]);
    expect(blendWorlds([result(), result()], [0.6, 0.4]).lines).toBeUndefined();
    const onlyHeavy = blendWorlds([heavy, result({ perSide: light.perSide })], [0.6, 0.4]);
    expect(onlyHeavy.lines?.every(entry => entry.for.includes('played') || entry.label === onlyHeavy.perSide[entry.side][0].label)).toBe(true);
  });

  test('equal blended evs keep the heaviest world\'s order', () => {
    const heavy = result({ perSide: { p1: [row('a', 0.3), row('b', 0.3), row('c', 0.1)], p2: [] } });
    const light = result({ perSide: { p1: [row('c', 0.1), row('b', 0.3), row('a', 0.3)], p2: [] } });
    expect(blendWorlds([light, heavy], [0.2, 0.8]).perSide.p1.map(entry => entry.choice)).toEqual(['a', 'b', 'c']);
  });

  test('the matrix keeps the heaviest world\'s rows and columns; cells blend by choice id with summed visits', () => {
    const matrix = (p1: string[], p2: string[], values: number[][], verified: boolean[][], p1Mix: number[], p2Mix: number[]): EvalMatrix => ({
      p1Labels: p1.map(id => id.toUpperCase()), p2Labels: p2.map(id => id.toUpperCase()), p1Choices: p1, p2Choices: p2, values,
      mixes: { p1: p1Mix, p2: p2Mix },
      cells: values.map((line, i) => line.map((_, j) => ({ visits: 10 * (i + 1) + j, verified: verified[i][j] }))),
    });
    const heavy = result({ matrix: matrix(['a', 'b'], ['x', 'y'], [[0.4, 0.2], [0, -0.2]], [[true, true], [true, false]], [0.75, 0.25], [0.5, 0.5]) });
    const light = result({ matrix: matrix(['b', 'a'], ['y', 'x', 'z'], [[0.8, 0.6, 0.1], [0.4, 0, 0.3]], [[true, true, true], [true, true, true]], [0.5, 0.5], [0.2, 0.2, 0.6]) });
    const blended = blendWorlds([light, heavy], [0.25, 0.75]).matrix!;
    expect(blended.p1Choices).toEqual(['a', 'b']);
    expect(blended.p2Choices).toEqual(['x', 'y']);
    expect(blended.p1Labels).toEqual(['A', 'B']);
    // Cell (a, x): heavy 0.4 (0.75), light row a col x = values[1][1] = 0 (0.25).
    expect(blended.values[0][0]).toBeCloseTo(0.3, 12);
    // Cell (b, y): heavy -0.2, light row b col y = values[0][0] = 0.8.
    expect(blended.values[1][1]).toBeCloseTo(0.75 * -0.2 + 0.25 * 0.8, 12);
    // Visits add up (heavy cell (a,x) = 10, light cell = cells[1][1] = 21); verified only when every holder verified.
    expect(blended.cells![0][0].visits).toBe(10 + 21);
    expect(blended.cells![0][0].verified).toBe(true);
    expect(blended.cells![1][1].verified).toBe(false);
    const p1Raw = [0.75 * 0.75 + 0.25 * 0.5, 0.75 * 0.25 + 0.25 * 0.5];
    expect(blended.mixes.p1).toEqual(p1Raw.map(share => expect.closeTo(share / (p1Raw[0] + p1Raw[1]), 12)));
    expect(blended.mixes.p1[0] + blended.mixes.p1[1]).toBeCloseTo(1, 12);
    expect(blended.mixes.p2[0] + blended.mixes.p2[1]).toBeCloseTo(1, 12);
  });

  test('forcedWin stays only when every world proves one for the same side', () => {
    const same = blendWorlds([result({ forcedWin: forced('p1') }), result({ forcedWin: forced('p1') })], [0.7, 0.3]);
    expect(same.forcedWin?.side).toBe('p1');
    const split = blendWorlds([result({ forcedWin: forced('p1') }), result({ forcedWin: forced('p2') })], [0.7, 0.3]);
    expect(split.forcedWin).toBeUndefined();
    const open = blendWorlds([result({ forcedWin: forced('p1') }), result()], [0.7, 0.3]);
    expect(open.forcedWin).toBeUndefined();
    expect('forcedWin' in open).toBe(false);
  });
});

const entry = (species: string, rawCount: number) =>
  [species.toLowerCase().replace(/[^a-z0-9]/g, ''), { species, rawCount, abilities: [], items: [], moves: [], spreads: [] }] as const;
const statsOf = (counts: [string, number][]): SmogonUsageStats => ({
  format: 'test', month: '2026-10', source: 'test', pokemon: Object.fromEntries(counts.map(([species, rawCount]) => entry(species, rawCount))),
});
const fixture = <T = ReplayData>(file: string) => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf-8')) as T;

function mon(name: string, move: string): PokemonSet {
  return {
    name, species: name, item: '', ability: '', moves: [move, 'Protect'], nature: 'Serious',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50,
  };
}

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

const guessRows = (result: EvalResult, side: 'p1' | 'p2', slots: number) =>
  result.perSide[side].filter(row => new RegExp(`switch ${slots}\\b`).test(row.choice));
const named = (label: string, species: string) => label.includes(`→ ${species.split('-')[0]}`);

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
    teamsFile: null,
  },
  {
    label: 'VGC 2630181744 (doubles; P1 short)', file: 'gen9vgc2026regi-2630181744.json', short: 'p1' as const,
    stats: statsOf([['Incineroar', 400000], ['Amoonguss', 200000], ['Grimmsnarl', 50000]]),
    order: ['Incineroar', 'Amoonguss', 'Grimmsnarl'], noBody: [] as string[], turns: [2, 4],
    teamsFile: 'gen9vgc2026regi-2630181744-teams.json',
  },
];

describe('the blend of the worlds of a short-side game', () => {
  for (const scene of SCENES) {
    test(`${scene.label}: turns ${scene.turns.join(', ')} blend three worlds with one choice string for the unknown body`, async () => {
      const replay = fixture(scene.file);
      await loadSimMods(getBranchSimulatorFormat(replay));
      const worlds = bringWorlds(replayBringList(replay, parseReplayLog(replay.log), scene.stats), BRING_WORLD_CAP)!;
      expect(worlds).toHaveLength(3);
      expect(worlds.map(world => world[scene.short][3].split('-')[0])).toEqual(scene.order.map(name => name.split('-')[0]));
      const teams = scene.teamsFile ? fixture<{ p1Team: PokemonSet[]; p2Team: PokemonSet[] }>(scene.teamsFile) : buildTeamsFromReplay(replay.log);
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

        const sum = (pick: (result: EvalResult) => number) => results.reduce((total, result, index) => total + pick(result) * weights[index], 0);
        expect(blended.score).toBeCloseTo(sum(result => result.score), 9);
        expect(blended.interval).toBeCloseTo(sum(result => result.interval), 9);
        const top = blended.perSide[scene.short][0];
        const own = results.flatMap((result, index) => {
          const found = result.perSide[scene.short].find(row => row.choice === top.choice);
          return found ? [{ ev: found.ev, weight: weights[index] }] : [];
        });
        expect(own.length).toBeGreaterThan(0);
        expect(top.ev).toBeCloseTo(own.reduce((total, row) => total + row.ev * row.weight, 0) / own.reduce((total, row) => total + row.weight, 0), 9);
        for (const side of ['p1', 'p2'] as const) {
          const evs = blended.perSide[side].map(row => row.ev);
          expect(evs).toEqual([...evs].sort((a, b) => b - a));
        }
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
    const moves: Record<string, string> = { Garchomp: 'Earthquake', Gholdengo: 'Make It Rain', Kingambit: 'Iron Head', Dragonite: 'Extreme Speed', Corviknight: 'Brave Bird', Glimmora: 'Sludge Wave' };
    const teams = { p1Team: preview.map(name => mon(name, moves[name])), p2Team: preview.map(name => mon(name, moves[name])) };
    const results: EvalResult[] = [];
    for (const world of worlds) results.push(await evaluateWorld(replay, world, teams, 3));
    const weights = worlds.map(world => world.weight);
    const blended = blendWorlds(results, weights);
    expectOneStringForTheGuess(results, worlds, blended, 'p1', 3, 'BSS turn 3');
    expect(blended.score).toBeCloseTo(results.reduce((total, result, index) => total + result.score * weights[index], 0), 9);
    for (const row of blended.perSide.p2) expect(row.label).not.toMatch(/Glimmora|Gholdengo/);
  }, 600_000);
});
