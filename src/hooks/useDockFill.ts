import { useCallback, useEffect, useRef, useState } from 'react';
import type { BranchSimState, BranchSlotChoice, EvalResult } from '@fulllifegames/eval-engine';
import { fitsBeside, pickFillParts } from '../lib/dock-fill';
import type { SideChoices } from '../lib/dock-seed';
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
  /** A replay turn only: the picker state shown is another position's while the viewed one resolves. */
  stale?: boolean;
  /** Names the variation: a new variation at the same turn is a new position. */
  sessionKey: string;
  handleEvaluate: (options?: EvaluateOptions) => void;
  /** The picks of both sides now: the branch's at the tip, the picker's effective choices (logged action under the user's picks) at a replay turn. */
  getChoices: Branch['getChoices'];
  /** The tip writes the fill into the branch without sending anything (a forced replacement waits for Execute); a replay turn never calls it: the fill stays in the view (`choices`). */
  setChoice: Branch['setChoice'];
  /** Runs the turn after the fill; gets the choices the turn is made of (the tip ignores them: its branch holds them). */
  executeTurn: (choices: SideChoices) => unknown;
}

/** The slot whose tray is open: the fill leaves it alone. */
export interface HeldSlot { side: Side; slot: number }

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
  /** A replay turn: what the fill wrote, slot by slot (null where it wrote nothing); null at the tip and before the fill landed. */
  choices: SideChoices | null;
  /** The user clicked a chip: at a replay turn this starts the fill for the position (Q19 b). A no-op at the tip. */
  arm: () => void;
  /** The dock reports its open tray (null when none): the fill never writes that slot, whenever the result lands. */
  holdTray: (open: HeldSlot | null) => void;
  /**
   * Round 84 (A7a, ruling 1a): the engine's pick for a slot whose tray was open when the result landed, by slot (null elsewhere).
   * The chip and the tile show it as the engine's pick; the slot takes it when `release` runs.
   */
  deferred: SideChoices;
  /** The tray of a slot closed (Done, a click beside, Escape, a chip): the slot takes its deferred pick unless the user chose there. */
  release: (side: Side, slot: number) => void;
}

const NO_MARKS: EngineMarks = { p1: [], p2: [] };
const RUNNING = new Set<Evaluation['status']>(['reconstructing', 'searching']);

interface Settled { key: string | null; marks: EngineMarks; choices: SideChoices; deferred: SideChoices }

const NO_CHOICES: SideChoices = { p1: [], p2: [] };

const slotCount = (state: BranchSimState, side: Side): number => (side === 'p1' ? state.p1ActiveSlots : state.p2ActiveSlots)?.length ?? 1;

/**
 * Whether the fill may run now: `open` leaves the game analysis out (the chips say it is busy), `eligible` adds it. The tip of a
 * variation fills at once; a replay turn (Q19 b) only after the user's first click on a chip of that position (`armedKey`), and
 * once its picker resolved (`stale` is false).
 */
function gate(inputs: DockFillInputs, armedKey: string | null): { key: string; open: boolean; eligible: boolean } {
  const { simState, liveTip, branching, executing, branchPreparing, playOutActive, evalAvailable, evaluation } = inputs;
  // `historyLength` separates the position after a forced replacement from the turn before it.
  const key = `${inputs.sessionKey}:${inputs.evalViewKey}:${inputs.historyLength}`;
  // Round 84 (A7a, ruling 2a): a forced replacement at the live tip is filled like any slot (the evaluation prices the open request);
  // a replay turn never stands at one.
  const forced = !liveTip && !!simState && (simState.p1ForceSwitch || simState.p2ForceSwitch);
  const reachable = !!simState && !simState.ended && !forced && evalAvailable && !executing && !branchPreparing && !playOutActive;
  const open = reachable && (liveTip ? branching : armedKey === key && !inputs.stale);
  return { key, open, eligible: open && !evaluation.graph.running };
}

/** The marks the fill left and the Execute queued behind it, in state for the chips and mirrored in refs for the callbacks of a run. */
function useFillMarks() {
  const [settled, setSettled] = useState<Settled>({ key: null, marks: NO_MARKS, choices: NO_CHOICES, deferred: NO_CHOICES });
  const [queued, setQueued] = useState<string | null>(null);
  const settledRef = useRef(settled);
  const heldRef = useRef<HeldSlot | null>(null);
  const commit = useCallback((next: Settled) => {
    settledRef.current = next;
    setSettled(next);
  }, []);
  const queue = useCallback((key: string) => setQueued(key), []);
  const unqueue = useCallback(() => setQueued(null), []);
  const holdTray = useCallback((open: HeldSlot | null) => { heldRef.current = open; }, []);
  return { settled, queued, settledRef, heldRef, commit, queue, unqueue, holdTray };
}

