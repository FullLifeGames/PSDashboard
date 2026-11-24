import type { HiddenPowerEvidence, OpponentTeamInfo, SpeedOrderObservation, SpreadCandidate } from '@fulllifegames/replay-core';

// Type-only: the team builder stays behind ./lazy/team-builder at runtime.
type BuildOptions = NonNullable<Parameters<typeof import('./lazy/team-builder')['buildTeamsFromReplay']>[1]>;
type SolveOptions = NonNullable<Parameters<typeof import('./lazy/team-builder')['solveReplaySpreads']>[2]>;

export interface ReplayBuildSources {
  /** Already normalized: an empty paste is `undefined`, never `''`. */
  userTeamText?: string;
  p1Info: OpponentTeamInfo | null;
  p2Info: OpponentTeamInfo | null;
  usageStats: BuildOptions['usageStats'];
  setAssumptions: BuildOptions['setAssumptions'];
  speedOrders: SpeedOrderObservation[];
  hpEvidence: HiddenPowerEvidence[];
}

// Names every option, so a new one fails the type check here; the builder reads some by presence: undefined drops it.
function passed<T>(block: Record<keyof T, unknown>): T {
  return Object.fromEntries(Object.entries(block).filter(([, value]) => value !== undefined)) as T;
}

export function replaySolveOptions(sources: Omit<ReplayBuildSources, 'hpEvidence'>): SolveOptions {
  return passed<SolveOptions>({
    userTeamText: sources.userTeamText,
    p1Info: sources.p1Info,
    p2Info: sources.p2Info,
    usageStats: sources.usageStats,
    setAssumptions: sources.setAssumptions,
    speedOrders: sources.speedOrders,
    hpEvidence: undefined,
    // The app's infos arrive filled (withStandIns, buildAppTeams); only a Node caller hands the file in.
    randomSets: undefined,
  });
}

export function replayBuildOptions(
  sources: Omit<ReplayBuildSources, 'speedOrders'>,
  inferredSpreads: Map<string, SpreadCandidate> | undefined,
): BuildOptions {
  return passed<BuildOptions>({
    userTeamText: sources.userTeamText,
    p1Info: sources.p1Info,
    p2Info: sources.p2Info,
    usageStats: sources.usageStats,
    setAssumptions: sources.setAssumptions,
    inferredSpreads,
    hpEvidence: sources.hpEvidence,
    // The solved spreads replace the raw evidence: the builder must not solve a second time.
    observations: undefined,
    speedOrders: undefined,
    randomSets: undefined,
  });
}
