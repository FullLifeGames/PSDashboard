import { beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { BRING_WORLD_CAP, bringWorlds, deserializeBattleExact, loadSimMods } from '@fulllifegames/eval-engine';
import { getBranchSimulatorFormat, parseReplayLog, replayBringList, speciesBaseId, replayRules, type ReplayData } from '@fulllifegames/replay-core';
import { makePreviewAcquire, type TeamBuildSources } from '../../../src/lib/eval-acquire';
import { clearWorldPositions, worldPositionsOf } from '../../../src/lib/eval/world-positions';

/**
 * Round 89 (#124): the lead analysis of turn 0 evaluates the team preview. A short-side game previews every world of its unknown
 * bodies and registers them under the heaviest world's position, so the worker client searches each and blends. Doubles (Champions
 * VGC, four of six) and singles (Battle Stadium Singles, three of six) take the same path; a game with no short side registers nothing.
 */
const sources = {
  teamText: '', effectiveP1Info: null, effectiveP2Info: null, usageStats: { stats: null }, setAssumptions: { assumptions: null },
  hpEvidence: [], getInferredSpreads: async () => undefined,
} as unknown as TeamBuildSources;

const championsShort = () => JSON.parse(readFileSync('test/e2e/fixtures/dock-championsvgc-2625939941.json', 'utf-8')) as ReplayData;
const BSS_MONS = ['Garchomp', 'Gholdengo', 'Kingambit', 'Dragonite', 'Corviknight', 'Glimmora'];
const bssShort = (): ReplayData => ({
  id: 'synthetic-bss', formatid: 'gen9battlestadiumsinglesregh', format: '[Gen 9] Battle Stadium Singles Regulation H',
  players: ['Alice', 'Bob'], uploadtime: 0, views: 0,
  log: [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|singles', '|gen|9', '|tier|[Gen 9] Battle Stadium Singles Regulation H',
    ...BSS_MONS.map(mon => `|poke|p1|${mon}, L50|`), ...BSS_MONS.map(mon => `|poke|p2|${mon}, L50|`), '|teampreview|3', '|start',
    '|switch|p1a: Garchomp|Garchomp, L50|100/100', '|switch|p2a: Kingambit|Kingambit, L50|100/100', '|turn|1',
    '|switch|p1a: Gholdengo|Gholdengo, L50|100/100', '|switch|p2a: Dragonite|Dragonite, L50|100/100', '|turn|2',
    '|switch|p2a: Corviknight|Corviknight, L50|100/100', '|turn|3', '|win|Alice',
  ].join('\n'),
} as unknown as ReplayData);

const partyOf = (serialized: string, side: 0 | 1, rules: ReturnType<typeof replayRules>) =>
  deserializeBattleExact(serialized).sides[side].pokemon.map(body => speciesBaseId(body.baseSpecies.name, rules));

beforeEach(() => clearWorldPositions());

describe('the preview position of a short-side game', () => {
  test.each([
    ['Champions VGC (doubles)', championsShort, 4],
    ['Battle Stadium Singles (singles)', bssShort, 3],
  ])('%s: every world is previewed with its guess last and registered under the heaviest world', async (_, make, count) => {
    const replay = make();
    await loadSimMods(getBranchSimulatorFormat(replay));
    const rules = replayRules(replay);
    const worlds = bringWorlds(replayBringList(replay, parseReplayLog(replay.log)), BRING_WORLD_CAP)!;
    expect(worlds.length).toBeGreaterThan(1);
    const primary = await makePreviewAcquire(replay, sources, { p1: worlds[0].p1, p2: worlds[0].p2, guessed: worlds[0].guessed }, worlds)();
    expect(primary).not.toBeNull();
    const registered = worldPositionsOf(primary!)!;
    expect(registered).toHaveLength(worlds.length);
    expect(registered[0].position).toBe(primary);
    expect(registered.map(entry => entry.weight)).toEqual(worlds.map(world => world.weight));
    registered.forEach((entry, index) => {
      const party = partyOf(entry.position, 0, rules);
      expect(party, `world ${index} p1`).toHaveLength(count);
      expect(party.at(-1)).toBe(speciesBaseId(worlds[index].p1.at(-1)!, rules));
      expect(partyOf(entry.position, 1, rules), `world ${index} p2`).toHaveLength(count);
    });
    expect(new Set(registered.map(entry => entry.position)).size).toBe(worlds.length);
  }, 120_000);

  test('a game with no worlds previews once and registers nothing', async () => {
    const replay = championsShort();
    const primary = await makePreviewAcquire(replay, sources, null, null)();
    expect(primary).not.toBeNull();
    expect(worldPositionsOf(primary!)).toBeNull();
  }, 60_000);
});
