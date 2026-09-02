import { useState, useCallback, useMemo, useRef } from 'react';
import type { BranchChoiceErrorLog, BranchSimState, BranchSlotChoice } from '@fulllifegames/eval-engine';
import type { BattleStream, BranchEngineModule, BranchHistoryEntry, BranchRefs, PlayerStreams } from './branch/shared';
import { useBranchExecute } from './branch/execute';
import { useBranchSession } from './branch/session';

export type {
  BranchMoveOption,
  BranchSwitchOption,
  BranchSimState,
  SimPokemonInfo,
} from '@fulllifegames/eval-engine';
export type { BranchHistoryEntry } from './branch/shared';

/**
 * The branch simulator: one live @pkmn/sim battle rebuilt at a replay turn,
 * with the execute side (turns, forced interludes, choice recording) and the
 * session side (rebuild, battle access, teardown) composed over shared refs.
 */
export function useBranch() {
  const [branching, setBranching] = useState(false);
  const [simState, setSimState] = useState<BranchSimState | null>(null);
  const [history, setHistory] = useState<BranchHistoryEntry[]>([]);
  /** Turn the current branch runtime was started at (null = no runtime). */
  const [variationStartTurn, setVariationStartTurn] = useState<number | null>(null);
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
  // Both bundles are render-stable: refs and state setters never change
  // identity, so every callback below keeps the stability it had inline.
  const refs = useMemo<BranchRefs>(() => ({
    executingRef, branchEngineRef, streamsRef, battleStreamRef, logRef, choiceErrorsRef, p1ChoicesRef, p2ChoicesRef,
  }), [executingRef, branchEngineRef, streamsRef, battleStreamRef, logRef, choiceErrorsRef, p1ChoicesRef, p2ChoicesRef]);
  const setters = useMemo(() => ({
    setSimState, setHistory, setExecuteError, setExecuting, setBranching, setVariationStartTurn, setStartSerialized,
  }), []);

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

  const { executeTurn, setChoice } = useBranchExecute(refs, setters, clearChoices);
  const { startBranch, getBattle, stopBranch } = useBranchSession(refs, setters, clearChoices, updateState);

  return {
    branching, simState, history, executeError, executing,
    variationStartTurn, startSerialized,
    startBranch, setChoice, executeTurn, stopBranch, getBattle,
  };
}
