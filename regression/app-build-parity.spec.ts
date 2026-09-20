import { test, expect, describe } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PokemonSet } from '@pkmn/sim';
import {
  enrichTeamInfo, parseReplayLogWithObservations, resolveHiddenPowerType,
  type OpponentTeamInfo, type ReplayData, type SpreadCandidate,
} from '@fulllifegames/replay-core';
import { appTeamSeed, buildAppTeams } from '../src/lib/app-team-build';
import { buildReplayTeams, type TeamBuildSources } from '../src/lib/eval-acquire';
import { handleReplayJob } from '../src/lib/replay-jobs/handlers';
import type { SolveSpreadsJob } from '../src/lib/replay-jobs/types';
import { fetchSmogonSetAssumptions } from '../src/lib/smogon-sets';
import { fetchSmogonUsageStats } from '../src/lib/smogon-stats';
import { bankTeamsFor } from './bank-build';

/**
 * The bank grades the teams the app ships (round 52, T56). Offline on the
 * harness fixtures: the bank's helper, the app's own entry points
 * (`handleReplayJob` for the solve, `buildReplayTeams` for the build) and
 * `buildAppTeams` must agree set for set, and the retired build behind
 * EVAL_CALIBRATION_RAWBUILD=1 must differ in exactly the known rows.
 */

const SINGLES = 'smogtours-gen6ou-648453';
const DOUBLES = 'smogtours-gen9doublesou-912045';

/** Every Smogon URL a build asks for, and whether the harness pins it. */
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

type Fixture = ReplayData & { formatid: string };
type Teams = { p1Team: PokemonSet[]; p2Team: PokemonSet[] };

const fixture = (id: string) =>
  JSON.parse(readFileSync(join('e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as Fixture;

/** The seed and the Smogon answers the app waits for before it evaluates. */
async function knowledgeFor(replay: Fixture) {
  const parsed = parseReplayLogWithObservations(replay.log);
  const seed = appTeamSeed(replay.log, parsed);
  const usageStats = await fetchSmogonUsageStats(replay.formatid, { fetcher: pinnedFetcher });
  const setAssumptions = await fetchSmogonSetAssumptions({
    formatId: replay.formatid, species: seed.species, fetcher: pinnedFetcher,
  });
  return { parsed, seed, usageStats, setAssumptions };
}

const evs = (set: PokemonSet) => `${set.evs.hp}/${set.evs.atk}/${set.evs.def}/${set.evs.spa}/${set.evs.spd}/${set.evs.spe}`;
const line = (set: PokemonSet) =>
  `${set.species}|${set.item}|${set.ability}|${set.nature}|${evs(set)}|${[...set.moves].sort().join(',')}`;
const rows = (teams: Teams) => [
  ...teams.p1Team.map(set => `p1:${line(set)}`), ...teams.p2Team.map(set => `p2:${line(set)}`),
];
const nameOf = (row: string) => row.split('|')[0];

/** The `side:species` rows on which two builds disagree. */
function moved(left: string[], right: string[]): string[] {
  const a = new Map(left.map(row => [nameOf(row), row]));
  const b = new Map(right.map(row => [nameOf(row), row]));
  return [...new Set([...a.keys(), ...b.keys()])].filter(name => a.get(name) !== b.get(name)).sort();
}

/** Solved spreads as comparable rows, in key order. */
const serialized = (spreads: Map<string, SpreadCandidate>) =>
  [...spreads.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, candidate]) => `${key} ${JSON.stringify(candidate)}`);

const itemOf = (teams: Teams, side: 'p1' | 'p2', species: string) =>
  (side === 'p1' ? teams.p1Team : teams.p2Team).find(set => set.species === species)?.item;

/** The bank's helper under the retired build, with the switch restored. */
async function withRawBuild<T>(run: () => Promise<T>): Promise<T> {
  const before = process.env.EVAL_CALIBRATION_RAWBUILD;
  process.env.EVAL_CALIBRATION_RAWBUILD = '1';
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env.EVAL_CALIBRATION_RAWBUILD;
    else process.env.EVAL_CALIBRATION_RAWBUILD = before;
  }
}

const bankTeams = async (replay: Fixture, parsed: ReturnType<typeof parseReplayLogWithObservations>) => {
  const built = await bankTeamsFor({ log: replay.log, formatId: replay.formatid, parsed, fetcher: pinnedFetcher });
  expect(built.reason).toBeNull();
  return built.teams!;
};

