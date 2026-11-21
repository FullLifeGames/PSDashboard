import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { BranchSimState, BranchSlotChoice, EvalResult, RankedChoice } from '@fulllifegames/eval-engine';
import { fitsBeside, pickFillParts, rowOfChoices, sameChoice } from '../lib/dock-fill';
import { worstReply } from '../lib/worst-reply';
import type { SideChoices } from '../lib/dock-seed';
import type { EvaluateOptions } from './useEvalView';
import type { useBranch } from './useBranch';
import type { useEvaluation } from './useEvaluation';
import { fillAnswer, useFillBase, useStoppedKey } from './dock-fill-trigger';

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
  evaluation: Pick<Evaluation, 'status' | 'result' | 'resultTag' | 'prefs' | 'graph' | 'stopped'>;
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
  /**
   * The user chose in a slot: it is no longer the engine's. Round 89 (#153, Hard mode): with the setting on and the pick given, the
   * opponent's engine slots are written again with the reply that hurts the user's side most (the pick's own handler, never an effect).
   */
  onUserChoice: (side: Side, slot: number, pick?: BranchSlotChoice) => void;
  /**
   * Round 89 (#153, HM3b): what the fill chose for each slot, as it chose it and frozen for the position (a slot held open takes its deferred
   * pick; a slot the user had set before the fill landed holds null). Empty before the fill landed. The dock offers "Back to the engine's
   * pick" where a user pick differs from it.
   */
  picks: SideChoices;
  /**
   * "Back to the engine's pick" for one slot: marks the slot as the engine's again, answers for the opponent (Hard mode on: its engine slots
   * take the reply to the restored pick, as after any pick; off: the opponent's fill as at the start) and returns the choice the dock writes
   * into the slot; null when the fill chose nothing for it. Called from the click's handler, never from an effect.
   */
  restore: (side: Side, slot: number) => BranchSlotChoice | null;
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

interface Settled { key: string | null; marks: EngineMarks; choices: SideChoices; deferred: SideChoices; picks: SideChoices }

const NO_CHOICES: SideChoices = { p1: [], p2: [] };

/** `list` with `value` at `slot`, grown to reach it. */
const withSlot = <T,>(list: readonly T[], slot: number, value: T): T[] => Array.from({ length: Math.max(list.length, slot + 1) }, (_, index) => (index === slot ? value : list[index]));

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
  const [settled, setSettled] = useState<Settled>({ key: null, marks: NO_MARKS, choices: NO_CHOICES, deferred: NO_CHOICES, picks: NO_CHOICES });
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

/**
 * Round 89 (#153, Hard mode): the side in hand is the one whose slots the user set, provided the other side holds no pick of the
 * user's: that other side is the opponent. Both sides set, or neither, leave no opponent to play a reply.
 */
function handSide(touched: Record<Side, (BranchSlotChoice | null)[]>): Side | null {
  const set = (['p1', 'p2'] as const).filter(side => touched[side].some(Boolean));
  return set.length === 1 ? set[0] : null;
}

/**
 * The opponent's ranked choices with the reply that hurts the side in hand most first: the row the picks stand for (`rowOfChoices`),
 * its worst reply (`worstReply`). A choice no ranked row stands for leaves the ranking as the engine made it. The fill maps the first
 * choice that fits the pickers, so a reply that does not map (or clashes) gives way to the next one. Null when no ranked row stands for
 * the picks: nothing to answer.
 */
function answersTo(result: EvalResult, state: BranchSimState, hand: Side, picks: (BranchSlotChoice | null)[], touched: (BranchSlotChoice | null)[]): RankedChoice[] | null {
  const opponent: Side = hand === 'p1' ? 'p2' : 'p1';
  const row = rowOfChoices(hand, result.perSide[hand], state, picks, touched);
  const reply = row ? worstReply(result, hand, row)?.reply : undefined;
  return reply ? [reply, ...result.perSide[opponent]] : null;
}

/** What a fill's callbacks read of the position at the moment they fire, and the result the fill of this position used. */
type LatestFill = MutableRefObject<{
  key: string; eligible: boolean; simState: BranchSimState | null; getChoices: DockFillInputs['getChoices']; setChoice: DockFillInputs['setChoice'];
  executeTurn: DockFillInputs['executeTurn']; queued: string | null; liveTip: boolean; hardMode: boolean;
}>;
type FillResult = MutableRefObject<{ key: string; result: EvalResult } | null>;

/**
 * Round 89 (#153, Hard mode): a pick of the user after the fill rewrites the opponent's engine slots with the reply that hurts the
 * user's side most, read from the result the fill used. The user's slots are those with a choice that no fill wrote; when the other side
 * holds a pick of the user's too, nobody is the opponent and nothing is written. Returns the handler the pick calls.
 */
