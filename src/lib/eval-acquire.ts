import type { PokemonSet } from '@pkmn/sim';
import {
  type DamageObservation, type HiddenPowerEvidence, type OpponentTeamInfo, type ReplayData, type TurnSnapshot,
  type SpreadCandidate, getBranchSimulatorFormat,
} from '@fulllifegames/replay-core';

type BranchEngineModule = typeof import('./branch-engine');
type ReconstructOptions = Parameters<BranchEngineModule['reconstructBranchRuntime']>[0];
export type CaptureBattle = Parameters<NonNullable<ReconstructOptions['capturePositions']>['onPosition']>[1];

type BuildOptions = NonNullable<Parameters<typeof import('./lazy/team-builder')['buildTeamsFromReplay']>[1]>;

/** Everything a replay team build needs, assembled once per render. */
export interface TeamBuildSources {
  teamText: string;
  effectiveP1Info: OpponentTeamInfo | null;
  effectiveP2Info: OpponentTeamInfo | null;
  usageStats: { stats: BuildOptions['usageStats'] };
  setAssumptions: { assumptions: BuildOptions['setAssumptions'] };
  hpEvidence: HiddenPowerEvidence[];
  getInferredSpreads: (
    p1InfoOverride?: OpponentTeamInfo | null,
    p2InfoOverride?: OpponentTeamInfo | null,
  ) => Promise<Map<string, SpreadCandidate> | undefined>;
}

export function snapshotAt(snapshots: TurnSnapshot[], turn: number): TurnSnapshot | null {
  return snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
}

/** One team build for every acquisition path (branch, sweep, preview,
 *  refresh) — the same options block used to be pasted at four sites. */
export async function buildReplayTeams(
  replayData: ReplayData,
  sources: TeamBuildSources,
  overrides?: { p1: OpponentTeamInfo | null; p2: OpponentTeamInfo | null },
): Promise<{ p1Team: PokemonSet[]; p2Team: PokemonSet[] }> {
  const { buildTeamsFromReplay } = await import('./lazy/team-builder');
  return buildTeamsFromReplay(replayData.log, {
    userTeamText: sources.teamText || undefined,
    p1Info: overrides ? overrides.p1 : sources.effectiveP1Info,
    p2Info: overrides ? overrides.p2 : sources.effectiveP2Info,
    usageStats: sources.usageStats.stats,
    setAssumptions: sources.setAssumptions.assumptions,
    inferredSpreads: await sources.getInferredSpreads(overrides?.p1, overrides?.p2),
    hpEvidence: sources.hpEvidence,
  });
}

/** Turn-0 team preview for the lead analysis, bring-trimmed (A.3c). */
export function makePreviewAcquire(
  replayData: ReplayData,
  sources: TeamBuildSources,
  bringOnlyLists: { p1: string[]; p2: string[] } | null,
) {
  return async (): Promise<string | null> => {
    const branchEngine = await import('./branch-engine');
    const { p1Team, p2Team } = await buildReplayTeams(replayData, sources);
    if (p1Team.length === 0 || p2Team.length === 0) return null;
    // Bring-limited replays: the lead analysis enumerates pairs over the
    // brought species, not the whole six. Per-side fail-open keeps an
    // unpinned side's full pool.
    return branchEngine.serializePreviewPosition(getBranchSimulatorFormat(replayData), p1Team, p2Team, bringOnlyLists);
  };
}

/** Reconstruct the main line to a turn with choice locks and per-boundary
 *  capture — the shared core of the single-turn and sweep acquisitions. */
export async function reconstructReplayRuntime(args: {
  replayData: ReplayData;
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
  targetTurn: number;
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  bringOnly?: { p1: string[]; p2: string[] };
  onProgress: (turn: number, target: number) => void;
  onPosition?: (turn: number, battle: CaptureBattle) => void;
}) {
  const branchEngine = await import('./branch-engine');
  const { buildChoiceLockContext } = await import('./choice-lock');
  const { replayData, p1Team, p2Team } = args;
  const runtime = await branchEngine.reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replayData),
    p1Team,
    p2Team,
    replayLog: replayData.log,
    targetTurn: args.targetTurn,
    snapshot: snapshotAt(args.snapshots, args.targetTurn),
    playerNames: [replayData.players[0], replayData.players[1]],
    onProgress: args.onProgress,
    choiceLocks: buildChoiceLockContext(replayData.log, { p1Team, p2Team }, args.observations),
    bringOnly: args.bringOnly,
    capturePositions: {
      snapshotFor: boundary => snapshotAt(args.snapshots, boundary),
      onPosition: args.onPosition ?? (() => {}),
    },
  });
  return { runtime, branchEngine };
}
