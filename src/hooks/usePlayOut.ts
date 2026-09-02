import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { EvalResult, RankedChoice } from '../lib/eval/types';
import { nextPlayOutStep, playOutDoneText } from '../lib/play-out';
import type { VariationSpan } from '../lib/timeline';
import type { useBranch } from './useBranch';
import type { useEvaluation } from './useEvaluation';
import type { LeadSelection } from './useDeviation';

type Branch = ReturnType<typeof useBranch>;
type Evaluation = ReturnType<typeof useEvaluation>;

interface PlayOutState {
  active: boolean;
  executed: number;
  turns: number;
  startTurn: number;
  prevAuto: boolean;
}

export interface PlayOutInputs {
  playOut: PlayOutState | null;
  setPlayOut: Dispatch<SetStateAction<PlayOutState | null>>;
  setPlayOutNotice: (notice: { text: string; watchTurn: number } | null) => void;
  playOutProcessedRef: MutableRefObject<EvalResult | null>;
  /** App-level mirrors the timeline's navigation interrupt reads. */
  playOutRef: MutableRefObject<{ active: boolean } | null>;
  stopPlayOutRef: MutableRefObject<((opts?: { returnToStart?: boolean }) => void) | null>;
  evaluation: Evaluation;
  evalViewKey: string;
  liveEvalStatus: Evaluation['status'];
  liveTip: boolean;
  viewingVariation: boolean;
  atEndPosition: boolean;
  viewT0: boolean;
  viewTurn: number;
  variationSpan: VariationSpan | null;
  tipTurn: number | null;
  navigateTo: (position: { turn: number; line: 'main' | 'variation' }, opts?: { seek?: boolean; internal?: boolean }) => void;
  setNavSeek: Dispatch<SetStateAction<{ turn: number; seq: number; play?: boolean } | null>>;
  setVariationScores: Dispatch<SetStateAction<(number | null)[]>>;
  executing: boolean;
  branchPreparing: boolean;
  getBattle: Branch['getBattle'];
  executeTurn: Branch['executeTurn'];
  handleEvaluate: () => void;
  applyEvalChoice: (side: 'p1' | 'p2', ranked: RankedChoice) => boolean;
  rebuildAt: (position: { turn: number; line: 'main' | 'variation' }, prefill: null) => Promise<void>;
  requestDeviation: (prefill: null) => void;
  startLeadVariation: (leads: LeadSelection, opts?: { onStart?: () => void }) => void;
  defaultLeadSelection: () => LeadSelection;
}

/** Finish/stop plumbing plus the watch-from-turn seek. */
function usePlayOutFinish(args: PlayOutInputs) {
  const { evaluation, setPlayOut, setPlayOutNotice, playOutRef, navigateTo, setNavSeek, tipTurn, playOut } = args;
  const finishPlayOut = useCallback((current: PlayOutState, text: string, opts?: { returnToStart?: boolean }) => {
    if (!current.prevAuto) evaluation.setPrefs({ ...evaluation.prefs, auto: false });
    playOutRef.current = null;
    setPlayOut(null);
    setPlayOutNotice({ text, watchTurn: current.startTurn });
    // The engine's play dragged the pointer along to the tip; hand the view
    // back to the turn the run started from — the user replays the line
    // from there themselves (the Watch button, or just pressing play).
    if ((opts?.returnToStart ?? true) && current.turns > 0) {
      navigateTo({ turn: current.startTurn, line: 'variation' }, { seek: true, internal: true });
    }
  }, [evaluation, setPlayOut, setPlayOutNotice, playOutRef, navigateTo]);

  const stopPlayOut = useCallback((opts?: { returnToStart?: boolean }) => {
    if (playOut) {
      finishPlayOut(playOut, `Play-out stopped: ${playOut.turns} turn${playOut.turns === 1 ? '' : 's'} played (they stay in the variation).`, opts);
    }
  }, [playOut, finishPlayOut]);

  /** Seek the branch frame to the play-out's start and let it play — the
   *  point of the feature: watch how the game runs on from your move. */
  const watchFrom = useCallback((turn: number) => {
    if (tipTurn !== null) navigateTo({ turn: tipTurn, line: 'variation' }, { seek: false, internal: true });
    window.setTimeout(() => {
      setNavSeek(prev => ({ turn, seq: (prev?.seq ?? 0) + 1, play: true }));
    }, 250);
  }, [navigateTo, tipTurn, setNavSeek]);

  return { finishPlayOut, stopPlayOut, watchFrom };
}

