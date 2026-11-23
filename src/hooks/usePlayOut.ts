import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { EvalResult, RankedChoice } from '@fulllifegames/eval-engine';
import { FAST_PLAY_OUT_SETTINGS, nextPlayOutStep, playOutDoneText, prefsAfterRun } from '../lib/play-out';
import type { useBranch } from './useBranch';
import { forceSwitches } from './branch/shared';
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
  /** Stop was pressed with a turn in flight; the run ends when that turn landed. */
  stopping?: { text: string; navigated: boolean } | null;
}

export interface PlayOutInputs {
  playOut: PlayOutState | null;
  setPlayOut: Dispatch<SetStateAction<PlayOutState | null>>;
  setPlayOutNotice: (notice: { text: string; watchTurn: number } | null) => void;
  playOutProcessedRef: MutableRefObject<EvalResult | null>;
  playOutRef: MutableRefObject<{ active: boolean; stopping?: { navigated: boolean } | null } | null>;
  stopPlayOutRef: MutableRefObject<((opts?: { navigated?: boolean }) => void) | null>;
  evaluation: Evaluation;
  fastPlayOut: boolean;
  /** The live sim's position, which the loop plays on whatever the pointer shows (null: no variation yet). */
  tip: { key: string } | null;
  tipEvalStatus: Evaluation['status'];
  liveTip: boolean;
  viewingVariation: boolean;
  atEndPosition: boolean;
  viewT0: boolean;
  viewTurn: number;
  tipTurn: number | null;
  holdTipFollow: () => void;
  navigateTo: (position: { turn: number; line: 'main' | 'variation' }, opts?: { seek?: boolean; internal?: boolean; toFrame?: true | number }) => void;
  setNavSeek: Dispatch<SetStateAction<{ turn: number; seq: number; play?: boolean } | null>>;
  executing: boolean;
  executeError: string | null;
  branchPreparing: boolean;
  getBattle: Branch['getBattle'];
  executeTurn: Branch['executeTurn'];
  handleEvaluate: () => void;
  applyEvalChoice: (side: 'p1' | 'p2', ranked: RankedChoice) => boolean;
  requestDeviation: (prefill: null, opts?: { onStart?: () => void }) => void;
  startLeadVariation: (leads: LeadSelection, opts?: { onStart?: () => void }) => void;
  /** The lead picker's complete selection while the turn 0 view shows it, else null (set by LeadPanel). */
  leadPicksRef: MutableRefObject<LeadSelection | null>;
  setVariationNotice: (notice: string | null) => void;
}

function usePlayOutFinish(args: PlayOutInputs) {
  const { evaluation, setPlayOut, setPlayOutNotice, playOutRef, navigateTo, setNavSeek, tipTurn, playOut, holdTipFollow, executing } = args;
  const finishPlayOut = useCallback((current: PlayOutState, text: string, opts?: { navigated?: boolean }) => {
    const restored = prefsAfterRun(evaluation.prefs, current);
    if (restored) evaluation.setPrefs(restored);
    evaluation.setEngineOverride(null);
    playOutRef.current = null;
    holdTipFollow();
    setPlayOut(null);
    setPlayOutNotice({ text, watchTurn: current.startTurn });
    // The run leaves the frame where the user watches it; a finish after the user's own navigation leaves the pointer where they put it.
    if (!opts?.navigated && current.turns > 0) {
      navigateTo({ turn: tipTurn ?? current.startTurn, line: 'variation' }, { seek: false, internal: true, toFrame: true });
    }
  }, [evaluation, setPlayOut, setPlayOutNotice, playOutRef, navigateTo, holdTipFollow, tipTurn]);

  const stopPlayOut = useCallback((opts?: { navigated?: boolean }) => {
    if (!playOut) return;
    const navigated = !!opts?.navigated;
    if (playOut.stopping) {
      if (navigated && !playOut.stopping.navigated) setPlayOut({ ...playOut, stopping: { ...playOut.stopping, navigated } });
      return;
    }
    const text = `Play-out stopped: ${playOut.turns} turn${playOut.turns === 1 ? '' : 's'} played (they stay in the variation).`;
    if (executing) {
      // The turn in flight lands after the click: the run stays active, so the frame keeps appending in 'hold' (no seek, no play,
      // no follow-end), and the timeline's tip-follow lets the turn land where the user is not looking.
      holdTipFollow();
      setPlayOut({ ...playOut, stopping: { text, navigated } });
      return;
    }
    finishPlayOut(playOut, text, opts);
  }, [playOut, executing, holdTipFollow, setPlayOut, finishPlayOut]);

  const stopping = playOut?.stopping ?? null;
  useEffect(() => {
    if (playOut && stopping && !executing) finishPlayOut(playOut, stopping.text, { navigated: stopping.navigated });
  }, [playOut, stopping, executing, finishPlayOut]);

  /** Seeks the branch frame to the play-out's start and lets it play; the pointer takes that turn's variation position, not the tip. */
  const watchFrom = useCallback((turn: number) => {
    navigateTo({ turn, line: 'variation' }, { seek: false, internal: true, toFrame: turn });
    window.setTimeout(() => {
      setNavSeek(prev => ({ turn, seq: (prev?.seq ?? 0) + 1, play: true }));
    }, 250);
  }, [navigateTo, setNavSeek]);

  return { finishPlayOut, stopPlayOut, watchFrom };
}

