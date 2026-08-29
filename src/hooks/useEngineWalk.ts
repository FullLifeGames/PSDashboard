import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { EvalResult, RankedChoice } from '../lib/eval/types';
import { evalChoiceToSlotChoices, requiredChoicesForActiveSlots, type BranchSlotChoice } from '../lib/branch-choices';
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

/** Maps an engine choice string onto the live pickers, slot-aligned. */
function useApplyEvalChoice(simState: BranchSimState | null, handleSetChoice: EngineWalkInputs['handleSetChoice']) {
  return useCallback((side: 'p1' | 'p2', ranked: RankedChoice): boolean => {
    if (!simState) return false;
    const movesBySlot = side === 'p1' ? simState.p1MovesBySlot : simState.p2MovesBySlot;
    const switchesBySlot = side === 'p1' ? simState.p1SwitchesBySlot : simState.p2SwitchesBySlot;
    // The engine's choice string carries one part per slot WITH choices —
    // a doubles forced replacement is a single part that belongs to the
    // forced slot, so the mask aligns parts with the request's slots.
    const activeSlots = side === 'p1' ? simState.p1ActiveSlots : simState.p2ActiveSlots;
    const forcedSlots = side === 'p1' ? simState.p1ForceSwitches : simState.p2ForceSwitches;
    const mask = requiredChoicesForActiveSlots(
      activeSlots.map(active => (active ? { fainted: active.fainted } : null)),
      forcedSlots,
    );
    const slotChoices = evalChoiceToSlotChoices(ranked.choice, movesBySlot, switchesBySlot, ranked.label, mask);
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

/** Chess-style walk: clicking an engine line PLAYS THE TURN OUT — the
 *  clicked side commits its line, the other side answers with the engine's
 *  top reply, the turn executes, and the result re-evaluates. */
function usePlayTurnOut(args: EngineWalkInputs & {
  applyEvalChoice: ReturnType<typeof useApplyEvalChoice>;
  walkInterludeRef: MutableRefObject<boolean>;
}) {
  const {
    evaluation, applyEvalChoice, walkInterludeRef, getBattle, setBranchDivergence, executeTurn, handleEvaluate,
  } = args;
  return useCallback((side: 'p1' | 'p2', ranked: RankedChoice, reply: RankedChoice | null) => {
    // A diverged/finished branch sim cannot accept choices — refuse with the
    // divergence notice instead of letting the sim reject confusingly.
    if (getBattle()?.ended) {
      setBranchDivergence(previous => previous ??
        'The simulated replay already ended; recommendations cannot be played out in this diverged line.');
      return;
    }
    if (!applyEvalChoice(side, ranked)) return;
    const other = side === 'p1' ? 'p2' : 'p1';
    // The top reply can fail to map onto the live pickers (label/slot
    // mismatches) — walking down the ranked list keeps the click playing a
    // full turn instead of silently stalling on a prefilled half-choice.
    const replies = [
      ...(reply ? [reply] : []),
      ...(evaluation.result?.perSide[other] ?? []),
    ].filter(candidate => candidate.choice !== 'wait');
    for (const candidate of replies) {
      if (applyEvalChoice(other, candidate)) {
        // Mid-turn KOs pause the sim on a forced replacement — the walk
        // finishes those interludes with the engine's answer (effect below).
        walkInterludeRef.current = true;
        void executeTurn().then(() => handleEvaluate());
        return;
      }
    }
    // No engine reply to commit (forced-switch positions execute through
    // setChoice on their own) — show the engine's view of what stands.
    handleEvaluate();
  }, [applyEvalChoice, walkInterludeRef, evaluation.result, getBattle, executeTurn, handleEvaluate, setBranchDivergence]);
}

function useChessWalk(args: EngineWalkInputs & {
  applyEvalChoice: ReturnType<typeof useApplyEvalChoice>;
  walkInterludeRef: MutableRefObject<boolean>;
}) {
  const { evaluation, liveTip, simState, requestDeviation, branching, branchPreparing, confirmOpen } = args;
  const playOutEvalChoice = usePlayTurnOut(args);

  // The queued pick lives in a ref (the effect below only ACTS, it never
  // sets state — the react-hooks gate); the version state re-arms the
  // effect when a pick is queued.
  const pendingPickRef = useRef<{ side: 'p1' | 'p2'; ranked: RankedChoice; reply: RankedChoice | null } | null>(null);
  const [pickVersion, setPickVersion] = useState(0);

  const handleExploreChoice = useCallback((side: 'p1' | 'p2', ranked: RankedChoice, reply?: RankedChoice | null) => {
    // The walk re-evaluates after every executed turn — surface that as the
    // visible Auto setting rather than a hidden mode.
    if (!evaluation.prefs.auto) evaluation.setPrefs({ ...evaluation.prefs, auto: true });
    if (liveTip && simState) {
      playOutEvalChoice(side, ranked, reply ?? null);
      return;
    }
    // Any other position: the deviation flow rebuilds the sim there (chess
    // rules incl. the replace confirm) and the pending pick plays out once
    // the pointer sits on the live tip again.
    pendingPickRef.current = { side, ranked, reply: reply ?? null };
    setPickVersion(version => version + 1);
    requestDeviation(null);
  }, [liveTip, simState, playOutEvalChoice, requestDeviation, evaluation]);

  // A matrix cell names BOTH sides' choices — play exactly that pair out.
  const handlePickPair = useCallback((p1: { choice: string; label: string }, p2: { choice: string; label: string }) => {
    const rankedLike = (entry: { choice: string; label: string }): RankedChoice =>
      ({ choice: entry.choice, label: entry.label, worstCase: 0, expected: 0, ev: 0, punishedBy: null });
    handleExploreChoice('p1', rankedLike(p1), rankedLike(p2));
  }, [handleExploreChoice]);

  useEffect(() => {
    const pendingEvalPick = pendingPickRef.current;
    if (!pendingEvalPick) return;
    // Wait until the rebuild landed the pointer ON the live sim — applying
    // earlier would play the pick into whatever position the OLD sim held.
    if (liveTip && simState && !branchPreparing && !confirmOpen) {
      pendingPickRef.current = null;
      playOutEvalChoice(pendingEvalPick.side, pendingEvalPick.ranked, pendingEvalPick.reply);
    } else if (!branching && !branchPreparing && !confirmOpen) {
      // Branch entry failed or was cancelled — drop the stale pick.
      pendingPickRef.current = null;
    }
  }, [pickVersion, liveTip, simState, branching, branchPreparing, confirmOpen, playOutEvalChoice]);

  const clearPendingPick = useCallback(() => {
    pendingPickRef.current = null;
  }, []);
  return { playOutEvalChoice, handleExploreChoice, handlePickPair, clearPendingPick };
}

/**
 * Chess-walk interlude completion: after a clicked engine line executes,
 * a mid-turn KO leaves the sim waiting on a forced replacement. While
 * armed, one-sided positions (only forced replacements rank — the other
 * side 'wait's) auto-play the engine's top answer; the first two-sided
 * position is the next real decision point and disarms the walk.
 */
/** The one-sided answer an armed walk should auto-play, or the reason to
 *  disarm ('two-sided' reaches the next real decision point). */
function interludeStep(result: EvalResult): { side: 'p1' | 'p2'; choice: RankedChoice } | 'disarm' {
  const p1 = result.perSide.p1.find(choice => choice.choice !== 'wait') ?? null;
  const p2 = result.perSide.p2.find(choice => choice.choice !== 'wait') ?? null;
  if (p1 && p2) return 'disarm';
  if (p1) return { side: 'p1', choice: p1 };
  if (p2) return { side: 'p2', choice: p2 };
  return 'disarm';
}

function useWalkInterlude(args: EngineWalkInputs & {
  applyEvalChoice: ReturnType<typeof useApplyEvalChoice>;
  walkInterludeRef: MutableRefObject<boolean>;
}) {
  const {
    evaluation, applyEvalChoice, walkInterludeRef, playOutActive, liveTip, executing,
    branchPreparing, evalViewKey, getBattle,
  } = args;
  const walkProcessedRef = useRef<EvalResult | null>(null);
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
    // setChoice auto-executes forced replacements; the auto pref re-evaluates
    // once the entry lands, which re-enters this effect until two-sided.
  }, [playOutActive, liveTip, executing, branchPreparing, evaluation.status, evaluation.result, evaluation.resultTag, evalViewKey, getBattle, applyEvalChoice, walkInterludeRef]);
}

export function useEngineWalk(inputs: EngineWalkInputs) {
  const applyEvalChoice = useApplyEvalChoice(inputs.simState, inputs.handleSetChoice);
  // Armed by a clicked engine line whose turn executed — see the interlude
  // completion effect.
  const walkInterludeRef = useRef(false);
  const walk = useChessWalk({ ...inputs, applyEvalChoice, walkInterludeRef });
  useWalkInterlude({ ...inputs, applyEvalChoice, walkInterludeRef });
  return { applyEvalChoice, ...walk };
}
