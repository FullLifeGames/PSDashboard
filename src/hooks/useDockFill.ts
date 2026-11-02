import { useCallback, useEffect, useRef, useState } from 'react';
import type { BranchSimState, BranchSlotChoice, EvalResult } from '@fulllifegames/eval-engine';
import { pickFill } from '../lib/dock-fill';
import type { EvaluateOptions } from './useEvalView';
import type { useBranch } from './useBranch';
import type { useEvaluation } from './useEvaluation';

type Side = 'p1' | 'p2';
type Branch = ReturnType<typeof useBranch>;
type Evaluation = ReturnType<typeof useEvaluation>;

export interface DockFillInputs {
  simState: BranchSimState | null;
  liveTip: boolean;
  branching: boolean;
  executing: boolean;
  branchPreparing: boolean;
  playOutActive: boolean;
  /** The game type has an evaluation at all (singles and doubles). */
  evalAvailable: boolean;
  evaluation: Pick<Evaluation, 'status' | 'result' | 'resultTag' | 'prefs' | 'graph'>;
  /** The evaluation status as the timeline reads it: a finished result of another position counts as stale. */
  liveEvalStatus: Evaluation['status'];
  evalViewKey: string;
  historyLength: number;
  /** Names the variation: a new variation at the same turn is a new position. */
  sessionKey: string;
  handleEvaluate: (options?: EvaluateOptions) => void;
  getChoices: Branch['getChoices'];
  setChoice: Branch['setChoice'];
  executeTurn: Branch['executeTurn'];
}

/** Which slots hold the engine's choice. */
export interface EngineMarks { p1: boolean[]; p2: boolean[] }

/** What the dock reads of the fill. */
export interface DockFillView {
  /** The fill is under way for this position: the untouched chips hold a placeholder. */
  pending: boolean;
  /** The game analysis runs, so the engine cannot fill the untouched chips now. */
  busy: boolean;
  /** An Execute is queued and runs after the fill. */
  waits: boolean;
  engine: EngineMarks;
  /** Execute pressed while the fill is pending: the turn runs once the fill landed. */
  queueExecute: () => void;
  /** The user chose in a slot: it is no longer the engine's. */
  onUserChoice: (side: Side, slot: number) => void;
}

const NO_MARKS: EngineMarks = { p1: [], p2: [] };
const RUNNING = new Set<Evaluation['status']>(['reconstructing', 'searching']);

interface Settled { key: string | null; marks: EngineMarks }

const slotCount = (state: BranchSimState, side: Side): number => (side === 'p1' ? state.p1ActiveSlots : state.p2ActiveSlots)?.length ?? 1;

/** Whether the fill may run now: `open` leaves the game analysis out (the chips say it is busy), `eligible` adds it. */
function gate(inputs: DockFillInputs): { key: string; open: boolean; eligible: boolean } {
  const { simState, liveTip, branching, executing, branchPreparing, playOutActive, evalAvailable, evaluation } = inputs;
  // `historyLength` separates the position after a forced replacement from the turn before it.
  const key = `${inputs.sessionKey}:${inputs.evalViewKey}:${inputs.historyLength}`;
  const forced = !!simState && (simState.p1ForceSwitch || simState.p2ForceSwitch);
  const open = liveTip && branching && !!simState && !simState.ended && !forced && evalAvailable && !executing && !branchPreparing && !playOutActive;
  return { key, open, eligible: open && !evaluation.graph.running };
}

/** The marks the fill left and the Execute queued behind it, in state for the chips and mirrored in refs for the callbacks of a run. */
function useFillMarks() {
  const [settled, setSettled] = useState<Settled>({ key: null, marks: NO_MARKS });
  const [queued, setQueued] = useState<string | null>(null);
  const settledRef = useRef(settled);
  const queuedRef = useRef<string | null>(null);
  const commit = useCallback((next: Settled) => {
    settledRef.current = next;
    setSettled(next);
  }, []);
  const queue = useCallback((key: string) => {
    queuedRef.current = key;
    setQueued(key);
  }, []);
  const unqueue = useCallback(() => {
    queuedRef.current = null;
    setQueued(null);
  }, []);
  return { settled, queued, settledRef, queuedRef, commit, queue, unqueue };
}

type FillMarks = ReturnType<typeof useFillMarks>;