function useStartPlayOut(args: PlayOutInputs) {
  const {
    evaluation, fastPlayOut, setPlayOut, setPlayOutNotice, playOutProcessedRef,
    viewT0, startLeadVariation, leadPicksRef, setVariationNotice,
    liveTip, viewingVariation, atEndPosition, requestDeviation, handleEvaluate, viewTurn,
  } = args;
  return useCallback(() => {
    const pinEngine = () => evaluation.setEngineOverride(fastPlayOut ? FAST_PLAY_OUT_SETTINGS : null);
    const armRun = (startTurn: number) => {
      const prevAuto = evaluation.prefs.auto;
      if (!prevAuto) evaluation.setPrefs({ ...evaluation.prefs, auto: true });
      pinEngine();
      playOutProcessedRef.current = null;
      setPlayOutNotice(null);
      setPlayOut({ active: true, executed: 0, turns: 0, startTurn, prevAuto });
    };
    // Turn 0: the run includes the lead decision and plays from the leads the picker shows, through "Play from turn 0" (its replace
    // confirm guards a standing variation). Branching at the shared turn-1 prefix gave a variation without its turn 0.
    if (viewT0) {
      const picks = leadPicksRef.current;
      if (!picks) {
        setVariationNotice('Finish the lead picks above before the engine plays from turn 0.');
        return;
      }
      // The run arms with turn 0, the turn the leads come in: the progress line and the notice name it, and Watch from turn 0 plays
      // the frame from its team preview while the pointer reads T1 (the line has no turn 0).
      startLeadVariation(picks, { onStart: () => armRun(0) });
      return;
    }
    if (!liveTip && !viewingVariation && atEndPosition) {
      requestDeviation(null);
      return;
    }
    const startTurn = viewTurn;
    const arm = () => armRun(startTurn);
    // Same gates as any deviation: rebuild to here first when the live sim stands elsewhere; the run arms after the replace confirm's yes.
    if (!liveTip) {
      requestDeviation(null, { onStart: arm });
      return;
    }
    arm();
    handleEvaluate();
  }, [
    viewT0, startLeadVariation, leadPicksRef, setVariationNotice, liveTip,
    viewingVariation, atEndPosition, requestDeviation, evaluation, fastPlayOut, handleEvaluate, viewTurn,
    setPlayOut, setPlayOutNotice, playOutProcessedRef,
  ]);
}

