import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { EvalResult, RankedChoice, BranchSlotChoice } from '@fulllifegames/eval-engine';
import { slotChoicesOf } from '../lib/dock-fill';
import { worstReply } from '../lib/worst-reply';
import type { BranchSimState, useBranch } from './useBranch';
import type { useEvaluation } from './useEvaluation';

type Branch = ReturnType<typeof useBranch>;
type Evaluation = ReturnType<typeof useEvaluation>;

export interface EngineWalkInputs {
  simState: BranchSimState | null;
  liveTip: boolean;
  branching: boolean;
  branchPreparing: boolean;
  executing: boolean;
  confirmOpen: boolean;
  playOutActive: boolean;
  evaluation: Evaluation;
  evalViewKey: string;
  getBattle: Branch['getBattle'];
  executeTurn: Branch['executeTurn'];
  handleEvaluate: () => void;
  handleSetChoice: (side: 'p1' | 'p2', choice: BranchSlotChoice, activeSlot?: number) => void;
  requestDeviation: (prefill: null) => void;
  setBranchDivergence: (updater: (previous: string | null) => string | null) => void;
}

interface WalkRefs {
  walkInterludeRef: MutableRefObject<boolean>;
  walkProcessedRef: MutableRefObject<EvalResult | null>;
}

function useApplyEvalChoice(simState: BranchSimState | null, handleSetChoice: EngineWalkInputs['handleSetChoice']) {
  return useCallback((side: 'p1' | 'p2', ranked: RankedChoice): boolean => {
    if (!simState) return false;
    const slotChoices = slotChoicesOf(simState, side, ranked);
    if (!slotChoices) return false;
    let applied = false;
    slotChoices.forEach((choice, activeSlot) => {
      if (!choice) return;
      handleSetChoice(side, choice, activeSlot);
      applied = true;
    });
    return applied;
  }, [simState, handleSetChoice]);
}

function usePlayTurnOut(args: EngineWalkInputs & WalkRefs & {
  applyEvalChoice: ReturnType<typeof useApplyEvalChoice>;
}) {
  const {
    evaluation, applyEvalChoice, walkInterludeRef, walkProcessedRef, getBattle, setBranchDivergence, executeTurn, handleEvaluate,
  } = args;
  return useCallback((side: 'p1' | 'p2', ranked: RankedChoice, reply: RankedChoice | null) => {
    if (getBattle()?.ended) {
      setBranchDivergence(previous => previous ??
        'The simulated replay already ended; recommendations cannot be played out in this diverged line.');
      return;
    }
    if (!applyEvalChoice(side, ranked)) return;
    const other = side === 'p1' ? 'p2' : 'p1';
    // Walk down the ranked list: the top reply may not map onto the live pickers (label or slot mismatch).
    const replies = [
      ...(reply ? [reply] : []),
      ...(evaluation.result?.perSide[other] ?? []),
    ].filter(candidate => candidate.choice !== 'wait');
    for (const candidate of replies) {
      if (applyEvalChoice(other, candidate)) {
        // A mid-turn KO pauses the sim on a forced replacement: the interlude effect below finishes it.
        walkInterludeRef.current = true;
        // The standing result is the click's position; the interlude effect would read it as the answer and disarm.
        walkProcessedRef.current = evaluation.result;
        void executeTurn().then(() => handleEvaluate());
        return;
      }
    }
    handleEvaluate();
  }, [applyEvalChoice, walkInterludeRef, walkProcessedRef, evaluation.result, getBattle, executeTurn, handleEvaluate, setBranchDivergence]);
}

