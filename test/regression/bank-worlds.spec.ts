import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, replayBringOnly, type ReplayData, type SmogonUsageStats,
} from '@fulllifegames/replay-core';
import { loadSimMods, reconstructBranchRuntime, serializeLiveBattle } from '@fulllifegames/eval-engine';
import { bankSearch } from './bank-search';
import { bankWorldsFor, blendReadings, type WorldReading } from './bank-build';

/**
 * Round 89 (#124, stage 2): the bank reads a short-side game in every world and blends the readings, so one sample per sampled
 * turn carries the weighted score. A bring-all game and a game that pins both sides keep their one world and their rows
 * digit-identical. Doubles (Champions VGC 2625939941, Doubles OU style pinned VGC) and singles (the draft fixture, bring-all).
 */
const fixture = (path: string) => JSON.parse(readFileSync(path, 'utf-8')) as ReplayData;
const SHORT = 'packages/eval-engine/test/fixtures/gen9championsvgc2026regma-2625939941.json';

const entry = (species: string, rawCount: number) =>
  [species.toLowerCase().replace(/[^a-z0-9]/g, ''), { species, rawCount, abilities: [], items: [], moves: [], spreads: [] }] as const;
const stats: SmogonUsageStats = {
  format: 'test', month: '2026-10', source: 'test',
  pokemon: Object.fromEntries([entry('Kingambit', 717550), entry('Ninetales-Alola', 168774), entry('Ceruledge', 91889)]),
};

describe('bankWorldsFor', () => {
  test('a bring-all game (singles, the draft fixture) has one world of weight 1 and no list', () => {
    const replay = fixture('packages/eval-engine/test/fixtures/draft-replay.json');
    expect(bankWorldsFor(replay, parseReplayLog(replay.log), stats)).toEqual([{ bringOnly: undefined, weight: 1 }]);
  });

  test('a game that pins both sides (doubles, 4 of 6) keeps the list replayBringOnly gives, as one world', () => {
    const preview = ['A', 'B', 'C', 'D', 'E', 'F'];
    const enter = (side: string, names: string[]) => names.map((name, index) => `|switch|${side}${'ab'[index] ?? 'a'}: ${name}|${name}, L50|100/100`);
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9', '|tier|[Gen 9] VGC 2026 Regulation I',
      ...preview.map(name => `|poke|p1|${name}, L50|`), ...preview.map(name => `|poke|p2|${name}, L50|`), '|teampreview', '|start',
      ...enter('p1', ['A', 'B']), ...enter('p2', ['A', 'B']), '|turn|1',
      ...enter('p1', ['C']).map(line => line.replace('p1a', 'p1b')), ...enter('p2', ['C']).map(line => line.replace('p2a', 'p2b')), '|turn|2',
      '|switch|p1a: D|D, L50|100/100', '|switch|p2a: D|D, L50|100/100', '|turn|3',
    ].join('\n');
    const replay = { id: 'pinned', formatid: 'gen9vgc2026regi', log, players: ['Alice', 'Bob'] } as ReplayData;
    const snapshots = parseReplayLog(log);
    const pinned = replayBringOnly(replay, snapshots);
    expect(pinned).not.toBeNull();
    const worlds = bankWorldsFor(replay, snapshots, stats);
    expect(worlds).toHaveLength(1);
    expect(worlds[0].weight).toBe(1);
    expect(worlds[0].bringOnly).toEqual(pinned);
  });

  test('Champions VGC 2625939941 (P1 short): three worlds by usage weight, the heaviest first, each with its guess last', async () => {
    const replay = fixture(SHORT);
    await loadSimMods(getBranchSimulatorFormat(replay));
    const worlds = bankWorldsFor(replay, parseReplayLog(replay.log), stats);
    expect(worlds).toHaveLength(3);
    expect(worlds.map(world => world.bringOnly!.p1[3])).toEqual(['Kingambit', 'Ninetales-Alola', 'Ceruledge']);
    expect(worlds.every(world => world.bringOnly!.guessed!.p1 === 1 && world.bringOnly!.guessed!.p2 === 0)).toBe(true);
    expect(worlds.reduce((sum, world) => sum + world.weight, 0)).toBeCloseTo(1, 12);
    expect(worlds[0].weight).toBeGreaterThan(worlds[1].weight);
    // The naked build holds no stats: equal weights.
    const naked = bankWorldsFor(replay, parseReplayLog(replay.log), null);
    expect(naked.map(world => world.weight)).toEqual(Array(3).fill(expect.closeTo(1 / 3, 12)));
  });
});

describe('blendReadings', () => {
  const reading = (weight: number, score: number, gameValue: number | null, g?: number[]): WorldReading => ({ weight, score, gameValue, ...(g ? { g } : {}) });

  test('one reading comes back as it is, whatever its weight', () => {
    const only = blendReadings([reading(0.4, 0.1 + 0.2, -0.3, [0.5, 0.25])]);
    expect(only).toEqual({ score: 0.1 + 0.2, gameValue: -0.3, g: [0.5, 0.25] });
    expect(blendReadings([reading(1, 0.3, null)])).toEqual({ score: 0.3, gameValue: null });
  });

  test('the weighted mean of score, game value and features; a world without a game value leaves it null', () => {
    const blended = blendReadings([reading(0.75, 0.4, 0.2, [1, 0]), reading(0.25, -0.4, -0.6, [0, 1])]);
    expect(blended.score).toBeCloseTo(0.2, 12);
    expect(blended.gameValue).toBeCloseTo(0, 12);
    expect(blended.g).toEqual([expect.closeTo(0.75, 12), expect.closeTo(0.25, 12)]);
    expect(blendReadings([reading(0.5, 1, 1), reading(0.5, 0, null)]).gameValue).toBeNull();
  });

  test('a world that dropped out leaves its weight: the rest renormalizes', () => {
    const blended = blendReadings([reading(0.6, 1, null), reading(0.2, 0, null)]);
    expect(blended.score).toBeCloseTo(0.75, 12);
  });
});

describe('the bank\'s read of a short-side game', () => {
  test('Champions VGC 2625939941: each sampled turn gives one score, the weighted blend of the three worlds', async () => {
    const replay = fixture(SHORT);
    const format = getBranchSimulatorFormat(replay);
    await loadSimMods(format);
    const snapshots = parseReplayLog(replay.log);
    const teams = buildTeamsFromReplay(replay.log);
    const worlds = bankWorldsFor(replay, snapshots, stats);
    expect(worlds).toHaveLength(3);
    for (const turn of [2, 4]) {
      const readings: WorldReading[] = [];
      for (const world of worlds) {
        const runtime = await reconstructBranchRuntime({
          format, ...teams, replayLog: replay.log, targetTurn: turn, snapshot: snapshots[turn - 1], bringOnly: world.bringOnly, deadlineMs: 120_000,
        });
        const battle = runtime.battleStream.battle!;
        const found = await bankSearch({ serialized: serializeLiveBattle(battle), faintedFraction: 0, depth: 1, samples: 1, mode: 'matrix', settings: { tera: false } });
        readings.push({ weight: world.weight, score: found.score, gameValue: found.gameValue ?? null });
      }
      const blended = blendReadings(readings);
      expect(blended.score).toBeCloseTo(readings.reduce((sum, one) => sum + one.score * one.weight, 0), 9);
      expect(new Set(readings.map(one => one.score.toFixed(9))).size, `turn ${turn}: the worlds read differently`).toBeGreaterThan(1);
      expect(blended.score).not.toBe(readings[0].score);
    }
  }, 600_000);
});