function useRefill(latest: LatestFill, fillResultRef: FillResult, settledRef: FillMarks['settledRef'], commit: FillMarks['commit']) {
  return (side: Side, slot: number, pick: BranchSlotChoice): void => {
    const now = latest.current;
    const current = settledRef.current;
    const fill = fillResultRef.current;
    if (!now.hardMode || !now.simState || current.key !== now.key || fill?.key !== now.key) return;
    const state = now.simState;
    const opponent: Side = side === 'p1' ? 'p2' : 'p1';
    const choices = now.getChoices();
    // the user's slots: a slot with a choice that no fill wrote; the pick is the one that just came
    const userSlots = (key: Side): (BranchSlotChoice | null)[] => (
      Array.from({ length: slotCount(state, key) }, (_, index) => (current.marks[key][index] ? null : choices[key][index] ?? null))
    );
    const touched = userSlots(side).map((choice, index) => (index === slot ? pick : choice));
    // both sides hold picks of the user: nobody is the opponent
    if (userSlots(opponent).some(Boolean)) return;
    const standing = (index: number) => choices[side][index] ?? current.choices[side][index] ?? null;
    const picks = touched.map((choice, index) => choice ?? (current.marks[side][index] ? standing(index) : null));
    const ranked = answersTo(fill.result, state, side, picks, touched);
    if (!ranked) return;
    // the opponent's slots are all the engine's: nothing there is touched, so the reply decides the joint choice
    const { filled } = pickFillParts(opponent, ranked, state, Array.from({ length: slotCount(state, opponent) }, () => null), []);
    if (filled.every(choice => choice === null)) return;
    if (now.liveTip) filled.forEach((choice, index) => { if (choice) now.setChoice(opponent, choice, index); });
    commit({
      ...current,
      marks: { ...current.marks, [opponent]: Array.from({ length: filled.length }, (_, index) => filled[index] !== null || !!current.marks[opponent][index]) },
      choices: { ...current.choices, [opponent]: filled.map((choice, index) => choice ?? current.choices[opponent][index] ?? null) },
    });
  };
}

/**
 * Round 89 (#153, HM3b): "Back to the engine's pick" for one slot. The slot is the engine's again (mark, no deferred pick), and the
 * opponent answers: with the setting on its engine slots take the reply to the restored pick (`refill`, the rule of any pick); off,
 * the engine slots the fill wrote return to their fill as at the start, where they differ. Slots the user set are left alone. Returns the
 * choice for the dock to write into the slot, null when the fill chose nothing for it.
 */
function useRestore(latest: LatestFill, settledRef: FillMarks['settledRef'], commit: FillMarks['commit'], refill: ReturnType<typeof useRefill>) {
  return (side: Side, slot: number): BranchSlotChoice | null => {
    const now = latest.current;
    const current = settledRef.current;
    const own = current.picks[side][slot] ?? null;
    if (!own || !now.simState || current.key !== now.key) return null;
    const opponent: Side = side === 'p1' ? 'p2' : 'p1';
    const marks = { ...current.marks, [side]: withSlot(current.marks[side], slot, true) };
    const deferred = { ...current.deferred, [side]: withSlot(current.deferred[side], slot, null) };
    const choices = { ...current.choices, [side]: withSlot(current.choices[side], slot, own) };
    if (now.hardMode) {
      commit({ ...current, marks, deferred, choices });
      refill(side, slot, own);
      return own;
    }
    // the opponent's engine slots return to the fill as at the start
    const back = current.picks[opponent].map((pick, index) => (pick && current.marks[opponent][index] && !sameChoice(current.choices[opponent][index], pick) ? pick : null));
    if (now.liveTip) back.forEach((pick, index) => { if (pick) now.setChoice(opponent, pick, index); });
    commit({ ...current, marks, deferred, choices: { ...choices, [opponent]: choices[opponent].map((pick, index) => back[index] ?? pick) } });
    return own;
  };
}

/** What the fill wrote, side by side: the marks, the choices, the picks held slots take later, and the sides' choices as they now stand. */
interface FillWrite { written: EngineMarks; wrote: SideChoices; deferred: SideChoices; merged: SideChoices }

/**
 * The fill of one result: both sides take the first ranked choice that maps and agrees with their touched slots, and the picks go into
 * the branch at the live tip. Round 89 (#153, Hard mode): the side in hand (`handSide`) fills first, and the opponent's ranking then
 * starts with the reply that hurts its choice most (`answersTo`).
 */