/** Arms the loop from whatever position the pointer holds (T0 included). */
function useStartPlayOut(args: PlayOutInputs) {
  const {
    evaluation, setPlayOut, setPlayOutNotice, playOutProcessedRef, setVariationScores,
    viewT0, variationSpan, rebuildAt, startLeadVariation, defaultLeadSelection,
    liveTip, viewingVariation, atEndPosition, requestDeviation, handleEvaluate, viewTurn,
  } = args;
  return useCallback(() => {
    // Turn 0: the run INCLUDES the lead decision. Branching at the shared
    // turn-1 prefix instead produced a variation without its turn 0 — the
    // moves list started at turn 1 and viewing turn 1 fell back to the main
    // line (coverage begins one turn after the branch point).
    if (viewT0) {
      const arm = () => {
        const prevAuto = evaluation.prefs.auto;
        if (!prevAuto) evaluation.setPrefs({ ...evaluation.prefs, auto: true });
        playOutProcessedRef.current = null;
        setPlayOutNotice(null);
        setPlayOut({ active: true, executed: 0, turns: 0, startTurn: 1, prevAuto });
      };
      if (variationSpan?.startTurn === 0) {
        // A lead variation stands: keep its turn-0 decision, cut the tail
        // (the chess truncate), and let the engine play the game again.
        arm();
        setVariationScores(previous => previous.map((value, index) => (index + 1 > 1 ? null : value)));
        void rebuildAt({ turn: 1, line: 'variation' }, null);
        return;
      }
      // No lead variation yet: seed one with the picker's default (the real
      // game's leads and bring). The replace-confirm still guards an
      // existing variation — arming waits for the user's yes.
      startLeadVariation(defaultLeadSelection(), { onStart: arm });
      return;
    }
    // The post-battle sentinel has nothing to play — surface the existing
    // refusal instead of arming a loop that can never start.
    if (!liveTip && !viewingVariation && atEndPosition) {
      requestDeviation(null);
      return;
    }
    // Same gates as any deviation: rebuild to here first when the live sim
    // stands elsewhere (incl. the replace confirm on the main line).
    if (!liveTip) requestDeviation(null);
    const prevAuto = evaluation.prefs.auto;
    // The loop advances on completed evals — auto keeps them coming after
    // forced interludes; the user's own setting is restored at the end.
    if (!prevAuto) evaluation.setPrefs({ ...evaluation.prefs, auto: true });
    playOutProcessedRef.current = null;
    setPlayOutNotice(null);
    setPlayOut({ active: true, executed: 0, turns: 0, startTurn: viewTurn, prevAuto });
    if (liveTip) handleEvaluate();
  }, [
    viewT0, variationSpan, rebuildAt, startLeadVariation, defaultLeadSelection, liveTip,
    viewingVariation, atEndPosition, requestDeviation, evaluation, handleEvaluate, viewTurn,
    setPlayOut, setPlayOutNotice, playOutProcessedRef, setVariationScores,
  ]);
}

/** The loop itself: kick a fresh arm, step on completed evals, end on
 *  eval errors — all only while the pointer sits on the live tip. */
