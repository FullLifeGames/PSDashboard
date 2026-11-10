import { describe, expect, test } from 'vitest';
import { parseReplayLog, replayBringList, replayBringOnly, type BringList, type SmogonUsageStats } from '@fulllifegames/replay-core';
import { BRING_WORLD_CAP, bringWorlds } from '../src/branch/bring-worlds';

/**
 * Round 89 (#124, stage 1): the list of a bring-limited game with its unknown bodies, and the worlds the engine will play.
 * A world is one set of guesses for the bodies a side brought but never fielded. Units over the rules of the weights, the
 * pairs, the cap and the pinned game; the rebuilds of the scenes are in bring-limit.spec.ts. Singles and doubles both.
 */
const PREVIEW = ['Garchomp', 'Gholdengo', 'Kingambit', 'Dragonite', 'Corviknight', 'Glimmora'];

/** The leads enter before turn 1 (one in singles, two in doubles), then one body per side enters per turn. */
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

/** Singles: P1 fielded two of three, P2 fielded three. */
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

describe('replayBringList: the weights of a short side (#124)', () => {
  test('Battle Stadium Singles: the candidates are the preview bodies P1 never fielded, in preview order', () => {
    const list = listOf(bssLog, BSS_ID)!;
    expect(list.count).toBe(3);
    expect(list.p1.fielded).toEqual(['Garchomp', 'Gholdengo']);
    expect(list.p1.open).toBe(1);
    expect(names(list.p1)).toEqual(['Kingambit', 'Dragonite', 'Corviknight', 'Glimmora']);
    expect(weights(list.p1).every(weight => Math.abs(weight - 0.25) < 1e-9)).toBe(true);
    // P2 fielded its whole selection: nothing to guess.
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

describe('bringWorlds: once per game (#124)', () => {
  test('the cap is three', () => {
    expect(BRING_WORLD_CAP).toBe(3);
  });

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