describe('the bank builds the teams the app ships', () => {
  test('the bank helper and buildAppTeams agree on every set of 648453', async () => {
    const replay = fixture(SINGLES);
    const { parsed, seed, usageStats, setAssumptions } = await knowledgeFor(replay);
    const app = buildAppTeams(replay.log, seed, { usageStats, setAssumptions });
    expect(moved(rows(await bankTeams(replay, parsed)), rows(app))).toEqual([]);
    expect(unpinned).toEqual([]);
  }, 120_000);

  test('the retired build differs in the four known rows of 648453', async () => {
    const replay = fixture(SINGLES);
    const { parsed, seed, usageStats, setAssumptions } = await knowledgeFor(replay);
    const app = buildAppTeams(replay.log, seed, { usageStats, setAssumptions });
    const old = await withRawBuild(() => bankTeams(replay, parsed));
    expect(moved(rows(old), rows(app)))
      .toEqual(['p1:Tornadus-Therian', 'p1:Volcanion', 'p2:Landorus-Therian', 'p2:Tornadus-Therian']);
    // The scene the round is named after: the old build explains the move
    // order with speed EVs and leaves Volcanion its scarf.
    expect(itemOf(old, 'p2', 'Landorus-Therian')).toBe('Rocky Helmet');
    expect(itemOf(app, 'p2', 'Landorus-Therian')).toBe('Choice Scarf');
    expect(itemOf(old, 'p1', 'Volcanion')).toBe('Choice Scarf');
    expect(itemOf(app, 'p1', 'Volcanion')).not.toBe('Choice Scarf');
    expect(unpinned).toEqual([]);
  }, 120_000);

  test.each([SINGLES, DOUBLES])('buildAppTeams matches the app entry points on %s', async id => {
    const replay = fixture(id);
    const { seed, usageStats, setAssumptions } = await knowledgeFor(replay);
    // The enrich memos of useTeamKnowledge, settled: the lazy hidden-power
    // resolver has landed and the Smogon data is in.
    const enriched = (side: 'p1' | 'p2'): OpponentTeamInfo =>
      enrichTeamInfo(seed.rawInfos[side], usageStats, setAssumptions, species => resolveHiddenPowerType(
        seed.hpEvidence.filter(entry => entry.attackerSide === side), usageStats, species, seed.gen));
    const effectiveP1Info = enriched('p1');
    const effectiveP2Info = enriched('p2');
    const solved = await solveInWorker({
      log: replay.log, observations: seed.observations, speedOrders: seed.speedOrders,
      p1Info: effectiveP1Info, p2Info: effectiveP2Info, usageStats, setAssumptions,
    });
    const sources: TeamBuildSources = {
      teamText: '', effectiveP1Info, effectiveP2Info,
      usageStats: { stats: usageStats }, setAssumptions: { assumptions: setAssumptions },
      hpEvidence: seed.hpEvidence, getInferredSpreads: async () => solved,
    };

    const app = buildAppTeams(replay.log, seed, { usageStats, setAssumptions });
    expect(serialized(solved)).toEqual(serialized(app.inferredSpreads));
    expect(rows(await buildReplayTeams(replay, sources))).toEqual(rows(app));
  }, 120_000);

  test('the doubles fixture builds the same sets on all three paths', async () => {
    const replay = fixture(DOUBLES);
    const { parsed, seed, usageStats, setAssumptions } = await knowledgeFor(replay);
    const app = buildAppTeams(replay.log, seed, { usageStats, setAssumptions });
    expect(moved(rows(await bankTeams(replay, parsed)), rows(app))).toEqual([]);
    expect(moved(rows(await withRawBuild(() => bankTeams(replay, parsed))), rows(app))).toEqual([]);
    expect(unpinned).toEqual([]);
  }, 120_000);
});

/** The solve as the app runs it: the worker's job handler, on this thread. */
async function solveInWorker(job: SolveSpreadsJob): Promise<Map<string, SpreadCandidate>> {
  let entries: [string, SpreadCandidate][] | null = null;
  let failure: string | null = null;
  await handleReplayJob({ type: 'solveSpreads', id: 1, job }, message => {
    if (message.type === 'solveSpreadsResult') entries = message.entries;
    if (message.type === 'replayError') failure = message.message;
  });
  if (failure) throw new Error(failure);
  return new Map(entries ?? []);
}