/** The user chose in a slot: it is no longer the engine's, and the pick held back for it is gone. */
function useOnUserChoice({ settledRef, commit }: Pick<FillMarks, 'settledRef' | 'commit'>) {
  return useCallback((side: Side, slot: number) => {
    const current = settledRef.current;
    const deferred = current.deferred[side][slot];
    if (!current.marks[side][slot] && !deferred) return;
    const next = current.marks[side].map((mark, index) => mark && index !== slot);
    commit({
      ...current, marks: { ...current.marks, [side]: next },
      deferred: { ...current.deferred, [side]: current.deferred[side].map((pick, index) => (index === slot ? null : pick)) },
    });
  }, [commit, settledRef]);
}

type FillMarks = ReturnType<typeof useFillMarks>;

/** Writes the result into the untouched slots of both sides, then runs an Execute that waited for it; `release` hands a held slot its deferred pick. */
function useFillApply(inputs: DockFillInputs, key: string, eligible: boolean, marks: FillMarks) {
  const { simState, getChoices, setChoice, executeTurn } = inputs;
  const { settledRef, heldRef, queued, commit, unqueue } = marks;
  // The callbacks of a run read the position of the moment they fire, never the one they were made for.
  const { liveTip } = inputs;
  const latest = useRef({ key, eligible, simState, getChoices, setChoice, executeTurn, queued, liveTip });
  useEffect(() => {
    latest.current = { key, eligible, simState, getChoices, setChoice, executeTurn, queued, liveTip };
  });
  const apply = useCallback((runKey: string, result: EvalResult) => {
    const now = latest.current;
    if (now.key !== runKey || !now.eligible || !now.simState || settledRef.current.key === runKey) return;
    const state = now.simState;
    const choices = now.getChoices();
    const written: EngineMarks = { p1: [], p2: [] };
    const wrote: SideChoices = { p1: [], p2: [] };
    const deferred: SideChoices = { p1: [], p2: [] };
    const merged: SideChoices = { p1: [], p2: [] };
    for (const side of ['p1', 'p2'] as const) {
      // A slot with a choice already is the user's: the fill runs once per position, so no earlier fill wrote it.
      const touched = Array.from({ length: slotCount(state, side) }, (_, slot): BranchSlotChoice | null => choices[side][slot] ?? null);
      // Round 84: the slot whose tray is open stays as it is, like a touched one.
      const held = touched.map((_, slot) => heldRef.current?.side === side && heldRef.current.slot === slot);
      const { filled, deferred: later } = pickFillParts(side, result.perSide[side], state, touched, held);
      written[side] = filled.map(choice => choice !== null);
      wrote[side] = filled;
      deferred[side] = later;
      merged[side] = filled.map((choice, slot) => touched[slot] ?? choice);
      if (now.liveTip) filled.forEach((choice, slot) => { if (choice) now.setChoice(side, choice, slot); });
    }
    commit({ key: runKey, marks: written, choices: wrote, deferred });
    if (now.queued === runKey) {
      unqueue();
      void now.executeTurn(merged);
    }
  }, [settledRef, heldRef, commit, unqueue]);
  const release = useCallback((side: Side, slot: number) => {
    const now = latest.current;
    const current = settledRef.current;
    const choice = current.deferred[side][slot];
    if (current.key !== now.key || !choice) return;
    const others = now.getChoices()[side] as (BranchSlotChoice | null)[];
    const withSlot = <T,>(list: T[], value: T): T[] => Array.from({ length: Math.max(list.length, slot + 1) }, (_, index) => (index === slot ? value : list[index]));
    const deferred = { ...current.deferred, [side]: withSlot(current.deferred[side], null) };
    // The user may have chosen in this slot or beside it while the tray stood open: then the engine's pick is gone or no longer fits.
    if (others[slot] || !fitsBeside(choice, others, slot)) {
      commit({ ...current, deferred });
      return;
    }
    if (now.liveTip) now.setChoice(side, choice, slot);
    commit({
      ...current, deferred,
      marks: { ...current.marks, [side]: withSlot(current.marks[side], true) },
      choices: { ...current.choices, [side]: withSlot(current.choices[side], choice) },
    });
  }, [settledRef, commit]);
  return { apply, release };
}

type Apply = ReturnType<typeof useFillApply>['apply'];

/** The view's own effects start the evaluation of a live position in these cases (`useEvalHousekeeping`); the fill leaves the run to them. */
function startedByHousekeeping(liveTip: boolean, prefs: Pick<Evaluation['prefs'], 'auto' | 'autoAnalyze'>, status: Evaluation['status']): boolean {
  // Those effects serve live positions only; a replay turn is never started by them.
  if (!liveTip) return false;
  if (prefs.auto && status === 'stale') return true;
  return prefs.autoAnalyze && (status === 'idle' || status === 'stale');
}

/**
 * The result that stood when the position began: only a newer one belongs to it. Round 84 (A7h): `foreign` marks a run that was
 * under way when the position began (the replacement's run, when a forced replacement was just sent: the next request of the turn
 * has the same `evalViewKey`, so the tag cannot tell the two apart). Its result belongs to the request before; once it is over,
 * whatever stands is its result and the new base.
 */
