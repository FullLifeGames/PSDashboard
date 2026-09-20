import type { HiddenPowerEvidence, OpponentTeamInfo, SpeedOrderObservation, SpreadCandidate } from '@fulllifegames/replay-core';

/** Type-only: the team builder stays behind ./lazy/team-builder at runtime. */
type BuildOptions = NonNullable<Parameters<typeof import('./lazy/team-builder')['buildTeamsFromReplay']>[1]>;
type SolveOptions = NonNullable<Parameters<typeof import('./lazy/team-builder')['solveReplaySpreads']>[2]>;

/** The team knowledge a replay build reads, however the caller assembled it. */
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

/**
 * Names every option the builder knows, so a new one fails the type check
 * here until both blocks below have decided about it. The builder reads
 * several options by presence (`observations?.length`, `inferredSpreads`),
 * so a key a block leaves undefined is dropped instead of passed along.
 */
function passed<T>(block: Record<keyof T, unknown>): T {
  return Object.fromEntries(Object.entries(block).filter(([, value]) => value !== undefined)) as T;
}

/** The spread solve's options: the worker's job and the bank's build share them. */
export function replaySolveOptions(sources: Omit<ReplayBuildSources, 'hpEvidence'>): SolveOptions {
  return passed<SolveOptions>({
    userTeamText: sources.userTeamText,
    p1Info: sources.p1Info,
    p2Info: sources.p2Info,
    usageStats: sources.usageStats,
    setAssumptions: sources.setAssumptions,
    speedOrders: sources.speedOrders,
    // The worker's solve job carries no HP evidence; only the build reads it.
    hpEvidence: undefined,
  });
}

/** The build's options, once the solve has answered. */
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
    // The solved spreads replace the raw evidence: the builder must not
    // solve a second time from observations and speed orders.
    observations: undefined,
    speedOrders: undefined,
  });
}
