import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { loadSimMods } from '@fulllifegames/eval-engine';
import type { ReplayData, SmogonUsageStats } from '@fulllifegames/replay-core';
import { doublesReplay } from '../../fixtures/replay';
import { stubReplayFetch } from '../../fixtures/network';
import { realReplayWorkerClient } from '../../fixtures/worker';

/**
 * Round 89 (#124): the app's format meta reads the worlds of a short-side game. A side that brought more bodies than it fielded
 * gives one world per guess, weighted by the usage counts of the format's statistics; the heaviest world is the one the user plays
 * (`bringOnlyLists` carries its guess, the bench lists its body). A game that brought all it could, a pinned game and a bring-all
 * game give no worlds and read exactly as before. Doubles (VGC, Champions VGC) and singles (Battle Stadium Singles) run the same
 * code; the rows below play both.
 */
const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../../fixtures/worker').realReplayWorkerClient> }));
const usage = vi.hoisted(() => ({ stats: null as SmogonUsageStats | null }));
vi.mock('../../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));
vi.mock('../../../../src/hooks/useSmogonUsageStats', () => ({
  useSmogonUsageStats: () => ({ stats: usage.stats, loading: false, error: usage.stats ? null : 'No Smogon usage stats found for this format' }),
}));

const { useReplayContext } = await import('../../../../src/hooks/controller/replay-context');

const entry = (species: string, rawCount: number) =>
  [species.toLowerCase().replace(/[^a-z0-9]/g, ''), { species, rawCount, abilities: [], items: [], moves: [], spreads: [] }] as const;
const statsOf = (counts: [string, number][]): SmogonUsageStats => ({
  format: 'test', month: '2026-10', source: 'test', pokemon: Object.fromEntries(counts.map(([species, rawCount]) => entry(species, rawCount))),
});

const fixture = (file: string) => JSON.parse(readFileSync(`test/e2e/fixtures/${file}`, 'utf-8')) as ReplayData;
/** Champions VGC 2625939941: P1 fielded Farigiraf, Basculegion, Lopunny and never the fourth (Ceruledge, Ninetales-Alola or Kingambit). */
const championsShort = () => fixture('dock-championsvgc-2625939941.json');
/** Champions VGC 2623421463: both sides fielded all four. */
const championsPinned = () => fixture('dock-championsvgc-2623421463.json');

/** Battle Stadium Singles, bring 3 of 6: P1 fielded Garchomp and Gholdengo, P2 all three. */
const BSS_MONS = ['Garchomp', 'Gholdengo', 'Kingambit', 'Dragonite', 'Corviknight', 'Glimmora'];
const bssShort = (): ReplayData => ({
  id: 'synthetic-bss', formatid: 'gen9battlestadiumsinglesregh', format: '[Gen 9] Battle Stadium Singles Regulation H',
  players: ['Alice', 'Bob'], uploadtime: 0, rating: null, private: 0, password: null,
  log: [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|singles', '|gen|9', '|tier|[Gen 9] Battle Stadium Singles Regulation H',
    ...BSS_MONS.map(mon => `|poke|p1|${mon}, L50|`), ...BSS_MONS.map(mon => `|poke|p2|${mon}, L50|`), '|teampreview|3', '|start',
    '|switch|p1a: Garchomp|Garchomp, L50|100/100', '|switch|p2a: Kingambit|Kingambit, L50|100/100', '|turn|1',
    '|switch|p1a: Gholdengo|Gholdengo, L50|100/100', '|switch|p2a: Dragonite|Dragonite, L50|100/100', '|turn|2',
    '|switch|p2a: Corviknight|Corviknight, L50|100/100', '|turn|3', '|win|Alice',
  ].join('\n'),
} as unknown as ReplayData);

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  usage.stats = null;
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loaded(replay: ReplayData) {
  stubReplayFetch([replay]);
  const hook = renderHook(() => useReplayContext());
  await act(async () => { await hook.result.current.replay.loadReplay(replay.id); });
  return hook.result.current.meta;
}

describe('the worlds of a short-side game in the format meta', () => {
  test('Champions VGC (doubles): P1 short by one body gives three worlds, the likeliest by usage first, and the bench lists its body', async () => {
    await loadSimMods('gen9championsvgc2026regma');
    usage.stats = statsOf([['Kingambit', 717_550], ['Ninetales-Alola', 168_774], ['Ceruledge', 91_889]]);
    const meta = await loaded(championsShort());
    const worlds = meta.bringWorlds!;
    expect(worlds).toHaveLength(3);
    expect(worlds.map(world => world.p1.at(-1))).toEqual(['Kingambit', 'Ninetales-Alola', 'Ceruledge']);
    expect(worlds.reduce((sum, world) => sum + world.weight, 0)).toBeCloseTo(1, 12);
    expect(worlds[0].weight).toBeGreaterThan(worlds[1].weight);
    expect(worlds.every(world => world.guessed.p1 === 1 && world.guessed.p2 === 0)).toBe(true);
    // The user plays the heaviest world: its four bodies, the guess last and marked as one.
    expect(meta.bringOnlyLists).toEqual({ p1: worlds[0].p1, p2: worlds[0].p2, guessed: { p1: 1, p2: 0 } });
    expect(meta.bringOnlyLists?.p1).toHaveLength(4);
    expect(meta.bringOnlyLists?.p1.slice(0, 3).sort()).toEqual(['Basculegion', 'Farigiraf', 'Lopunny']);
    expect([...(meta.bringOnlyLists?.p2 ?? [])].sort()).toEqual(['Aerodactyl', 'Farigiraf', 'Kingambit', 'Sylveon']);
    expect(meta.bench?.lists.p1).toEqual(worlds[0].p1);
    expect([...(meta.bench?.lists.p2 ?? [])].sort()).toEqual(['Aerodactyl', 'Farigiraf', 'Kingambit', 'Sylveon']);
  });

  test('without statistics the worlds weigh equally and follow the preview order', async () => {
    await loadSimMods('gen9championsvgc2026regma');
    const meta = await loaded(championsShort());
    expect(meta.bringWorlds).toHaveLength(3);
    expect(meta.bringWorlds!.map(world => world.p1.at(-1))).toEqual(['Ceruledge', 'Ninetales-Alola', 'Kingambit']);
    for (const world of meta.bringWorlds!) expect(world.weight).toBeCloseTo(1 / 3, 12);
  });

  test('Battle Stadium Singles (singles): P1 short by one of three keeps the three heaviest of four guesses', async () => {
    usage.stats = statsOf([['Kingambit', 500], ['Dragonite', 300], ['Corviknight', 150], ['Glimmora', 50]]);
    const meta = await loaded(bssShort());
    const worlds = meta.bringWorlds!;
    expect(worlds.map(world => world.p1)).toEqual([
      ['Garchomp', 'Gholdengo', 'Kingambit'], ['Garchomp', 'Gholdengo', 'Dragonite'], ['Garchomp', 'Gholdengo', 'Corviknight'],
    ]);
    expect(worlds.every(world => world.p2.length === 3 && world.guessed.p2 === 0)).toBe(true);
    expect(meta.bringOnlyLists).toEqual({ p1: worlds[0].p1, p2: worlds[0].p2, guessed: { p1: 1, p2: 0 } });
    expect(meta.bench?.lists.p1).toEqual(['Garchomp', 'Gholdengo', 'Kingambit']);
  });

  test('a pinned game has no worlds and keeps the lists of the protocol alone', async () => {
    await loadSimMods('gen9championsvgc2026regma');
    usage.stats = statsOf([['Kingambit', 717_550]]);
    const meta = await loaded(championsPinned());
    expect(meta.bringWorlds).toBeNull();
    expect(meta.bringOnlyLists?.p1).toHaveLength(4);
    expect(meta.bringOnlyLists).not.toHaveProperty('guessed');
    expect(meta.bench?.lists).toEqual({ p1: meta.bringOnlyLists!.p1, p2: meta.bringOnlyLists!.p2 });
  });

  test('a bring-all game has no worlds and no lists', async () => {
    const meta = await loaded(doublesReplay());
    expect(meta.bringWorlds).toBeNull();
    expect(meta.bringOnlyLists).toBeNull();
    expect(meta.bench).toBeNull();
  });
});
