import type { PokemonSet } from '@pkmn/sim';
import {
  buildTeamsFromReplay, parseReplayLogWithObservations, replayBringList, replayBringOnly, type SmogonUsageStats,
} from '@fulllifegames/replay-core';
import { BRING_WORLD_CAP, blendValues, bringWorlds } from '@fulllifegames/eval-engine';
import { appTeamSeed, buildAppTeams } from '../../src/lib/app-team-build';
import { loadReplayMods } from '../../src/lib/replay-mods';
import { fetchSmogonSetAssumptions } from '../../src/lib/smogon-sets';
import { fetchSmogonUsageStats } from '../../src/lib/smogon-stats';

// The old raw build runs behind EVAL_CALIBRATION_RAWBUILD=1.

type Parsed = Pick<ReturnType<typeof parseReplayLogWithObservations>, 'observations' | 'speedOrders' | 'hpEvidence'>;
type Teams = { p1Team: PokemonSet[]; p2Team: PokemonSet[] };

export interface BankBuildArgs {
  log: string;
  formatId: string;
  parsed: Parsed;
  fetcher: typeof fetch | undefined;
}

export interface BankBuild {
  teams: Teams | null;
  /** The usage stats the build fetched, which weigh the worlds of a short-side game; null on the naked build. */
  usageStats: SmogonUsageStats | null;
  reason: 'could not build teams' | 'could not build teams with fills' | null;
}

const empty = (teams: Teams) => teams.p1Team.length === 0 || teams.p2Team.length === 0;

export async function bankTeamsFor(args: BankBuildArgs): Promise<BankBuild> {
  const { log, parsed, fetcher } = args;
  await loadReplayMods({ log, formatid: args.formatId });
  if (!fetcher) {
    const teams = buildTeamsFromReplay(log, { observations: parsed.observations, speedOrders: parsed.speedOrders });
    return empty(teams) ? { teams: null, usageStats: null, reason: 'could not build teams' } : { teams, usageStats: null, reason: null };
  }
  return process.env.EVAL_CALIBRATION_RAWBUILD === '1' ? rawBuild(args, fetcher) : appBuild(args, fetcher);
}

async function rawBuild(args: BankBuildArgs, fetcher: typeof fetch): Promise<BankBuild> {
  const { log, formatId, parsed } = args;
  const { observations, speedOrders } = parsed;
  const naked = buildTeamsFromReplay(log, { observations, speedOrders });
  if (empty(naked)) return { teams: null, usageStats: null, reason: 'could not build teams' };
  const species = [...new Set([...naked.p1Team, ...naked.p2Team].map(set => set.species))];
  const { usageStats, setAssumptions } = await smogonFor(formatId, species, fetcher);
  const teams = buildTeamsFromReplay(log, { observations, speedOrders, usageStats, setAssumptions });
  return empty(teams) ? { teams: null, usageStats, reason: 'could not build teams with fills' } : { teams, usageStats, reason: null };
}

async function appBuild(args: BankBuildArgs, fetcher: typeof fetch): Promise<BankBuild> {
  const { log, formatId, parsed } = args;
  const seed = appTeamSeed(log, parsed);
  if (seed.rawInfos.p1.pokemon.length === 0 || seed.rawInfos.p2.pokemon.length === 0) {
    return { teams: null, usageStats: null, reason: 'could not build teams' };
  }
  const { usageStats, setAssumptions } = await smogonFor(formatId, seed.species, fetcher);
  const { p1Team, p2Team } = buildAppTeams(log, seed, { usageStats, setAssumptions });
  const teams = { p1Team, p2Team };
  return empty(teams) ? { teams: null, usageStats, reason: 'could not build teams with fills' } : { teams, usageStats, reason: null };
}

async function smogonFor(formatId: string, species: string[], fetcher: typeof fetch) {
  return {
    usageStats: await fetchSmogonUsageStats(formatId, { fetcher }),
    setAssumptions: await fetchSmogonSetAssumptions({ formatId, species, fetcher }),
  };
}

export interface BankWorld {
  bringOnly: { p1: string[]; p2: string[]; guessed?: { p1: number; p2: number } } | undefined;
  weight: number;
}

/** The three heaviest worlds by usage weight, renormalized (equal weights on the naked build). */
export function bankWorldsFor(
  source: Parameters<typeof replayBringOnly>[0], snapshots: Parameters<typeof replayBringOnly>[1], usageStats: SmogonUsageStats | null,
): BankWorld[] {
  const worlds = bringWorlds(replayBringList(source, snapshots, usageStats), BRING_WORLD_CAP);
  if (!worlds || !worlds.some(world => world.guessed.p1 > 0 || world.guessed.p2 > 0)) {
    return [{ bringOnly: replayBringOnly(source, snapshots) ?? undefined, weight: 1 }];
  }
  return worlds.map(world => ({ bringOnly: { p1: world.p1, p2: world.p2, guessed: world.guessed }, weight: world.weight }));
}

export interface WorldReading {
  weight: number;
  score: number;
  gameValue: number | null;
  g?: number[];
}

/** A world that ended early or missed its boundary is not in `readings`: the weights renormalize over the rest. */
export function blendReadings(readings: WorldReading[]): Omit<WorldReading, 'weight'> {
  const weights = readings.map(reading => reading.weight);
  const gameValues = readings.map(reading => reading.gameValue);
  const features = readings.map(reading => reading.g);
  return {
    score: blendValues(readings.map(reading => reading.score), weights),
    gameValue: gameValues.every(value => value !== null) ? blendValues(gameValues as number[], weights) : null,
    ...(features.every(g => g !== undefined) ? { g: features[0]!.map((_, index) => blendValues(features.map(g => g![index]), weights)) } : {}),
  };
}
