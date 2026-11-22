import { useCallback } from 'react';
import type { PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import type { ChoiceLockContext, BranchRuntime, BranchSlotChoice, ReconstructParams } from '@fulllifegames/eval-engine';
import { turnEntryCount } from '../../lib/variation-turns';
import { replayHistoryEntry, leadHistoryEntry } from './replay-entry';
import type { BranchEngineModule, BranchHistoryEntry, BranchRefs, BranchSetters, BattleStream } from './shared';

/**
 * Where the branch's runtime comes from (round 38): the app hands in the
 * position source, which adopts a stored position or reconstructs in the
 * worker; without it the runtime is reconstructed here on the main thread.
 */
export type AcquireRuntime = (params: ReconstructParams, plan: { isT0: boolean }) => Promise<BranchRuntime>;

interface StartBranchOptions {
  acquireRuntime?: AcquireRuntime;
  replayHistory?: BranchHistoryEntry[];
  p1Choices?: (BranchSlotChoice | null)[];
  p2Choices?: (BranchSlotChoice | null)[];
  playerNames?: [string, string];
  onProgress?: (turn: number, targetTurn: number) => void;
  abort?: AbortSignal;
  /**
   * Per-turn snapshots for boundary correction during the replay — without
   * them a long reconstruction drifts (guessed sets force different replays)
   * and the branch can open with the wrong Pokémon on the field.
   */
  snapshotFor?: (turn: number) => TurnSnapshot | null;
  /** Protocol-truth lock context (③) for the boundary corrections. */
  choiceLocks?: ChoiceLockContext;
  /**
   * Turn-0 branching (targetTurn 0): start a FRESH game with these leads
   * (one per side in singles, two in doubles, slot order preserved). With
   * `bring` the lists are the whole brought selection (VGC 4 of 6) and the
   * teams trim to them. The runtime rebuilds to turn 1 without snapshot
   * corrections, and the lead decision is history entry 0 (turnNumber 0).
   */
  leadOverride?: { p1: string[]; p2: string[]; bring?: boolean };
  /**
   * Bring-limited formats (VGC 4 of 6): field only the species the real
   * game brought — on any branch turn, so evaluations and play-outs on the
   * live battle can never switch into a never-brought Pokémon.
   */
  bringOnly?: { p1: string[]; p2: string[] };
  /** Round 89 (#105): the dice seed of a new game's lead start; a replay's branch never sets it. */
  seed?: string;
}

/**
 * Turn-0 lead branch: a FRESH game (no replayed blocks, no snapshot
 * corrections — they would put the original leads right back) rebuilt to
 * the start of turn 1 with the chosen leads first in the team order. The
 * leads come from the caller or — on a rebuild of an existing turn-0
 * variation (team edit, truncation) — from the recorded lead entry,
 * which is re-seeded here instead of replaying through the sim.
 */
function resolveLeadPlan(isT0: boolean, options: StartBranchOptions | undefined) {
  const historyLead = isT0 ? options?.replayHistory?.[0]?.leadChoices : undefined;
  const leadOverride = isT0 ? options?.leadOverride ?? historyLead : undefined;
  const historyToReplay = historyLead ? (options?.replayHistory ?? []).slice(1) : options?.replayHistory ?? [];
  return { leadOverride, historyToReplay };
}

function resolveStartPlan(targetTurn: number, options: StartBranchOptions | undefined) {
  const isT0 = targetTurn === 0;
  const { leadOverride, historyToReplay } = resolveLeadPlan(isT0, options);
  // A T0 pick marked `bring` IS the brought selection; other branches get
  // theirs from the caller (derived from the replay's own switches).
  const bringOnly = leadOverride?.bring
    ? { p1: leadOverride.p1, p2: leadOverride.p2 }
    : options?.bringOnly;
  return { isT0, leadOverride, historyToReplay, bringOnly };
}

type StartPlan = ReturnType<typeof resolveStartPlan>;

interface StartArgs {
  format: string;
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
  replayLog: string;
  targetTurn: number;
  snapshot?: TurnSnapshot | null;
  options?: StartBranchOptions;
}

/** The dice seed a new game's lead start names; a replay's start names none. */
const seedOf = (options: StartBranchOptions | undefined) => (options?.seed ? { seed: options.seed } : {});

/** The runtime rebuild at the target turn (turn 1 for a lead branch, no corrections there). */
function reconstructForStart(branchEngine: BranchEngineModule, args: StartArgs, plan: StartPlan): Promise<BranchRuntime> {
  const { format, p1Team, p2Team, replayLog, targetTurn, snapshot, options } = args;
  const { isT0, leadOverride, bringOnly } = plan;
  const params: ReconstructParams = {
    format,
    p1Team,
    p2Team,
    replayLog,
    targetTurn: isT0 ? 1 : targetTurn,
    snapshot: isT0 ? null : snapshot,
    playerNames: options?.playerNames,
    onProgress: options?.onProgress,
    abort: options?.abort,
    ...(options?.snapshotFor && !isT0
      ? { capturePositions: { snapshotFor: options.snapshotFor, onPosition: () => {} } }
      : {}),
    choiceLocks: isT0 ? undefined : options?.choiceLocks,
    leadOverride: leadOverride ? { p1: leadOverride.p1, p2: leadOverride.p2 } : undefined,
    bringOnly,
    ...seedOf(options),
  };
  return options?.acquireRuntime ? options.acquireRuntime(params, { isT0 }) : branchEngine.reconstructBranchRuntime(params);
}

/**
 * The start's runtime, or null when the preparation was cancelled on the
 * way: an aborted main-thread reconstruction returns early, a terminated
 * worker job throws — both end the start quietly.
 */
async function reconstructOrAbort(branchEngine: BranchEngineModule, args: StartArgs, plan: StartPlan): Promise<BranchRuntime | null> {
  const aborted = () => args.options?.abort?.aborted === true;
  try {
    const runtime = await reconstructForStart(branchEngine, args, plan);
    return aborted() ? null : runtime;
  } catch (error) {
    if (aborted()) return null;
    throw error;
  }
}

/** Replays the kept history onto the rebuilt runtime; stops at the first entry that no longer applies. */
async function replayKeptHistory(
  runtime: BranchRuntime, branchEngine: BranchEngineModule, historyToReplay: BranchHistoryEntry[],
  replayedHistory: BranchHistoryEntry[],
): Promise<{ turnNumber: number; error: string } | null> {
  for (const entry of historyToReplay) {
    const outcome = await replayHistoryEntry(runtime, branchEngine, entry);
    if (!outcome.ok) return { turnNumber: entry.turnNumber, error: outcome.error };
    replayedHistory.push(outcome.entry);
  }
  return null;
}

/** What a rebuild reports: `endedNotice` names the variation that was lost when the rebuild kept no turn. */
export interface StartOutcome { endedNotice: string | null }


/**
 * The text for a variation that a rebuild could not keep at all (round 77, D1): the first recorded move no longer
 * applies, so no turn survives and no variation stays behind.
 */
function endedNoticeFor(startTurn: number, recorded: BranchHistoryEntry[], reason: string): string {
  const turns = turnEntryCount(recorded);
  return `The variation from turn ${startTurn} (${turns} ${turns === 1 ? 'turn' : 'turns'}) ended: ${reason}`;
}

/**
 * The history a start puts on the rebuilt runtime: the lead entry of a turn-0 variation, then the kept entries.
 * A start whose recorded turns all fail to apply reports `endedNotice` instead of an empty variation (round 77, D1).
 */
async function replayStartHistory(
  runtime: BranchRuntime, branchEngine: BranchEngineModule, plan: StartPlan, startPosition: string | null, targetTurn: number,
): Promise<{ replayedHistory: BranchHistoryEntry[]; branchError: string | null; endedNotice: string | null }> {
  const { isT0, leadOverride, historyToReplay } = plan;
  const replayedHistory: BranchHistoryEntry[] = [];
  const invalid = branchEngine.validateBranchRuntime(runtime);
  if (invalid) return { replayedHistory, branchError: invalid, endedNotice: null };
  if (isT0 && leadOverride) {
    replayedHistory.push(leadHistoryEntry(branchEngine, runtime, leadOverride, startPosition));
  }
  const failure = await replayKeptHistory(runtime, branchEngine, historyToReplay, replayedHistory);
  if (!failure) return { replayedHistory, branchError: null, endedNotice: null };
  if (turnEntryCount(replayedHistory) === 0 && turnEntryCount(historyToReplay) > 0) {
    return { replayedHistory, branchError: null, endedNotice: endedNoticeFor(targetTurn, historyToReplay, failure.error) };
  }
  return {
    replayedHistory, endedNotice: null,
    branchError: `Rebuild stopped before branch turn ${failure.turnNumber}: ${failure.error}`,
  };
}

interface SessionSetters extends BranchSetters {
  setBranching: React.Dispatch<React.SetStateAction<boolean>>;
  setVariationStartTurn: React.Dispatch<React.SetStateAction<number | null>>;
  setStartSerialized: React.Dispatch<React.SetStateAction<string | null>>;
}

function useStartBranch(
  refs: BranchRefs, setters: SessionSetters, clearChoices: () => void,
  loadBranchEngine: () => Promise<BranchEngineModule>, updateState: (battleStream: BattleStream | null) => void,
  stopBranch: () => void,
) {
  const { logRef, battleStreamRef, streamsRef, choiceErrorsRef, p1ChoicesRef, p2ChoicesRef, startLogLengthRef } = refs;
  const { setExecuteError, setBranching, setHistory, setVariationStartTurn, setStartSerialized } = setters;
  return useCallback(async (
    format: string,
    p1Team: PokemonSet[],
    p2Team: PokemonSet[],
    replayLog: string,
    targetTurn: number,
    snapshot?: TurnSnapshot | null,
    options?: StartBranchOptions,
  ): Promise<StartOutcome | void> => {
    logRef.current = [];
    clearChoices();
    setExecuteError(null);

    const branchEngine = await loadBranchEngine();
    const plan = resolveStartPlan(targetTurn, options);
    const runtime = await reconstructOrAbort(branchEngine, { format, p1Team, p2Team, replayLog, targetTurn, snapshot, options }, plan);
    if (!runtime) return;

    logRef.current = runtime.log;
    startLogLengthRef.current = runtime.log.length;
    battleStreamRef.current = runtime.battleStream;
    streamsRef.current = runtime.streams;
    choiceErrorsRef.current = runtime.choiceErrors;
    // Captured BEFORE any history replay — after it the battle stands at the
    // tip, and the start position is the one every truncation returns to.
    const startPosition = branchEngine.captureSerializedPosition(runtime.battleStream.battle);

    const { replayedHistory, branchError, endedNotice } = await replayStartHistory(runtime, branchEngine, plan, startPosition, targetTurn);
    if (endedNotice) {
      stopBranch();
      return { endedNotice };
    }

    p1ChoicesRef.current = branchError ? [] : [...(options?.p1Choices ?? [])];
    p2ChoicesRef.current = branchError ? [] : [...(options?.p2Choices ?? [])];
    setBranching(true);
    setHistory(replayedHistory);
    setVariationStartTurn(targetTurn);
    setStartSerialized(startPosition);
    setExecuteError(branchError);
    updateState(runtime.battleStream);
    return { endedNotice: null };
  }, [clearChoices, loadBranchEngine, updateState, stopBranch, logRef, battleStreamRef, streamsRef, choiceErrorsRef,
    p1ChoicesRef, p2ChoicesRef, startLogLengthRef, setExecuteError, setBranching, setHistory, setVariationStartTurn, setStartSerialized]);
}

/** The session side of the branch: rebuilding a runtime at a turn, reading its battle, and tearing it down. */
export function useBranchSession(
  refs: BranchRefs, setters: SessionSetters, clearChoices: () => void,
  updateState: (battleStream: BattleStream | null) => void,
) {
  const { branchEngineRef, battleStreamRef, streamsRef, logRef, choiceErrorsRef } = refs;
  const { setBranching, setSimState, setHistory, setVariationStartTurn, setStartSerialized, setExecuteError } = setters;

  const loadBranchEngine = useCallback(async () => {
    branchEngineRef.current ??= await import('../../lib/lazy/branch-engine');
    return branchEngineRef.current;
  }, [branchEngineRef]);

  const stopBranch = useCallback(() => {
    setBranching(false);
    setSimState(null);
    setHistory([]);
    setVariationStartTurn(null);
    setStartSerialized(null);
    setExecuteError(null);
    streamsRef.current = null;
    battleStreamRef.current = null;
    logRef.current = [];
    choiceErrorsRef.current = null;
    clearChoices();
  }, [clearChoices, setBranching, setSimState, setHistory, setVariationStartTurn, setStartSerialized, setExecuteError,
    streamsRef, battleStreamRef, logRef, choiceErrorsRef]);

  const startBranch = useStartBranch(refs, setters, clearChoices, loadBranchEngine, updateState, stopBranch);

  /** Live sim battle of the current branch (null outside an active branch). */
  const getBattle = useCallback(() => battleStreamRef.current?.battle ?? null, [battleStreamRef]);

  return { startBranch, getBattle, stopBranch };
}