/** The loop: kick a fresh arm, step on completed evals, end on eval errors; it reads the live sim's tip, not the pointer. */
function usePlayOutLoop(args: PlayOutInputs, finishPlayOut: ReturnType<typeof usePlayOutFinish>['finishPlayOut']) {
  const {
    playOut, setPlayOut, playOutProcessedRef, evaluation, tip, tipEvalStatus,
    liveTip, executing, executeError, branchPreparing, getBattle, executeTurn, handleEvaluate, applyEvalChoice, playOutRef,
  } = args;
  // Set while the run waits on a forced replacement it submitted; a refusal arrives through `executeError` and the position does
  // not change, so no evaluation would end the wait.
  const forcedPendingRef = useRef(false);
  // The run reads the live sim's tip once the pointer has stood on it. A run armed off the tip waits for the rebuild that replaces
  // the variation; after that a frame report that moves the pointer elsewhere does not stop it.
  const reachedTipRef = useRef(false);
  useEffect(() => {
    if (!playOut?.active) reachedTipRef.current = false;
    else if (liveTip) reachedTipRef.current = true;
  }, [playOut?.active, liveTip]);
  /**
   * A play-out started from the main line arms before its rebuild finishes, and entering branch mode resets the eval to 'idle',
   * which the auto-eval effect (stale only) never picks up: without this kick the loop shows "0 turns played" forever. Fires once
   * the live tip stands and no evaluation is in flight.
   */
  useEffect(() => {
    const runTip = runTipOf(tip, liveTip || reachedTipRef.current);
    if (!playOut?.active || playOut.stopping || !runTip || executing || branchPreparing) return;
    // Auto evaluates a stale position (the run switched it on); asking here too would send two evaluations per position. Only a
    // user who turned Auto off mid-run leaves the kick to us.
    const autoCovers = tipEvalStatus === 'stale' && evaluation.prefs.auto;
    if ((tipEvalStatus !== 'idle' && tipEvalStatus !== 'stale') || autoCovers) return;
    handleEvaluate();
  }, [playOut?.active, playOut?.stopping, tip, liveTip, executing, branchPreparing, tipEvalStatus, evaluation.prefs.auto, handleEvaluate]);

  useEffect(() => {
    const runTip = runTipOf(tip, liveTip || reachedTipRef.current);
    if (!playOut?.active || playOut.stopping || !runTip || executing || branchPreparing) return;
    if (evaluation.status !== 'done' || !evaluation.result) return;
    if (evaluation.resultTag !== null && evaluation.resultTag !== runTip.key) return;
    if (playOutProcessedRef.current === evaluation.result) return;
    playOutProcessedRef.current = evaluation.result;
    forcedPendingRef.current = false;
    const battle = getBattle();
    const step = nextPlayOutStep(evaluation.result, battle?.ended ?? false, playOut.executed);
    applyLoopStep({ step, interlude: bothSidesReplace(battle), playOut, playOutRef, forcedPendingRef, finishPlayOut, applyEvalChoice, setPlayOut, executeTurn });
  }, [playOut, tip, liveTip, executing, branchPreparing, evaluation.status, evaluation.result, evaluation.resultTag, getBattle, applyEvalChoice, executeTurn, finishPlayOut, playOutProcessedRef, playOutRef, setPlayOut]);

  useEffect(() => {
    if (!playOut?.active) {
      forcedPendingRef.current = false;
      return;
    }
    if (playOut.stopping || executing || !forcedPendingRef.current || !executeError) return;
    forcedPendingRef.current = false;
    finishPlayOut(playOut, `Play-out stopped after ${playOut.turns} turn${playOut.turns === 1 ? '' : 's'}: the forced replacement could not be played (${withoutFullStop(executeError)}).`);
  }, [playOut, executing, executeError, finishPlayOut]);

  /** An evaluation that fails (worker error, reconstruction refusal) ends the run with its reason; else "Engine is playing…" stays. */
  useEffect(() => {
    if (!playOut?.active || playOut.stopping || executing || branchPreparing) return;
    if (evaluation.status !== 'error') return;
    finishPlayOut(playOut, `Play-out stopped after ${playOut.turns} turn${playOut.turns === 1 ? '' : 's'}: the evaluation failed here${evaluation.error ? ` (${evaluation.error})` : ''}.`);
  }, [playOut, executing, branchPreparing, evaluation.status, evaluation.error, finishPlayOut]);
}

