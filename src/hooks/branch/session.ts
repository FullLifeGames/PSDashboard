import { useCallback } from 'react';
import type { PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import type { ChoiceLockContext, BranchRuntime, BranchSlotChoice, ReconstructParams } from '@fulllifegames/eval-engine';
import { turnEntryCount } from '../../lib/variation-turns';
import { replayHistoryEntry, leadHistoryEntry } from './replay-entry';
import type { BranchEngineModule, BranchHistoryEntry, BranchRefs, BranchSetters, BattleStream } from './shared';

/** The position source adopts a stored position or reconstructs in the worker; without it the main thread does. */
export type AcquireRuntime = (params: ReconstructParams, plan: { isT0: boolean }) => Promise<BranchRuntime>;

interface StartBranchOptions {
  acquireRuntime?: AcquireRuntime;
  replayHistory?: BranchHistoryEntry[];
  p1Choices?: (BranchSlotChoice | null)[];
  p2Choices?: (BranchSlotChoice | null)[];
  playerNames?: [string, string];
  onProgress?: (turn: number, targetTurn: number) => void;
  abort?: AbortSignal;
  /** Per-turn snapshots for boundary correction; without them a long reconstruction drifts. */
  snapshotFor?: (turn: number) => TurnSnapshot | null;
  choiceLocks?: ChoiceLockContext;
  /**
   * Turn-0 branching: a FRESH game with these leads (one per side in singles, two in doubles, slot order kept).
   * With `bring` the lists are the whole brought selection (VGC 4 of 6) and the teams trim to them.
   */
  leadOverride?: { p1: string[]; p2: string[]; bring?: boolean };
  /** Bring-limited formats (VGC 4 of 6): field only the brought species, never a Pokémon that stayed home. */
  bringOnly?: { p1: string[]; p2: string[] };
  /** The dice seed of a new game's lead start; a replay's branch never sets it. */
  seed?: string;
}

// A FRESH game: replayed blocks and snapshot corrections would put the original leads right back.
function resolveLeadPlan(isT0: boolean, options: StartBranchOptions | undefined) {
  const historyLead = isT0 ? options?.replayHistory?.[0]?.leadChoices : undefined;
  const leadOverride = isT0 ? options?.leadOverride ?? historyLead : undefined;
  const historyToReplay = historyLead ? (options?.replayHistory ?? []).slice(1) : options?.replayHistory ?? [];
  return { leadOverride, historyToReplay };
}

function resolveStartPlan(targetTurn: number, options: StartBranchOptions | undefined) {
  const isT0 = targetTurn === 0;
  const { leadOverride, historyToReplay } = resolveLeadPlan(isT0, options);
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

const seedOf = (options: StartBranchOptions | undefined) => (options?.seed ? { seed: options.seed } : {});

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

// A terminated worker job throws, an aborted main-thread reconstruction returns early: both end the start quietly.
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

export interface StartOutcome { endedNotice: string | null }


function endedNoticeFor(startTurn: number, recorded: BranchHistoryEntry[], reason: string): string {
  const turns = turnEntryCount(recorded);
  return `The variation from turn ${startTurn} (${turns} ${turns === 1 ? 'turn' : 'turns'}) ended: ${reason}`;
}

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
    // Captured before any history replay: after it the battle stands at the tip, and every truncation returns here.
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

  const getBattle = useCallback(() => battleStreamRef.current?.battle ?? null, [battleStreamRef]);

  return { startBranch, getBattle, stopBranch };
}