function fillSides(now: LatestFill['current'], state: BranchSimState, result: EvalResult, held: HeldSlot | null): FillWrite {
  const choices = now.getChoices();
  const out: FillWrite = { written: { p1: [], p2: [] }, wrote: { p1: [], p2: [] }, deferred: { p1: [], p2: [] }, merged: { p1: [], p2: [] } };
  // A slot with a choice already is the user's: the fill runs once per position, so no earlier fill wrote it.
  const touchedOf = (side: Side): (BranchSlotChoice | null)[] => Array.from({ length: slotCount(state, side) }, (_, slot) => choices[side][slot] ?? null);
  const touchedBy = { p1: touchedOf('p1'), p2: touchedOf('p2') };
  const hand = now.hardMode ? handSide(touchedBy) : null;
  const ranking: Record<Side, RankedChoice[]> = { p1: result.perSide.p1, p2: result.perSide.p2 };
  for (const side of hand === 'p2' ? (['p2', 'p1'] as const) : (['p1', 'p2'] as const)) {
    const touched = touchedBy[side];
    // Round 84: the slot whose tray is open stays as it is, like a touched one.
    const isHeld = touched.map((_, slot) => held?.side === side && held.slot === slot);
    const { filled, deferred } = pickFillParts(side, ranking[side], state, touched, isHeld);
    out.written[side] = filled.map(choice => choice !== null);
    out.wrote[side] = filled;
    out.deferred[side] = deferred;
    out.merged[side] = filled.map((choice, slot) => touched[slot] ?? choice);
    if (now.liveTip) filled.forEach((choice, slot) => { if (choice) now.setChoice(side, choice, slot); });
    const opponent: Side = side === 'p1' ? 'p2' : 'p1';
    if (side === hand) ranking[opponent] = answersTo(result, state, side, out.merged[side], touched) ?? ranking[opponent];
  }
  return out;
}

/** Writes the result into the untouched slots of both sides, then runs an Execute that waited for it; `release` hands a held slot its deferred pick. */
function useFillApply(inputs: DockFillInputs, key: string, eligible: boolean, marks: FillMarks) {
  const { simState, getChoices, setChoice, executeTurn } = inputs;
  const { settledRef, heldRef, queued, commit, unqueue } = marks;
  // The callbacks of a run read the position of the moment they fire, never the one they were made for.
  const { liveTip } = inputs;
  const hardMode = !!inputs.evaluation.prefs.hardMode;
  const latest = useRef({ key, eligible, simState, getChoices, setChoice, executeTurn, queued, liveTip, hardMode });
  // The result the fill of this position used: a pick of the user reads it again (Hard mode).
  const fillResultRef = useRef<{ key: string; result: EvalResult } | null>(null);
  useEffect(() => {
    latest.current = { key, eligible, simState, getChoices, setChoice, executeTurn, queued, liveTip, hardMode };
  });
  const apply = useCallback((runKey: string, result: EvalResult) => {
    const now = latest.current;
    if (now.key !== runKey || !now.eligible || !now.simState || settledRef.current.key === runKey) return;
    const state = now.simState;
    const { written, wrote, deferred, merged } = fillSides(now, state, result, heldRef.current);
    fillResultRef.current = { key: runKey, result };
    const picks = { p1: wrote.p1.map((choice, slot) => choice ?? deferred.p1[slot] ?? null), p2: wrote.p2.map((choice, slot) => choice ?? deferred.p2[slot] ?? null) };
    commit({ key: runKey, marks: written, choices: wrote, deferred, picks });
    if (now.queued === runKey) {
      unqueue();
      void now.executeTurn(merged);
    }
  }, [settledRef, heldRef, commit, unqueue]);
  const refill = useRefill(latest, fillResultRef, settledRef, commit);
  const release = useCallback((side: Side, slot: number) => {
    const now = latest.current;
    const current = settledRef.current;
    const choice = current.deferred[side][slot];
    if (current.key !== now.key || !choice) return;
    const others = now.getChoices()[side] as (BranchSlotChoice | null)[];
    const deferred = { ...current.deferred, [side]: withSlot(current.deferred[side], slot, null) };
    // The user may have chosen in this slot or beside it while the tray stood open: then the engine's pick is gone or no longer fits.
    if (others[slot] || !fitsBeside(choice, others, slot)) {
      commit({ ...current, deferred });
      return;
    }
    if (now.liveTip) now.setChoice(side, choice, slot);
    commit({
      ...current, deferred,
      marks: { ...current.marks, [side]: withSlot(current.marks[side], slot, true) },
      choices: { ...current.choices, [side]: withSlot(current.choices[side], slot, choice) },
    });
  }, [settledRef, commit]);
  const restore = useRestore(latest, settledRef, commit, refill);
  return { apply, release, refill, restore };
}

