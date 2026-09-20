import { describe, expect, test, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PokemonSet } from '@pkmn/sim';
import {
  inferOpponentTeam, parseReplayLogWithObservations, type ReplayData, type SpreadCandidate,
} from '@fulllifegames/replay-core';
import { useTeamKnowledge, type TeamKnowledgeInputs } from '../../src/hooks/useTeamKnowledge';
import { appTeamSeed, buildAppTeams } from '../../src/lib/app-team-build';
import { buildReplayTeams, type TeamBuildSources } from '../../src/lib/eval-acquire';
import { fetchSmogonSetAssumptions } from '../../src/lib/smogon-sets';
import { fetchSmogonUsageStats } from '../../src/lib/smogon-stats';
import { realReplayWorkerClient } from '../fixtures/worker';

/**
 * The drift pin for round 52: the bank grades through `buildAppTeams`, so
 * the app's own chain — the enrich memos of useTeamKnowledge, the real
 * spread solve in the replay worker, `buildReplayTeams` — must keep landing
 * on the same sets. Change the chain without changing `buildAppTeams` and
 * this test turns red before the bank measures a team nobody sees. The two
 * option blocks are shared code (src/lib/team-build-options.ts): a change
 * there moves both sides at once and stays invisible here.
 */

/** Every Smogon URL the chain asks for, and whether the harness pins it. */
const unpinned: string[] = [];
const pinnedFetcher = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const path = url.replace(/^https:\/\/(data\.pkmn\.cc|pkmn\.github\.io\/smogon\/data)/, '').replace(/\/{2,}/g, '/');
  const key = join('e2e-feedback', 'fixtures', 'smogon', path.replace(/[^a-z0-9.]+/gi, '_'));
  if (!existsSync(`${key}.json`) && !existsSync(`${key}.404`)) unpinned.push(path);
  if (!existsSync(`${key}.json`)) {
    return { ok: false, status: 404, json: async () => { throw new Error('404'); } } as unknown as Response;
  }
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(`${key}.json`, 'utf-8')) } as unknown as Response;
}) as typeof fetch;

type Teams = { p1Team: PokemonSet[]; p2Team: PokemonSet[] };

const evs = (set: PokemonSet) => `${set.evs.hp}/${set.evs.atk}/${set.evs.def}/${set.evs.spa}/${set.evs.spd}/${set.evs.spe}`;
const rows = (teams: Teams) =>
  (['p1', 'p2'] as const).flatMap(side => teams[`${side}Team`].map(set =>
    `${side}:${set.species}|${set.item}|${set.ability}|${set.nature}|${evs(set)}|${[...set.moves].sort().join(',')}`));
const serialized = (spreads: Map<string, SpreadCandidate>) =>
  [...spreads.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, candidate]) => `${key} ${JSON.stringify(candidate)}`);

describe('the app chain and buildAppTeams', () => {
  // A gen6 singles game with hidden-power evidence and a known item flip, and a gen9 doubles game.
  test.each([
    'smogtours-gen6ou-648453',
    'smogtours-gen9doublesou-912045',
  ])('the hooks, the worker solve, and buildReplayTeams land on the app build of %s', async id => {
    const replayData = JSON.parse(readFileSync(join('e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as ReplayData;
    const parsed = parseReplayLogWithObservations(replayData.log);
    const seed = appTeamSeed(replayData.log, parsed);
    const usageStats = await fetchSmogonUsageStats(replayData.formatid, { fetcher: pinnedFetcher });
    const setAssumptions = await fetchSmogonSetAssumptions({
      formatId: replayData.formatid, species: seed.species, fetcher: pinnedFetcher,
    });
    expect(usageStats).toBeTruthy();
    expect(setAssumptions).toBeTruthy();
    expect(unpinned).toEqual([]);

    const { client } = realReplayWorkerClient();
    const inputs: TeamKnowledgeInputs = {
      replayData,
      p1Info: inferOpponentTeam(replayData.log, 'p1'),
      opponentInfo: inferOpponentTeam(replayData.log, 'p2'),
      observations: parsed.observations,
      speedOrders: parsed.speedOrders,
      hpEvidence: parsed.hpEvidence,
      usageStats: { stats: usageStats, loading: false, error: null },
      setAssumptions: { assumptions: setAssumptions, loading: false, error: null },
      onTeamsEdited: vi.fn(),
      replayWorker: client,
    };
    const { result } = renderHook(() => useTeamKnowledge(inputs));

    // The hidden-power module arrives lazily; the enrich memos re-form with
    // the resolver, and only that settled state is what the sweep builds on.
    const beforeResolver = result.current.effectiveP1Info;
    await waitFor(() => expect(result.current.effectiveP1Info).not.toBe(beforeResolver), { timeout: 60_000 });

    const app = buildAppTeams(replayData.log, seed, { usageStats, setAssumptions });
    expect(result.current.effectiveP1Info).not.toEqual(inputs.p1Info);
    expect(result.current.effectiveP1Info).toEqual(app.p1Info);
    expect(result.current.effectiveP2Info).toEqual(app.p2Info);

    const sources: TeamBuildSources = {
      teamText: result.current.teamText,
      effectiveP1Info: result.current.effectiveP1Info,
      effectiveP2Info: result.current.effectiveP2Info,
      usageStats: inputs.usageStats,
      setAssumptions: inputs.setAssumptions,
      hpEvidence: parsed.hpEvidence,
      getInferredSpreads: result.current.getInferredSpreads,
    };

    let teams: Teams | null = null;
    await act(async () => { teams = await buildReplayTeams(replayData, sources); });
    await waitFor(() => expect(result.current.solvedSpreads).not.toBeNull(), { timeout: 60_000 });
    expect(serialized(result.current.solvedSpreads!)).toEqual(serialized(app.inferredSpreads));
    expect(rows(teams!)).toEqual(rows(app));
  }, 180_000);
});