interface FillBase { key: string; result: EvalResult | null; foreign: boolean }

function useFillBase(key: string, result: EvalResult | null, running: boolean) {
  const ref = useRef<FillBase>({ key, result, foreign: running });
  const update = useCallback((nextKey: string, nextResult: EvalResult | null, nextRunning: boolean): FillBase => {
    if (ref.current.key !== nextKey) ref.current = { key: nextKey, result: nextResult, foreign: nextRunning };
    else if (ref.current.foreign && !nextRunning) ref.current = { key: nextKey, result: nextResult, foreign: false };
    return ref.current;
  }, []);
  return update;
}

/** The trigger only acts: a run for the position, or the result of a run another trigger started (Auto, the walk). */
function useFillTrigger(inputs: DockFillInputs, key: string, eligible: boolean, running: boolean, apply: Apply, settledRef: FillMarks['settledRef']) {
  const { evaluation, liveEvalStatus, evalViewKey, handleEvaluate, liveTip } = inputs;
  const attemptRef = useRef<string | null>(null);
  const updateBase = useFillBase(key, evaluation.result, running);
  const attempted = evaluation.resultTag === evalViewKey;
  useEffect(() => {
    const current = updateBase(key, evaluation.result, running);
    if (settledRef.current.key === key) return;
    if (!eligible) {
      // A run that the game analysis (or anything else) stopped starts again once the fill may run.
      attemptRef.current = null;
      return;
    }
    if (!current.foreign && evaluation.status === 'done' && evaluation.result !== null && attempted && evaluation.result !== current.result) {
      apply(key, evaluation.result);
      return;
    }
    // A foreign run is no run for this position: the fill starts its own, which supersedes it.
    if (attemptRef.current === key || (running && !current.foreign)) return;
    // With Auto or "always on", the housekeeping effects of the view start this run; its result comes through the branch above.
    if (!current.foreign && startedByHousekeeping(liveTip, evaluation.prefs, liveEvalStatus)) return;
    attemptRef.current = key;
    current.foreign = false;
    handleEvaluate({ onResult: result => apply(key, result) });
  }, [key, eligible, attempted, running, evaluation.status, evaluation.result, evaluation.prefs, liveEvalStatus, liveTip, handleEvaluate, apply, settledRef, updateBase]);
}

/** What the dock reads of a fill that landed for this position (nothing before). A replay turn reads its choices from the view. */
function landedView(landed: Settled | null, liveTip: boolean): Pick<DockFillView, 'engine' | 'choices' | 'deferred'> {
  return {
    engine: landed?.marks ?? NO_MARKS, choices: landed && !liveTip ? landed.choices : null, deferred: landed?.deferred ?? NO_CHOICES,
  };
}

/**
 * Round 84 (turn dock): the engine fill. Once per position the hook asks the evaluation for the position and writes the best
 * ranked choice into every slot the user has not touched, nor holds open. At the live tip of a variation it starts at once and
 * writes into the branch; at a replay turn it starts with the user's first click on a chip and keeps its choices in the view
 * (`choices`), under the draft and over the logged seed. It never starts while the game analysis
 * runs (a single evaluation stops its sweep), during a play-out, or for a game type without evaluation,
 * and it never sets the Auto preference. An Execute pressed while the run is pending waits and runs after the fill.
 * The fill applies where the result lands (`onResult`); the marks it leaves are state read by the chips.
 */
export function useDockFill(inputs: DockFillInputs): DockFillView {
  const { evaluation } = inputs;
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const { key, open, eligible } = gate(inputs, armedKey);
  // The click that arms the fill belongs to its position: another turn needs its own, and so does a return.
  if (armedKey !== null && armedKey !== key) setArmedKey(null);
  const marks = useFillMarks();
  const { settled, queued, settledRef, queue, unqueue, holdTray } = marks;
  const onUserChoice = useOnUserChoice(marks);
  const done = settled.key === key;
  const attempted = evaluation.resultTag === inputs.evalViewKey;
  const running = attempted && RUNNING.has(evaluation.status);
  const pending = eligible && !done && (running || !attempted);
  const { apply, release } = useFillApply(inputs, key, eligible, marks);
  useFillTrigger(inputs, key, eligible, running, apply, settledRef);

  // A queued Execute lives as long as its run is pending: a run that failed or that something stopped takes it along, so a later
  // Evaluate by hand never executes the turn. Reconciled in render, like the other state that follows the position.
  const waits = queued === key && pending;
  if (queued !== null && !waits) unqueue();

  const queueExecute = useCallback(() => queue(key), [queue, key]);
  const liveTip = inputs.liveTip;
  const arm = useCallback(() => { if (!liveTip) setArmedKey(key); }, [liveTip, key]);
  const landed = done ? settled : null;
  return {
    pending, busy: open && evaluation.graph.running && !done, waits,
    ...landedView(landed, liveTip),
    queueExecute, onUserChoice, holdTray, release, arm,
  };
}
