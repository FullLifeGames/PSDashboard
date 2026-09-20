import type { PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay, parseReplayLogWithObservations } from '@fulllifegames/replay-core';
import { appTeamSeed, buildAppTeams } from '../src/lib/app-team-build';
import { fetchSmogonSetAssumptions } from '../src/lib/smogon-sets';
import { fetchSmogonUsageStats } from '../src/lib/smogon-stats';

/**
 * The calibration bank's team build, in one place: without the Smogon
 * fills the naked build of the standing records, with them the app's chain
 * (round 52) or, behind EVAL_CALIBRATION_RAWBUILD=1, the two naked builds
 * every number before that round stands on.
 */

type Parsed = Pick<ReturnType<typeof parseReplayLogWithObservations>, 'observations' | 'speedOrders' | 'hpEvidence'>;
type Teams = { p1Team: PokemonSet[]; p2Team: PokemonSet[] };

export interface BankBuildArgs {
  log: string;
  /** `replay.formatid ?? id`, the key the bank's Smogon calls have always used. */
  formatId: string;
  parsed: Parsed;
  fetcher: typeof fetch | undefined;
}

/** The teams, or the reason the loop logs and skips the replay for. */
export interface BankBuild {
  teams: Teams | null;
  reason: 'could not build teams' | 'could not build teams with fills' | null;
}

const empty = (teams: Teams) => teams.p1Team.length === 0 || teams.p2Team.length === 0;

export async function bankTeamsFor(args: BankBuildArgs): Promise<BankBuild> {
  const { log, parsed, fetcher } = args;
  if (!fetcher) {
    const teams = buildTeamsFromReplay(log, { observations: parsed.observations, speedOrders: parsed.speedOrders });
    return empty(teams) ? { teams: null, reason: 'could not build teams' } : { teams, reason: null };
  }
  return process.env.EVAL_CALIBRATION_RAWBUILD === '1' ? rawBuild(args, fetcher) : appBuild(args, fetcher);
}

/** The build every record before round 52 stands on: raw infos, one solve, a rebuild with the fills. */
async function rawBuild(args: BankBuildArgs, fetcher: typeof fetch): Promise<BankBuild> {
  const { log, formatId, parsed } = args;
  const { observations, speedOrders } = parsed;
  const naked = buildTeamsFromReplay(log, { observations, speedOrders });
  if (empty(naked)) return { teams: null, reason: 'could not build teams' };
  // Mirroring the app hooks: usage stats by the replay's format id, set
  // assumptions for the known species.
  const species = [...new Set([...naked.p1Team, ...naked.p2Team].map(set => set.species))];
  const { usageStats, setAssumptions } = await smogonFor(formatId, species, fetcher);
  const teams = buildTeamsFromReplay(log, { observations, speedOrders, usageStats, setAssumptions });
  return empty(teams) ? { teams: null, reason: 'could not build teams with fills' } : { teams, reason: null };
}

/** The app's chain: enriched infos, the two-stage solve, the HP evidence. */
async function appBuild(args: BankBuildArgs, fetcher: typeof fetch): Promise<BankBuild> {
  const { log, formatId, parsed } = args;
  const seed = appTeamSeed(log, parsed);
  // The builds map 1:1 over the infos, so an empty side here is exactly the
  // empty team the naked build used to skip on.
  if (seed.rawInfos.p1.pokemon.length === 0 || seed.rawInfos.p2.pokemon.length === 0) {
    return { teams: null, reason: 'could not build teams' };
  }
  const { usageStats, setAssumptions } = await smogonFor(formatId, seed.species, fetcher);
  const { p1Team, p2Team } = buildAppTeams(log, seed, { usageStats, setAssumptions });
  const teams = { p1Team, p2Team };
  return empty(teams) ? { teams: null, reason: 'could not build teams with fills' } : { teams, reason: null };
}

async function smogonFor(formatId: string, species: string[], fetcher: typeof fetch) {
  return {
    usageStats: await fetchSmogonUsageStats(formatId, { fetcher }),
    setAssumptions: await fetchSmogonSetAssumptions({ formatId, species, fetcher }),
  };
}
