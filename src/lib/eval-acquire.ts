import type { PokemonSet } from '@pkmn/sim';
import {
  type DamageObservation, type HiddenPowerEvidence, type OpponentTeamInfo, type ReplayData, type TurnSnapshot,
  type SpreadCandidate, getBranchSimulatorFormat,
} from '@fulllifegames/replay-core';
import { loadReplayMods } from './replay-mods';
import { replayBuildOptions } from './team-build-options';

import type { ReplacementPoint } from '@fulllifegames/eval-engine';

type BranchEngineModule = typeof import('./lazy/branch-engine');
type ReconstructOptions = Parameters<BranchEngineModule['reconstructBranchRuntime']>[0];
export type CaptureBattle = Parameters<NonNullable<ReconstructOptions['capturePositions']>['onPosition']>[1];

type BuildOptions = NonNullable<Parameters<typeof import('./lazy/team-builder')['buildTeamsFromReplay']>[1]>;

/** Teams a reported session built, pinned for its reproduction (round 77, src/hooks/usePinnedTeams.ts). */
export interface PinnedTeams {
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
}

/** Everything a replay team build needs, assembled once per render. */
export interface TeamBuildSources {
  /** Set: every build without an edit override returns these teams. */
  pinnedTeams?: PinnedTeams | null;
  teamText: string;
  effectiveP1Info: OpponentTeamInfo | null;
  effectiveP2Info: OpponentTeamInfo | null;
  usageStats: { stats: BuildOptions['usageStats'] };
  setAssumptions: { assumptions: BuildOptions['setAssumptions'] };
  hpEvidence: HiddenPowerEvidence[];
  getInferredSpreads: (
    p1InfoOverride?: OpponentTeamInfo | null,
    p2InfoOverride?: OpponentTeamInfo | null,
    opts?: TeamBuildOptions,
  ) => Promise<Map<string, SpreadCandidate> | undefined>;
}

export interface TeamBuildOptions {
  /** Use the solved spreads only when a matching solve already exists — never start one (the pickers). */
  cachedOnly?: boolean;
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
  opts?: TeamBuildOptions,
): Promise<{ p1Team: PokemonSet[]; p2Team: PokemonSet[] }> {
  // Round 77 (user gate 28.10.2026, 3a): a reproduction plays the reported sets; an edit made since still builds.
  if (sources.pinnedTeams && !overrides) return structuredClone(sources.pinnedTeams);
  // Round 75 (T160): the team build reads the Dex of the game; a Champions replay needs its mod registered first.
  await loadReplayMods(replayData);
  const { buildTeamsFromReplay } = await import('./lazy/team-builder');
  return buildTeamsFromReplay(replayData.log, replayBuildOptions({
    userTeamText: sources.teamText || undefined,
    p1Info: overrides ? overrides.p1 : sources.effectiveP1Info,
    p2Info: overrides ? overrides.p2 : sources.effectiveP2Info,
    usageStats: sources.usageStats.stats,
    setAssumptions: sources.setAssumptions.assumptions,
    hpEvidence: sources.hpEvidence,
  }, await sources.getInferredSpreads(overrides?.p1, overrides?.p2, opts)));
}

/** Turn-0 team preview for the lead analysis, bring-trimmed (A.3c). */
export function makePreviewAcquire(
  replayData: ReplayData,
  sources: TeamBuildSources,
  bringOnlyLists: { p1: string[]; p2: string[] } | null,
) {
  return async (): Promise<string | null> => {
    const branchEngine = await import('./lazy/branch-engine');
    const { p1Team, p2Team } = await buildReplayTeams(replayData, sources);
    if (p1Team.length === 0 || p2Team.length === 0) return null;
    // Bring-limited replays: the lead analysis enumerates pairs over the
    // brought species, not the whole six. Per-side fail-open keeps an
    // unpinned side's full pool. A Champions preview plays on the Champions
    // mod, loaded first (round 67, T145).
    const format = getBranchSimulatorFormat(replayData);
    await branchEngine.loadSimMods(format);
    return branchEngine.serializePreviewPosition(format, p1Team, p2Team, bringOnlyLists);
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
  /** Round 79 (T290): the open replacement requests of the knockouts (the main-thread twin of the worker's hand-out). */
  onReplacement?: (point: ReplacementPoint, battle: CaptureBattle) => void;
}) {
  const branchEngine = await import('./lazy/branch-engine');
  const { buildChoiceLockContext } = await import('./lazy/choice-lock');
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
      ...(args.onReplacement ? { onReplacement: args.onReplacement } : {}),
    },
  });
  return { runtime, branchEngine };
}