/** Writes the result into the untouched slots of both sides, then runs an Execute that waited for it. */
function useFillApply(inputs: DockFillInputs, key: string, eligible: boolean, marks: FillMarks) {
  const { simState, getChoices, setChoice, executeTurn } = inputs;
  const { settledRef, queuedRef, commit, unqueue } = marks;
  // The callbacks of a run read the position of the moment they fire, never the one they were made for.
  const latest = useRef({ key, eligible, simState, getChoices, setChoice, executeTurn });
  useEffect(() => {
    latest.current = { key, eligible, simState, getChoices, setChoice, executeTurn };
  });
  return useCallback((runKey: string, result: EvalResult) => {
    const now = latest.current;
    if (now.key !== runKey || !now.eligible || !now.simState || settledRef.current.key === runKey) return;
    const state = now.simState;
    const choices = now.getChoices();
    const written: EngineMarks = { p1: [], p2: [] };
    for (const side of ['p1', 'p2'] as const) {
      // A slot with a choice already is the user's: the fill runs once per position, so no earlier fill wrote it.
      const touched = Array.from({ length: slotCount(state, side) }, (_, slot): BranchSlotChoice | null => choices[side][slot] ?? null);
      const filled = pickFill(side, result.perSide[side], state, touched);
      written[side] = filled.map(choice => choice !== null);
      filled.forEach((choice, slot) => { if (choice) now.setChoice(side, choice, slot); });
    }
    commit({ key: runKey, marks: written });
    if (queuedRef.current === runKey) {
      unqueue();
      void now.executeTurn();
    }
  }, [settledRef, queuedRef, commit, unqueue]);
}

type Apply = ReturnType<typeof useFillApply>;

/** The view's own effects start the evaluation of a live position in these cases (`useEvalHousekeeping`); the fill leaves the run to them. */
function startedByHousekeeping(prefs: Pick<Evaluation['prefs'], 'auto' | 'autoAnalyze'>, status: Evaluation['status']): boolean {
  if (prefs.auto && status === 'stale') return true;
  return prefs.autoAnalyze && (status === 'idle' || status === 'stale');
}

/** The trigger only acts: a run for the position, or the result of a run another trigger started (Auto, the walk). */
function useFillTrigger(inputs: DockFillInputs, key: string, eligible: boolean, running: boolean, apply: Apply, settledRef: FillMarks['settledRef']) {
  const { evaluation, liveEvalStatus, evalViewKey, handleEvaluate } = inputs;
  const attemptRef = useRef<string | null>(null);
  // The result that stood when the position began: only a newer one belongs to it.
  const baseRef = useRef<{ key: string; result: EvalResult | null }>({ key, result: evaluation.result });
  const attempted = evaluation.resultTag === evalViewKey;
  useEffect(() => {
    if (baseRef.current.key !== key) baseRef.current = { key, result: evaluation.result };
    if (settledRef.current.key === key) return;
    if (!eligible) {
      // A run that the game analysis (or anything else) stopped starts again once the fill may run.
      attemptRef.current = null;
      return;
    }
    if (evaluation.status === 'done' && evaluation.result !== null && attempted && evaluation.result !== baseRef.current.result) {
      apply(key, evaluation.result);
      return;
    }
    if (attemptRef.current === key || running) return;
    // With Auto or "always on", the housekeeping effects of the view start this run; its result comes through the branch above.
    if (startedByHousekeeping(evaluation.prefs, liveEvalStatus)) return;
    attemptRef.current = key;
    handleEvaluate({ onResult: result => apply(key, result) });
  }, [key, eligible, attempted, running, evaluation.status, evaluation.result, evaluation.prefs, liveEvalStatus, handleEvaluate, apply, settledRef]);
}

/**
 * Round 84 (turn dock): the engine fill at the live tip of a variation. Once per position the hook asks the evaluation for the
 * position and writes the best ranked choice into every slot the user has not touched. It never starts while the game analysis
 * runs (a single evaluation stops its sweep), during a play-out, at a forced replacement, or for a game type without evaluation,
 * and it never sets the Auto preference. An Execute pressed while the run is pending waits and runs after the fill.
 * The fill applies where the result lands (`onResult`); the marks it leaves are state read by the chips.
 */
export function useDockFill(inputs: DockFillInputs): DockFillView {
  const { evaluation } = inputs;
  const { key, open, eligible } = gate(inputs);
  const marks = useFillMarks();
  const { settled, queued, settledRef, commit, queue } = marks;
  const done = settled.key === key;
  const attempted = evaluation.resultTag === inputs.evalViewKey;
  const running = attempted && RUNNING.has(evaluation.status);
  const pending = eligible && !done && (running || !attempted);
  const apply = useFillApply(inputs, key, eligible, marks);
  useFillTrigger(inputs, key, eligible, running, apply, settledRef);

  const queueExecute = useCallback(() => queue(key), [queue, key]);
  const onUserChoice = useCallback((side: Side, slot: number) => {
    const current = settledRef.current;
    if (!current.marks[side][slot]) return;
    const next = current.marks[side].map((mark, index) => mark && index !== slot);
    commit({ key: current.key, marks: { ...current.marks, [side]: next } });
  }, [commit, settledRef]);

  return {
    pending, busy: open && evaluation.graph.running && !done, waits: queued === key && pending,
    engine: done ? settled.marks : NO_MARKS, queueExecute, onUserChoice,
  };
}
