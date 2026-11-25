import { useCallback } from 'react';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import { entryDice, turnStart } from '../../lib/branch-dice-lines';
import {
  forceSwitches, hasAllChoices, makeHistoryEntry, requiredChoices,
  type BranchEngineModule, type BranchRefs, type BranchSetters, type LiveBattle, type SideId,
} from './shared';

const runAfterTurn = async (refs: BranchRefs): Promise<void> => {
  await refs.afterTurnRef?.current?.();
};

function resolveBothSides(
  branchEngine: BranchEngineModule, battle: LiveBattle, refs: BranchRefs,
): { ok: true; p1: string; p2: string } | { ok: false; error: string } {
  const p1 = branchEngine.resolveSideChoices(battle, 'p1', refs.p1ChoicesRef.current, requiredChoices(battle, 'p1'));
  if (!p1.ok) return p1;
  const p2 = branchEngine.resolveSideChoices(battle, 'p2', refs.p2ChoicesRef.current, requiredChoices(battle, 'p2'));
  if (!p2.ok) return p2;
  return { ok: true, p1: p1.command, p2: p2.command };
}

function useExecuteTurn(refs: BranchRefs, setters: BranchSetters, clearChoices: () => void) {
  const { streamsRef, battleStreamRef, branchEngineRef, choiceErrorsRef, executingRef, logRef, p1ChoicesRef, p2ChoicesRef } = refs;
  const { setExecuting, setExecuteError, setHistory, setSimState } = setters;
  return useCallback(async () => {
    const streams = streamsRef.current;
    const battleStream = battleStreamRef.current;
    const branchEngine = branchEngineRef.current;
    const choiceErrors = choiceErrorsRef.current;
    const battle = battleStream?.battle;
    if (!streams || !battleStream || !branchEngine || !choiceErrors || !battle) return;
    if (executingRef.current) return;
    if (!hasAllChoices(battle, 'p1', p1ChoicesRef.current) || !hasAllChoices(battle, 'p2', p2ChoicesRef.current)) {
      return;
    }

    executingRef.current = true;
    setExecuting(true);
    try {
      const currentTurn = battle.turn ?? 0;
      const resolved = resolveBothSides(branchEngine, battle, refs);
      if (!resolved.ok) {
        setExecuteError(resolved.error);
        return;
      }

      const start = turnStart(battle, logRef.current);
      const result = await branchEngine.executeBranchChoices({
        streams,
        log: logRef.current,
        choiceErrors,
        commands: [{ side: 'p1', command: resolved.p1 }, { side: 'p2', command: resolved.p2 }],
        dice: { battle, p1Choices: p1ChoicesRef.current, p2Choices: p2ChoicesRef.current },
      });

      if (!result.ok) {
        setExecuteError(branchEngine.annotateNicknames(result.error, battle));
        return;
      }

      setExecuteError(null);
      const p1SlotChoices = [...p1ChoicesRef.current];
      const p2SlotChoices = [...p2ChoicesRef.current];
      clearChoices();
      const nextState = branchEngine.createBranchState(battleStream, logRef.current, {
        p1Choices: p1ChoicesRef.current,
        p2Choices: p2ChoicesRef.current,
      });
      setHistory(prev => [...prev, {
        ...makeHistoryEntry(currentTurn, resolved.p1, resolved.p2, nextState),
        kind: 'turn' as const,
        p1SlotChoices,
        p2SlotChoices,
        ...entryDice(result.dice, start, battle, logRef.current, nextState.p1ForceSwitch || nextState.p2ForceSwitch),
        serializedPosition: branchEngine.captureSerializedPosition(battleStream.battle),
      }]);
      setSimState(nextState);
      await runAfterTurn(refs);
    } finally {
      executingRef.current = false;
      setExecuting(false);
    }
  }, [clearChoices, refs, streamsRef, battleStreamRef, branchEngineRef, choiceErrorsRef, executingRef, logRef,
    p1ChoicesRef, p2ChoicesRef, setExecuting, setExecuteError, setHistory, setSimState]);
}