function usePlayOutLoop(args: PlayOutInputs, finishPlayOut: ReturnType<typeof usePlayOutFinish>['finishPlayOut']) {
  const {
    playOut, setPlayOut, playOutProcessedRef, evaluation, evalViewKey, liveEvalStatus,
    liveTip, executing, branchPreparing, getBattle, executeTurn, handleEvaluate, applyEvalChoice,
  } = args;
  /**
   * A play-out started from the MAIN LINE arms before its rebuild finishes —
   * startPlayOut cannot evaluate a sim that does not exist yet, and entering
   * branch mode resets the eval to 'idle', which the auto-eval effect (stale
   * only) never picks up. Without this kick the loop showed "0 turns played"
   * forever. Fires once the live tip stands and no evaluation is in flight.
   */
  useEffect(() => {
    if (!playOut?.active || !liveTip || executing || branchPreparing) return;
    if (liveEvalStatus !== 'idle' && liveEvalStatus !== 'stale') return;
    handleEvaluate();
  }, [playOut?.active, liveTip, executing, branchPreparing, liveEvalStatus, handleEvaluate]);

  useEffect(() => {
    if (!playOut?.active || !liveTip || executing || branchPreparing) return;
    if (evaluation.status !== 'done' || !evaluation.result) return;
    // A result finished for another position (navigation race, pre-play-out
    // leftovers) must never be played from here — the tip's own eval follows.
    if (evaluation.resultTag !== null && evaluation.resultTag !== evalViewKey) return;
    if (playOutProcessedRef.current === evaluation.result) return;
    playOutProcessedRef.current = evaluation.result;
    const step = nextPlayOutStep(evaluation.result, getBattle()?.ended ?? false, playOut.executed);
    applyLoopStep({ step, playOut, finishPlayOut, applyEvalChoice, setPlayOut, executeTurn, handleEvaluate });
  }, [playOut, liveTip, executing, branchPreparing, evaluation.status, evaluation.result, evaluation.resultTag, evalViewKey, getBattle, applyEvalChoice, executeTurn, handleEvaluate, finishPlayOut, playOutProcessedRef, setPlayOut]);

  /**
   * The loop advances on COMPLETED evaluations — an evaluation that fails
   * (worker error, reconstruction refusal) used to leave "Engine is
   * playing…" stuck forever with no message. End the run with its reason.
   */
  useEffect(() => {
    if (!playOut?.active || executing || branchPreparing) return;
    if (evaluation.status !== 'error') return;
    finishPlayOut(playOut, `Play-out stopped after ${playOut.turns} turn${playOut.turns === 1 ? '' : 's'}: the evaluation failed here${evaluation.error ? ` (${evaluation.error})` : ''}.`);
  }, [playOut, executing, branchPreparing, evaluation.status, evaluation.error, finishPlayOut]);
}

/** One loop step: end the run, play a full pair, or submit the forced side. */
function applyLoopStep(args: {
  step: ReturnType<typeof nextPlayOutStep>;
  playOut: PlayOutState;
  finishPlayOut: (current: PlayOutState, text: string) => void;
  applyEvalChoice: PlayOutInputs['applyEvalChoice'];
  setPlayOut: PlayOutInputs['setPlayOut'];
  executeTurn: PlayOutInputs['executeTurn'];
  handleEvaluate: PlayOutInputs['handleEvaluate'];
}) {
  const { step, playOut, finishPlayOut, applyEvalChoice, setPlayOut, executeTurn, handleEvaluate } = args;
  const turnWord = playOut.turns === 1 ? '' : 's';
  if (step.kind === 'done') {
    finishPlayOut(playOut, playOutDoneText(step.reason, playOut.turns));
    return;
  }
  if (step.kind === 'pair') {
    if (!applyEvalChoice('p1', step.p1) || !applyEvalChoice('p2', step.p2)) {
      finishPlayOut(playOut, `Play-out stopped after ${playOut.turns} turn${turnWord}: the engine's choice was not playable at this position.`);
      return;
    }
    setPlayOut({ ...playOut, executed: playOut.executed + 1, turns: playOut.turns + 1 });
    void executeTurn().then(() => handleEvaluate());
    return;
  }
  // Single (forced) side: setChoice auto-executes forced replacements and
  // the auto pref re-evaluates once the entry lands. Counts as a step for
  // the safety cap, not as a played turn.
  if (!applyEvalChoice(step.side, step.choice)) {
    finishPlayOut(playOut, `Play-out stopped after ${playOut.turns} turn${turnWord}: the forced replacement could not be submitted.`);
    return;
  }
  setPlayOut({ ...playOut, executed: playOut.executed + 1 });
}

export function usePlayOut(inputs: PlayOutInputs) {
  const { playOutRef, stopPlayOutRef, playOut } = inputs;
  const { finishPlayOut, stopPlayOut, watchFrom } = usePlayOutFinish(inputs);
  const startPlayOut = useStartPlayOut(inputs);
  usePlayOutLoop(inputs, finishPlayOut);
  // Keep the render-independent mirrors in sync post-commit (navigateTo's
  // interrupt reads them at event time; a render-phase write would trip the
  // react-hooks refs rule).
  useEffect(() => {
    playOutRef.current = playOut;
    stopPlayOutRef.current = stopPlayOut;
  });
  return { startPlayOut, stopPlayOut, watchFrom };
}
