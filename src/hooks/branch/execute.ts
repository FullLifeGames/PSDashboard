import { useCallback } from 'react';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import {
  forceSwitches, hasAllChoices, makeHistoryEntry, requiredChoices,
  type BranchEngineModule, type BranchRefs, type BranchSetters, type LiveBattle, type SideId,
} from './shared';

/** Resolve both sides' pending choices against the live request; an error string on the first miss. */
function resolveBothSides(
  branchEngine: BranchEngineModule, battle: LiveBattle, refs: BranchRefs,
): { ok: true; p1: string; p2: string } | { ok: false; error: string } {
  const p1 = branchEngine.resolveSideChoices(battle, 'p1', refs.p1ChoicesRef.current, requiredChoices(battle, 'p1'));
  if (!p1.ok) return p1;
  const p2 = branchEngine.resolveSideChoices(battle, 'p2', refs.p2ChoicesRef.current, requiredChoices(battle, 'p2'));
  if (!p2.ok) return p2;
  return { ok: true, p1: p1.command, p2: p2.command };
}

/** Executes both sides' pending choices as one turn; a normal history entry follows. */
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

      const result = await branchEngine.executeBranchChoices({
        streams,
        log: logRef.current,
        choiceErrors,
        commands: [
          { side: 'p1', command: resolved.p1 },
          { side: 'p2', command: resolved.p2 },
        ],
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
        serializedPosition: branchEngine.captureSerializedPosition(battleStream.battle),
      }]);
      setSimState(nextState);
    } finally {
      executingRef.current = false;
      setExecuting(false);
    }
  }, [clearChoices, refs, streamsRef, battleStreamRef, branchEngineRef, choiceErrorsRef, executingRef, logRef,
    p1ChoicesRef, p2ChoicesRef, setExecuting, setExecuteError, setHistory, setSimState]);
}

/** Executes one side's forced replacement as a 'forced' interlude entry (B15). */
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
      const result = await branchEngine.executeBranchChoices({
        streams,
        log: logRef.current,
        choiceErrors,
        commands: [{ side, command }],
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
        serializedPosition: branchEngine.captureSerializedPosition(battleStream.battle),
      }]);
      setSimState(nextState);
    } finally {
      executingRef.current = false;
      setExecuting(false);
    }
  }, [streamsRef, battleStreamRef, branchEngineRef, choiceErrorsRef, executingRef, logRef, p1ChoicesRef, p2ChoicesRef,
    setExecuting, setExecuteError, setHistory, setSimState]);
}

/**
 * The single-side forced-switch rule: when exactly one side must replace and
 * that side just completed its choices, its command resolves now. Returns
 * the command, an error, or null when the rule does not apply.
 */
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

/** Writes one slot's choice into the side's pending list (a fresh array, so React sees the change). */
function recordSlotChoice(refs: BranchRefs, side: SideId, activeSlot: number, choice: BranchSlotChoice): void {
  const ref = side === 'p1' ? refs.p1ChoicesRef : refs.p2ChoicesRef;
  ref.current = [...ref.current];
  ref.current[activeSlot] = choice;
}

/** Records one slot's choice and fires the forced-switch or both-sides-ready follow-ups. */
function useSetChoice(
  refs: BranchRefs, setters: BranchSetters,
  executeTurn: () => Promise<void>,
  executeForcedSide: (side: SideId, command: string, slotChoices: (BranchSlotChoice | null)[]) => Promise<void>,
) {
  const { executingRef, battleStreamRef, branchEngineRef, p1ChoicesRef, p2ChoicesRef } = refs;
  const { setExecuteError, setSimState } = setters;
  return useCallback((side: SideId, choice: BranchSlotChoice, activeSlot = 0) => {
    if (executingRef.current) return;
    recordSlotChoice(refs, side, activeSlot, choice);
    setExecuteError(null);

    const battleStream = battleStreamRef.current;
    const branchEngine = branchEngineRef.current;
    const battle = battleStream?.battle;
    if (!battle || !branchEngine) return;

    const p1Forced = forceSwitches(battle, 'p1').some(Boolean);
    const p2Forced = forceSwitches(battle, 'p2').some(Boolean);

    const forcedCommand = forcedSideCommand(branchEngine, battle, refs, side, { p1: p1Forced, p2: p2Forced });
    if (forcedCommand) {
      if ('error' in forcedCommand) {
        setExecuteError(forcedCommand.error);
        return;
      }
      void executeForcedSide(forcedCommand.side, forcedCommand.command, forcedCommand.slotChoices);
      return;
    }

    if ((p1Forced || p2Forced) &&
      hasAllChoices(battle, 'p1', p1ChoicesRef.current) &&
      hasAllChoices(battle, 'p2', p2ChoicesRef.current)) {
      void executeTurn();
      return;
    }

    setSimState(prev => prev ? {
      ...prev,
      p1Choice: p1ChoicesRef.current[0] ?? null,
      p1Choices: [...p1ChoicesRef.current],
      p2Choice: p2ChoicesRef.current[0] ?? null,
      p2Choices: [...p2ChoicesRef.current],
    } : null);
  }, [executeForcedSide, executeTurn, refs, executingRef, battleStreamRef, branchEngineRef, p1ChoicesRef, p2ChoicesRef,
    setExecuteError, setSimState]);
}

/** The execute side of the branch: turn execution, forced-switch interludes, and choice recording. */
export function useBranchExecute(refs: BranchRefs, setters: BranchSetters, clearChoices: () => void) {
  const executeTurn = useExecuteTurn(refs, setters, clearChoices);
  const executeForcedSide = useExecuteForcedSide(refs, setters);
  const setChoice = useSetChoice(refs, setters, executeTurn, executeForcedSide);
  return { executeTurn, setChoice };
}