function runTipOf(tip: PlayOutInputs['tip'], reached: boolean): PlayOutInputs['tip'] {
  return reached ? tip : null;
}

/** The simulator's reasons end in a full stop; inside the notice's parentheses it would read ").)." */
function withoutFullStop(reason: string): string {
  return reason.replace(/\.\s*$/, '');
}

/** The position waits for a replacement on both sides, so the pair the loop plays is an interlude: the battle's turn does not move
 *  and the variation gains no turn (`variation-turns.ts` leaves the same entry out of its count). */
function bothSidesReplace(battle: ReturnType<Branch['getBattle']>): boolean {
  if (!battle?.sides) return false;
  return (['p1', 'p2'] as const).every(side => forceSwitches(battle, side).some(Boolean));
}

function applyLoopStep(args: {
  step: ReturnType<typeof nextPlayOutStep>;
  interlude: boolean;
  playOut: PlayOutState;
  playOutRef: PlayOutInputs['playOutRef'];
  forcedPendingRef: MutableRefObject<boolean>;
  finishPlayOut: (current: PlayOutState, text: string, opts?: { navigated?: boolean }) => void;
  applyEvalChoice: PlayOutInputs['applyEvalChoice'];
  setPlayOut: PlayOutInputs['setPlayOut'];
  executeTurn: PlayOutInputs['executeTurn'];
}) {
  const { step, interlude, playOut, playOutRef, forcedPendingRef, finishPlayOut, applyEvalChoice, setPlayOut, executeTurn } = args;
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
    setPlayOut({ ...playOut, executed: playOut.executed + 1, turns: playOut.turns + (interlude ? 0 : 1) });
    // The next position is evaluated once the turn landed, by the Auto pref or, with Auto off, by the kick effect; a call here
    // would use the closure of the turn before and tag the result with the old position.
    void executeTurn().then(error => {
      // A finish that came first (Stop, a navigation) owns the notice; a stop that waits for this turn keeps the user's navigation.
      const live = playOutRef.current;
      if (error && live?.active) {
        finishPlayOut(playOut, `Play-out stopped after ${playOut.turns} turn${playOut.turns === 1 ? '' : 's'}: the turn could not be played (${withoutFullStop(error)}).`, { navigated: !!live.stopping?.navigated });
      }
    });
    return;
  }
  // A forced side: setChoice auto-executes forced replacements and the auto pref re-evaluates; it counts as a step for the safety
  // cap, not as a played turn.
  if (!applyEvalChoice(step.side, step.choice)) {
    finishPlayOut(playOut, `Play-out stopped after ${playOut.turns} turn${turnWord}: the forced replacement could not be submitted.`);
    return;
  }
  forcedPendingRef.current = true;
  setPlayOut({ ...playOut, executed: playOut.executed + 1 });
}

export function usePlayOut(inputs: PlayOutInputs) {
  const { playOutRef, stopPlayOutRef, playOut } = inputs;
  const { finishPlayOut, stopPlayOut, watchFrom } = usePlayOutFinish(inputs);
  const startPlayOut = useStartPlayOut(inputs);
  usePlayOutLoop(inputs, finishPlayOut);
  // The pinned engine lives as long as the run: a replay change drops the run without the finish path and must release it too.
  const { setEngineOverride } = inputs.evaluation;
  useEffect(() => {
    if (!playOut?.active) setEngineOverride(null);
  }, [playOut?.active, setEngineOverride]);
  // The mirrors are written after commit: navigateTo's interrupt reads them at event time, and a render-phase write trips the
  // react-hooks refs rule.
  useEffect(() => {
    playOutRef.current = playOut;
    stopPlayOutRef.current = stopPlayOut;
  });
  return { startPlayOut, stopPlayOut, watchFrom };
}
