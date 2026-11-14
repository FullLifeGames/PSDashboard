import { useState, useCallback, useMemo, useRef } from 'react';
import type { BranchChoiceErrorLog, BranchSimState, BranchSlotChoice } from '@fulllifegames/eval-engine';
import type { BattleStream, BranchEngineModule, BranchHistoryEntry, BranchRefs, PlayerStreams } from './branch/shared';
import { useBranchExecute } from './branch/execute';
import { useBranchSession } from './branch/session';
import { useLeadPromotion, useNewGameAccess, useTrackedState } from './branch/tracked';
import { limitBench, type Bench } from '../lib/bench';

export type {
  BranchMoveOption,
  BranchSwitchOption,
  BranchSimState,
  SimPokemonInfo,
} from '@fulllifegames/eval-engine';
export type { BranchHistoryEntry } from './branch/shared';

/** Wraps an executor so it resolves to the error text the tracked setter recorded while it ran (null when none). */
function useReportingExecutor(run: () => Promise<void>, lastErrorRef: React.RefObject<string | null>) {
  return useCallback(async (): Promise<string | null> => {
    lastErrorRef.current = null;
    await run();
    return lastErrorRef.current;
  }, [run, lastErrorRef]);
}

/**
 * The branch simulator: one live @pkmn/sim battle rebuilt at a replay turn,
 * with the execute side (turns, forced interludes, choice recording) and the
 * session side (rebuild, battle access, teardown) composed over shared refs.
 *
 * Round 88 (T314, #55): `bench` is the bring-limited game's bench lists (`replayBench`). The battle keeps the whole team the rebuild
 * built; the state the pickers and the dock read offers only the bodies the bring allows, so the What-if and its forced replacements
 * never name a body that stayed home. Round 88 (M3): `engineSimState` is the state as the battle offers it, for the engine's own
 * choices (a ranked line, the play-out, a forced replacement), which still reach the unbrought bodies (option (c), round 89).
 */
export function useBranch(bench: Bench | null = null, afterTurnRef?: React.RefObject<(() => Promise<void>) | null>) {
  const [branching, setBranching] = useState(false);
  const [rawSimState, setSimState] = useState<BranchSimState | null>(null);
  const simState = useMemo(() => (rawSimState ? limitBench(rawSimState, bench) : null), [rawSimState, bench]);
  const [history, setHistory, historyRef] = useTrackedState<BranchHistoryEntry[]>([]);
  /** Turn the current branch runtime was started at (null = no runtime). */
  const [variationStartTurn, setVariationStartTurn, startTurnRef] = useTrackedState<number | null>(null);
  /** Serialized position at the branch start, before entry 0. */
  const [startSerialized, setStartSerialized] = useState<string | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const executingRef = useRef(false);
  const branchEngineRef = useRef<BranchEngineModule | null>(null);
  const streamsRef = useRef<PlayerStreams | null>(null);
  const battleStreamRef = useRef<BattleStream | null>(null);
  const logRef = useRef<string[]>([]);
  const choiceErrorsRef = useRef<BranchChoiceErrorLog | null>(null);
  const p1ChoicesRef = useRef<(BranchSlotChoice | null)[]>([]);
  const p2ChoicesRef = useRef<(BranchSlotChoice | null)[]>([]);
  const startLogLengthRef = useRef(0);
  // Both bundles are render-stable: refs and state setters never change
  // identity, so every callback below keeps the stability it had inline.
  const refs = useMemo<BranchRefs>(() => ({
    executingRef, branchEngineRef, streamsRef, battleStreamRef, logRef, choiceErrorsRef, p1ChoicesRef, p2ChoicesRef, startLogLengthRef, afterTurnRef,
  }), [afterTurnRef, executingRef, branchEngineRef, streamsRef, battleStreamRef, logRef, choiceErrorsRef, p1ChoicesRef, p2ChoicesRef, startLogLengthRef]);
  const setters = useMemo(() => ({
    setSimState, setHistory, setExecuteError, setExecuting, setBranching, setVariationStartTurn, setStartSerialized,
  }), [setHistory, setVariationStartTurn]);

  const updateState = useCallback((battleStream: BattleStream | null) => {
    const branchEngine = branchEngineRef.current;
    if (!branchEngine) return;
    setSimState(branchEngine.createBranchState(battleStream, logRef.current, {
      p1Choices: p1ChoicesRef.current,
      p2Choices: p2ChoicesRef.current,
    }));
  }, []);

  const clearChoices = useCallback(() => {
    p1ChoicesRef.current = [];
    p2ChoicesRef.current = [];
  }, []);

  /** Round 84 (turn dock): the pending picks of both sides right now. The dock's engine fill reads them where its result lands, when a render's copy is stale. */
  const getChoices = useCallback(() => ({ p1: p1ChoicesRef.current as readonly (BranchSlotChoice | null)[], p2: p2ChoicesRef.current as readonly (BranchSlotChoice | null)[] }), []);

  // executeTurn hands its failure to the caller: a deviation that replaced a variation needs it to roll back
  // (round 77, A-2). The tracked setter records what the executor reported last.
  const lastExecuteErrorRef = useRef<string | null>(null);
  const trackedSetters = useMemo(() => ({
    ...setters,
    setExecuteError: (value: React.SetStateAction<string | null>) => {
      if (typeof value !== 'function') lastExecuteErrorRef.current = value;
      setters.setExecuteError(value);
    },
  }), [setters]);
  const { executeTurn: runTurn, setChoice, recordChoice, executePending: runPending } = useBranchExecute(refs, trackedSetters, clearChoices);
  /** Runs the pending choices; resolves to the executor's error text, or null when the turn ran or nothing was due. */
  const executeTurn = useReportingExecutor(runTurn, lastExecuteErrorRef);
  /** Round 84 (A7a): Execute of the dock: the forced replacement it holds, else the turn. Same result as `executeTurn`. */
  const executePending = useReportingExecutor(runPending, lastExecuteErrorRef);
  const { startBranch: startBranchRaw, getBattle, stopBranch } = useBranchSession(refs, setters, clearChoices, updateState);
  const startBranch = useLeadPromotion(startBranchRaw, afterTurnRef);
  const newGameAccess = useNewGameAccess(refs, { historyRef, startTurnRef, setHistory, setVariationStartTurn, setStartSerialized });

  return {
    ...newGameAccess,
    branching, simState, engineSimState: rawSimState, history, executeError, executing,
    variationStartTurn, startSerialized,
    startBranch, setChoice, recordChoice, executeTurn, executePending, stopBranch, getBattle, getChoices,
  };
}