type Apply = ReturnType<typeof useFillApply>['apply'];

/** The view's own effects start the evaluation of a live position in these cases (`useEvalHousekeeping`); the fill leaves the run to them. */
function startedByHousekeeping(liveTip: boolean, prefs: Pick<Evaluation['prefs'], 'auto' | 'autoAnalyze'>, status: Evaluation['status']): boolean {
  // Those effects serve live positions only; a replay turn is never started by them.
  if (!liveTip) return false;
  if (prefs.auto && status === 'stale') return true;
  return prefs.autoAnalyze && (status === 'idle' || status === 'stale');
}

/** The trigger only acts: a run for the position, or the result of a run another trigger started (Auto, the walk). */
function useFillTrigger(inputs: DockFillInputs, key: string, eligible: boolean, running: boolean, apply: Apply, settledRef: FillMarks['settledRef']) {
  const { evaluation, liveEvalStatus, evalViewKey, handleEvaluate, liveTip } = inputs;
  const attemptRef = useRef<string | null>(null);
  const updateBase = useFillBase(key, evaluation.result, running);
  const stoppedAt = useStoppedKey(evaluation, evalViewKey);
  const attempted = evaluation.resultTag === evalViewKey;
  useEffect(() => {
    const current = updateBase(key, evaluation.result, running);
    const stoppedHere = stoppedAt(key);
    if (settledRef.current.key === key) return;
    if (!eligible) {
      // A run that the game analysis (or anything else) stopped starts again once the fill may run.
      attemptRef.current = null;
      return;
    }
    // Round 89 (SB-7): a run the user stopped with a partial result has answered; its result so far fills like a finished one.
    const answer = current.foreign ? null : fillAnswer(evaluation.status, !!evaluation.stopped, evaluation.result, attempted, current.result);
    if (answer) {
      apply(key, answer);
      return;
    }
    // Round 89 (SB-10): a position the user stopped stays stopped, also after a game analysis took the run and gave it back.
    if (stoppedHere) return;
    // A foreign run is no run for this position: the fill starts its own, which supersedes it.
    if (attemptRef.current === key || (running && !current.foreign)) return;
    // With Auto or "always on", the housekeeping effects of the view start this run; its result comes through the branch above.
    if (!current.foreign && startedByHousekeeping(liveTip, evaluation.prefs, liveEvalStatus)) return;
    attemptRef.current = key;
    current.foreign = false;
    handleEvaluate({ onResult: result => apply(key, result) });
  }, [key, eligible, attempted, running, evaluation.status, evaluation.stopped, evaluation.result, evaluation.prefs, liveEvalStatus, liveTip, handleEvaluate, apply, settledRef, updateBase, stoppedAt]);
}

/** What the dock reads of a fill that landed for this position (nothing before). A replay turn reads its choices from the view. */
function landedView(landed: Settled | null, liveTip: boolean): Pick<DockFillView, 'engine' | 'choices' | 'deferred'> {
  return {
    engine: landed?.marks ?? NO_MARKS, choices: landed && !liveTip ? landed.choices : null, deferred: landed?.deferred ?? NO_CHOICES,
  };
}

/**
 * Whether the fill is under way for this position, and whether a run is. Round 84 (A7i): the run of the request before stands done
 * under the same tag in the first render of a new key; the position counts as begun once a run was seen under way while the fill
 * could start, and until then that finished result is no answer, so `pending` holds from the first render of the key.
 */
function useFillPending(inputs: DockFillInputs, key: string, eligible: boolean, done: boolean) {
  const { evaluation } = inputs;
  const attempted = evaluation.resultTag === inputs.evalViewKey;
  const running = attempted && RUNNING.has(evaluation.status);
  const [begunKey, setBegunKey] = useState<string | null>(null);
  if (running && eligible && begunKey !== key) setBegunKey(key);
  const standing = begunKey !== key && evaluation.status === 'done';
  return { running, pending: eligible && !done && (running || !attempted || standing) };
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
  const dropMark = useOnUserChoice(marks);
  const done = settled.key === key;
  const { running, pending } = useFillPending(inputs, key, eligible, done);
  const { apply, release, refill, restore } = useFillApply(inputs, key, eligible, marks);
  const onUserChoice = useCallback((side: Side, slot: number, pick?: BranchSlotChoice) => {
    dropMark(side, slot);
    if (pick) refill(side, slot, pick);
  }, [dropMark, refill]);
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
    ...landedView(landed, liveTip), picks: landed?.picks ?? NO_CHOICES,
    queueExecute, onUserChoice, restore, holdTray, release, arm,
  };
}
