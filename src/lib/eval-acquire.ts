import type { PokemonSet } from '@pkmn/sim';
import {
  type DamageObservation, type HiddenPowerEvidence, type OpponentTeamInfo, type ReplayData, type TurnSnapshot,
  type SpreadCandidate, getBranchSimulatorFormat,
} from '@fulllifegames/replay-core';
import { loadReplayMods } from './replay-mods';
import { replayBuildOptions } from './team-build-options';

import type { BringWorld, ReplacementPoint } from '@fulllifegames/eval-engine';
import { registerWorldPositions } from './eval/world-positions';

type BranchEngineModule = typeof import('./lazy/branch-engine');
type ReconstructOptions = Parameters<BranchEngineModule['reconstructBranchRuntime']>[0];
export type CaptureBattle = Parameters<NonNullable<ReconstructOptions['capturePositions']>['onPosition']>[1];

type BuildOptions = NonNullable<Parameters<typeof import('./lazy/team-builder')['buildTeamsFromReplay']>[1]>;

export interface PinnedTeams {
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
}

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
  /** Use the solved spreads only when a matching solve already exists, never start one (the pickers). */
  cachedOnly?: boolean;
}

export function snapshotAt(snapshots: TurnSnapshot[], turn: number): TurnSnapshot | null {
  return snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
}

export async function buildReplayTeams(
  replayData: ReplayData,
  sources: TeamBuildSources,
  overrides?: { p1: OpponentTeamInfo | null; p2: OpponentTeamInfo | null },
  opts?: TeamBuildOptions,
): Promise<{ p1Team: PokemonSet[]; p2Team: PokemonSet[] }> {
  if (sources.pinnedTeams && !overrides) return structuredClone(sources.pinnedTeams);
  // The team build reads the Dex of the game; a Champions replay needs its mod registered first.
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

/** Turn-0 team preview, bring-trimmed; a game with worlds previews each world under the heaviest one's position. */
export function makePreviewAcquire(
  replayData: ReplayData,
  sources: TeamBuildSources,
  bringOnlyLists: { p1: string[]; p2: string[]; guessed?: { p1: number; p2: number } } | null,
  worlds: readonly BringWorld[] | null = null,
) {
  return async (): Promise<string | null> => {
    const branchEngine = await import('./lazy/branch-engine');
    const { p1Team, p2Team } = await buildReplayTeams(replayData, sources);
    if (p1Team.length === 0 || p2Team.length === 0) return null;
    // Both sides trim or neither: the lead analysis enumerates pairs over the brought species.
    const format = getBranchSimulatorFormat(replayData);
    await branchEngine.loadSimMods(format);
    const primary = branchEngine.serializePreviewPosition(format, p1Team, p2Team, bringOnlyLists);
    if (primary !== null && worlds && worlds.length > 1) {
      const previews = worlds.slice(1).flatMap(world => {
        const position = branchEngine.serializePreviewPosition(format, p1Team, p2Team, { p1: world.p1, p2: world.p2, guessed: world.guessed });
        return position === null ? [] : [{ position, weight: world.weight }];
      });
      registerWorldPositions([{ position: primary, weight: worlds[0].weight }, ...previews]);
    }
    return primary;
  };
}

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
