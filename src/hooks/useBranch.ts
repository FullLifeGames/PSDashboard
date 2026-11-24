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

function useReportingExecutor(run: () => Promise<void>, lastErrorRef: React.RefObject<string | null>) {
  return useCallback(async (): Promise<string | null> => {
    lastErrorRef.current = null;
    await run();
    return lastErrorRef.current;
  }, [run, lastErrorRef]);
}

/** The branch simulator; `bench` filters what the pickers offer, `engineSimState` is the unfiltered state. */
export function useBranch(bench: Bench | null = null, afterTurnRef?: React.RefObject<(() => Promise<void>) | null>) {
  const [branching, setBranching] = useState(false);
  const [rawSimState, setSimState] = useState<BranchSimState | null>(null);
  const simState = useMemo(() => (rawSimState ? limitBench(rawSimState, bench) : null), [rawSimState, bench]);
  const [history, setHistory, historyRef] = useTrackedState<BranchHistoryEntry[]>([]);
  /** Turn the runtime was started at; null = no runtime. */
  const [variationStartTurn, setVariationStartTurn, startTurnRef] = useTrackedState<number | null>(null);
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

  /** The pending picks of both sides right now, read where a render's copy is stale. */
  const getChoices = useCallback(() => ({ p1: p1ChoicesRef.current as readonly (BranchSlotChoice | null)[], p2: p2ChoicesRef.current as readonly (BranchSlotChoice | null)[] }), []);

  const lastExecuteErrorRef = useRef<string | null>(null);
  const trackedSetters = useMemo(() => ({
    ...setters,
    setExecuteError: (value: React.SetStateAction<string | null>) => {
      if (typeof value !== 'function') lastExecuteErrorRef.current = value;
      setters.setExecuteError(value);
    },
  }), [setters]);
  const { executeTurn: runTurn, setChoice, recordChoice, executePending: runPending } = useBranchExecute(refs, trackedSetters, clearChoices);
  /** Resolves to the executor's error text, or null when the turn ran or nothing was due. */
  const executeTurn = useReportingExecutor(runTurn, lastExecuteErrorRef);
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