function useExecuteForcedSide(refs: BranchRefs, setters: BranchSetters) {
  const { streamsRef, battleStreamRef, branchEngineRef, choiceErrorsRef, executingRef, logRef, p1ChoicesRef, p2ChoicesRef } = refs;
  const { setExecuting, setExecuteError, setHistory, setSimState } = setters;
  return useCallback(async (
    side: SideId,
    command: string,
    slotChoices: (BranchSlotChoice | null)[],
  ) => {
    const streams = streamsRef.current;
    const battleStream = battleStreamRef.current;
    const branchEngine = branchEngineRef.current;
    const choiceErrors = choiceErrorsRef.current;
    if (!streams || !battleStream || !branchEngine || !choiceErrors) return;
    if (executingRef.current) return;

    executingRef.current = true;
    setExecuting(true);
    try {
      const turnNumber = battleStream.battle?.turn ?? 0;
      const battle = battleStream.battle;
      const start = battle ? turnStart(battle, logRef.current) : null;
      // A turn that paused for this switch keeps its dice on the battle: the replacement plays the rest with them.
      const result = await branchEngine.executeBranchChoices({
        streams,
        log: logRef.current,
        choiceErrors,
        commands: [{ side, command }],
        ...(battle ? { dice: { battle, p1Choices: side === 'p1' ? slotChoices : [], p2Choices: side === 'p2' ? slotChoices : [] } } : {}),
      });

      if (!result.ok) {
        setExecuteError(branchEngine.annotateNicknames(result.error, battleStream.battle));
        return;
      }

      setExecuteError(null);
      if (side === 'p1') p1ChoicesRef.current = [];
      if (side === 'p2') p2ChoicesRef.current = [];
      const nextState = branchEngine.createBranchState(battleStream, logRef.current, {
        p1Choices: p1ChoicesRef.current,
        p2Choices: p2ChoicesRef.current,
      });
      setHistory(prev => [...prev, {
        ...makeHistoryEntry(turnNumber, side === 'p1' ? command : '—', side === 'p2' ? command : '—', nextState),
        kind: 'forced' as const,
        forcedSide: side,
        ...(side === 'p1' ? { p1SlotChoices: slotChoices } : { p2SlotChoices: slotChoices }),
        ...(battle && start ? entryDice(result.dice, start, battle, logRef.current, nextState.p1ForceSwitch || nextState.p2ForceSwitch) : {}),
        serializedPosition: branchEngine.captureSerializedPosition(battleStream.battle),
      }]);
      setSimState(nextState);
      await runAfterTurn(refs);
    } finally {
      executingRef.current = false;
      setExecuting(false);
    }
  }, [refs, streamsRef, battleStreamRef, branchEngineRef, choiceErrorsRef, executingRef, logRef, p1ChoicesRef, p2ChoicesRef,
    setExecuting, setExecuteError, setHistory, setSimState]);
}

function forcedSideCommand(
  branchEngine: BranchEngineModule, battle: LiveBattle, refs: BranchRefs, side: SideId,
  forced: { p1: boolean; p2: boolean },
): { side: SideId; command: string; slotChoices: (BranchSlotChoice | null)[] } | { error: string } | null {
  for (const forcedSide of ['p1', 'p2'] as const) {
    const isForced = forcedSide === 'p1' ? forced.p1 && !forced.p2 : forced.p2 && !forced.p1;
    const choicesRef = forcedSide === 'p1' ? refs.p1ChoicesRef : refs.p2ChoicesRef;
    if (!isForced || side !== forcedSide || !hasAllChoices(battle, forcedSide, choicesRef.current)) continue;

    const resolved = branchEngine.resolveSideChoices(battle, forcedSide, choicesRef.current, requiredChoices(battle, forcedSide));
    if (!resolved.ok) return { error: resolved.error };
    return { side: forcedSide, command: resolved.command, slotChoices: [...choicesRef.current] };
  }
  return null;
}

function recordSlotChoice(refs: BranchRefs, side: SideId, activeSlot: number, choice: BranchSlotChoice): void {
  const ref = side === 'p1' ? refs.p1ChoicesRef : refs.p2ChoicesRef;
  ref.current = [...ref.current];
  ref.current[activeSlot] = choice;
}

