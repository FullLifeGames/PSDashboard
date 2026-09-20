import type { PokemonSet } from '@pkmn/sim';
import {
  buildTeamsFromReplay, enrichTeamInfo, inferOpponentTeam, parseReplayLogWithObservations, resolveHiddenPowerType,
  solveReplaySpreads,
  type DamageObservation, type HiddenPowerEvidence, type OpponentTeamInfo, type SmogonSetAssumptions,
  type SmogonUsageStats, type SpeedOrderObservation, type SpreadCandidate,
} from '@fulllifegames/replay-core';
import { replayBuildOptions, replaySolveOptions } from './team-build-options';

/** Everything the app reads out of a replay log before any Smogon data arrives. */
export interface AppTeamSeed {
  observations: DamageObservation[];
  speedOrders: SpeedOrderObservation[];
  hpEvidence: HiddenPowerEvidence[];
  gen: number;
  /** The inferred infos the enrich memos start from. */
  rawInfos: { p1: OpponentTeamInfo; p2: OpponentTeamInfo };
  /** The species the set assumptions are fetched for (the app's `revealedSpecies`). */
  species: string[];
}

/** The log-only half of the app's team chain; `parsed` skips a second parse. */
export function appTeamSeed(
  log: string,
  parsed?: Pick<ReturnType<typeof parseReplayLogWithObservations>, 'observations' | 'speedOrders' | 'hpEvidence'>,
): AppTeamSeed {
  const { observations, speedOrders, hpEvidence } = parsed ?? parseReplayLogWithObservations(log);
  const rawInfos = { p1: inferOpponentTeam(log, 'p1'), p2: inferOpponentTeam(log, 'p2') };
  return {
    observations,
    speedOrders,
    hpEvidence,
    gen: parseInt(log.match(/^\|gen\|(\d)/m)?.[1] ?? '9', 10),
    rawInfos,
    species: [...new Set([...rawInfos.p1.pokemon, ...rawInfos.p2.pokemon].map(mon => mon.species))],
  };
}

export interface AppTeams {
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
  p1Info: OpponentTeamInfo;
  p2Info: OpponentTeamInfo;
  inferredSpreads: Map<string, SpreadCandidate>;
}

/**
 * The app's team build as one function: enriched infos with the
 * hidden-power resolver, the two-stage spread solve, then the build with
 * the solved spreads and the HP evidence. It models the settled state the
 * sweep waits for — the lazy resolver has landed and the Smogon data is in —
 * of a replay nobody edited: no pasted team, no edited or stored sets.
 */
export function buildAppTeams(log: string, seed: AppTeamSeed, knowledge: {
  usageStats: SmogonUsageStats | null;
  setAssumptions: SmogonSetAssumptions | null;
}): AppTeams {
  const { usageStats, setAssumptions } = knowledge;
  const enrich = (side: 'p1' | 'p2') => enrichTeamInfo(seed.rawInfos[side], usageStats, setAssumptions,
    species => resolveHiddenPowerType(
      seed.hpEvidence.filter(entry => entry.attackerSide === side), usageStats, species, seed.gen));
  const shared = { p1Info: enrich('p1'), p2Info: enrich('p2'), usageStats, setAssumptions };
  const inferredSpreads = solveReplaySpreads(log, seed.observations,
    replaySolveOptions({ ...shared, speedOrders: seed.speedOrders }));
  const teams = buildTeamsFromReplay(log, replayBuildOptions({ ...shared, hpEvidence: seed.hpEvidence }, inferredSpreads));
  return { ...teams, p1Info: shared.p1Info, p2Info: shared.p2Info, inferredSpreads };
}