function useChessWalk(args: EngineWalkInputs & WalkRefs & {
  applyEvalChoice: ReturnType<typeof useApplyEvalChoice>;
}) {
  const { evaluation, liveTip, simState, requestDeviation, branching, branchPreparing, confirmOpen } = args;
  const playOutEvalChoice = usePlayTurnOut(args);

  const pendingPickRef = useRef<{ side: 'p1' | 'p2'; ranked: RankedChoice; reply: RankedChoice | null } | null>(null);
  const [pickVersion, setPickVersion] = useState(0);

  /** `from`: the result of an engine-move click, read for Hard mode's worst reply; a matrix pair has none. */
  const handleExploreChoice = useCallback((side: 'p1' | 'p2', ranked: RankedChoice, named?: RankedChoice | null, from?: EvalResult | null) => {
    if (!evaluation.prefs.auto) evaluation.setPrefs({ ...evaluation.prefs, auto: true });
    const reply = evaluation.prefs.hardMode && from ? worstReply(from, side, ranked)?.reply ?? named ?? null : named ?? null;
    if (liveTip && simState) {
      playOutEvalChoice(side, ranked, reply);
      return;
    }
    pendingPickRef.current = { side, ranked, reply };
    setPickVersion(version => version + 1);
    requestDeviation(null);
  }, [liveTip, simState, playOutEvalChoice, requestDeviation, evaluation]);

  const handlePickPair = useCallback((p1: { choice: string; label: string }, p2: { choice: string; label: string }) => {
    const rankedLike = (entry: { choice: string; label: string }): RankedChoice =>
      ({ choice: entry.choice, label: entry.label, worstCase: 0, expected: 0, ev: 0, punishedBy: null });
    handleExploreChoice('p1', rankedLike(p1), rankedLike(p2));
  }, [handleExploreChoice]);

  useEffect(() => {
    const pendingEvalPick = pendingPickRef.current;
    if (!pendingEvalPick) return;
    // Wait until the rebuild landed the pointer on the live sim: earlier, the pick would play into the old sim.
    if (liveTip && simState && !branchPreparing && !confirmOpen) {
      pendingPickRef.current = null;
      playOutEvalChoice(pendingEvalPick.side, pendingEvalPick.ranked, pendingEvalPick.reply);
    } else if (!branching && !branchPreparing && !confirmOpen) {
      pendingPickRef.current = null;
    }
  }, [pickVersion, liveTip, simState, branching, branchPreparing, confirmOpen, playOutEvalChoice]);

  const clearPendingPick = useCallback(() => {
    pendingPickRef.current = null;
  }, []);
  return { playOutEvalChoice, handleExploreChoice, handlePickPair, clearPendingPick };
}

// One-sided positions (only forced replacements rank) auto-play the top answer; the first two-sided one disarms.
function interludeStep(result: EvalResult): { side: 'p1' | 'p2'; choice: RankedChoice } | 'disarm' {
  const p1 = result.perSide.p1.find(choice => choice.choice !== 'wait') ?? null;
  const p2 = result.perSide.p2.find(choice => choice.choice !== 'wait') ?? null;
  if (p1 && p2) return 'disarm';
  if (p1) return { side: 'p1', choice: p1 };
  if (p2) return { side: 'p2', choice: p2 };
  return 'disarm';
}

function useWalkInterlude(args: EngineWalkInputs & WalkRefs & {
  applyEvalChoice: ReturnType<typeof useApplyEvalChoice>;
}) {
  const {
    evaluation, applyEvalChoice, walkInterludeRef, walkProcessedRef, playOutActive, liveTip, executing,
    branchPreparing, evalViewKey, getBattle,
  } = args;
  useEffect(() => {
    if (!walkInterludeRef.current || playOutActive) return;
    if (!liveTip || executing || branchPreparing) return;
    if (evaluation.status !== 'done' || !evaluation.result) return;
    if (evaluation.resultTag !== null && evaluation.resultTag !== evalViewKey) return;
    if (walkProcessedRef.current === evaluation.result) return;
    walkProcessedRef.current = evaluation.result;
    const battle = getBattle();
    if (!battle || battle.ended) {
      walkInterludeRef.current = false;
      return;
    }
    const step = interludeStep(evaluation.result);
    if (step === 'disarm' || !applyEvalChoice(step.side, step.choice)) {
      walkInterludeRef.current = false;
      return;
    }
  }, [playOutActive, liveTip, executing, branchPreparing, evaluation.status, evaluation.result, evaluation.resultTag, evalViewKey, getBattle, applyEvalChoice, walkInterludeRef, walkProcessedRef]);
}

export function useEngineWalk(inputs: EngineWalkInputs) {
  const applyEvalChoice = useApplyEvalChoice(inputs.simState, inputs.handleSetChoice);
  const walkInterludeRef = useRef(false);
  const walkProcessedRef = useRef<EvalResult | null>(null);
  const walk = useChessWalk({ ...inputs, applyEvalChoice, walkInterludeRef, walkProcessedRef });
  useWalkInterlude({ ...inputs, applyEvalChoice, walkInterludeRef, walkProcessedRef });
  return { applyEvalChoice, ...walk };
}