function publishChoices(refs: BranchRefs, setters: BranchSetters): void {
  // The picks are copied now, not when the updater runs: a send that clears the refs first would publish an empty list.
  const p1Choices = [...refs.p1ChoicesRef.current];
  const p2Choices = [...refs.p2ChoicesRef.current];
  setters.setSimState(prev => prev ? {
    ...prev,
    p1Choice: p1Choices[0] ?? null,
    p1Choices,
    p2Choice: p2Choices[0] ?? null,
    p2Choices,
  } : null);
}

function useSettle(
  refs: BranchRefs, setters: BranchSetters,
  executeTurn: () => Promise<void>,
  executeForcedSide: (side: SideId, command: string, slotChoices: (BranchSlotChoice | null)[]) => Promise<void>,
) {
  const { battleStreamRef, branchEngineRef, p1ChoicesRef, p2ChoicesRef } = refs;
  const { setExecuteError } = setters;
  return useCallback((side: SideId): boolean => {
    const battle = battleStreamRef.current?.battle;
    const branchEngine = branchEngineRef.current;
    if (!battle || !branchEngine) return false;

    const p1Forced = forceSwitches(battle, 'p1').some(Boolean);
    const p2Forced = forceSwitches(battle, 'p2').some(Boolean);

    const forcedCommand = forcedSideCommand(branchEngine, battle, refs, side, { p1: p1Forced, p2: p2Forced });
    if (forcedCommand) {
      if ('error' in forcedCommand) setExecuteError(forcedCommand.error);
      else void executeForcedSide(forcedCommand.side, forcedCommand.command, forcedCommand.slotChoices);
      return true;
    }

    if ((p1Forced || p2Forced) &&
      hasAllChoices(battle, 'p1', p1ChoicesRef.current) &&
      hasAllChoices(battle, 'p2', p2ChoicesRef.current)) {
      void executeTurn();
      return true;
    }
    return false;
  }, [executeForcedSide, executeTurn, refs, battleStreamRef, branchEngineRef, p1ChoicesRef, p2ChoicesRef, setExecuteError]);
}

function useSetChoice(refs: BranchRefs, setters: BranchSetters, settle: (side: SideId) => boolean) {
  const { executingRef } = refs;
  const { setExecuteError } = setters;
  return useCallback((side: SideId, choice: BranchSlotChoice, activeSlot = 0) => {
    if (executingRef.current) return;
    recordSlotChoice(refs, side, activeSlot, choice);
    setExecuteError(null);
    if (!refs.battleStreamRef.current?.battle || !refs.branchEngineRef.current) return;
    // Published before the send: the updater is queued ahead of the send's `setSimState`, which wins.
    publishChoices(refs, setters);
    settle(side);
  }, [settle, refs, setters, executingRef, setExecuteError]);
}

function useRecordChoice(refs: BranchRefs, setters: BranchSetters) {
  const { executingRef } = refs;
  const { setExecuteError } = setters;
  return useCallback((side: SideId, choice: BranchSlotChoice, activeSlot = 0) => {
    if (executingRef.current) return;
    recordSlotChoice(refs, side, activeSlot, choice);
    setExecuteError(null);
    publishChoices(refs, setters);
  }, [refs, setters, executingRef, setExecuteError]);
}

function useExecutePending(refs: BranchRefs, executeTurn: () => Promise<void>, settle: (side: SideId) => boolean) {
  const { battleStreamRef, executingRef } = refs;
  return useCallback(async () => {
    const battle = battleStreamRef.current?.battle;
    if (!battle || executingRef.current) return;
    const forced = (['p1', 'p2'] as const).filter(side => forceSwitches(battle, side).some(Boolean));
    if (forced.length === 0) { await executeTurn(); return; }
    settle(forced[0]);
  }, [battleStreamRef, executingRef, executeTurn, settle]);
}

export function useBranchExecute(refs: BranchRefs, setters: BranchSetters, clearChoices: () => void) {
  const executeTurn = useExecuteTurn(refs, setters, clearChoices);
  const executeForcedSide = useExecuteForcedSide(refs, setters);
  const settle = useSettle(refs, setters, executeTurn, executeForcedSide);
  const setChoice = useSetChoice(refs, setters, settle);
  const recordChoice = useRecordChoice(refs, setters);
  const executePending = useExecutePending(refs, executeTurn, settle);
  return { executeTurn, setChoice, recordChoice, executePending };
}
