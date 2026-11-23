import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { finalPlayedTurn, type TurnSnapshot } from '@fulllifegames/replay-core';
import {
  normalizePosition, pointerAtFrame, variationCovers, variationTip,
  type TimelinePosition, type VariationSpan, type ViewLine,
} from '../lib/timeline';
import { settledEntryAfterTurns, turnEntryCount } from '../lib/variation-turns';
import type { BranchHistoryEntry } from './useBranch';

export interface TimelineInputs {
  replayId: string | undefined;
  snapshots: TurnSnapshot[];
  branching: boolean;
  variationStartTurn: number | null;
  history: BranchHistoryEntry[];
  interruptPlayOut: () => void;
  onNavigate: () => void;
  variationEnded?: boolean;
  executing?: boolean;
}

function usePointerState() {
  const [viewTurn, setViewTurnState] = useState(1);
  /**
   * Synchronous mirror of viewTurn: a slider change followed by an immediate "Branch Here" click can fire before React commits the
   * re-render, so handlers that act on the selected turn read the ref, never the closure.
   */
  const viewTurnRef = useRef(1);
  const setViewTurn = useCallback((value: number | ((turn: number) => number)) => {
    const next = typeof value === 'function' ? value(viewTurnRef.current) : value;
    viewTurnRef.current = next;
    setViewTurnState(next);
  }, []);
  const [viewLine, setViewLine] = useState<ViewLine>('main');
  const [viewT0, setViewT0] = useState(false);
  /** One-shot seek command for the branch iframe, which ignores seekTurn changes after mount; user navigation bumps it. */
  const [navSeek, setNavSeek] = useState<{ turn: number; seq: number; play?: boolean } | null>(null);
  /** The pointer stands where it followed an executed turn, not where the user moved it: a branch frame that opens there plays it in. */
  const [followedPlay, setFollowedPlay] = useState(false);
  const [variationScores, setVariationScores] = useState<(number | null)[]>([]);
  const resetPointer = useCallback(() => {
    setViewTurn(1);
    setViewLine('main');
    setViewT0(false);
    setNavSeek(null);
    setFollowedPlay(false);
    setVariationScores([]);
  }, [setViewTurn]);
  return {
    viewTurn, viewTurnRef, setViewTurn, viewLine, setViewLine, viewT0, setViewT0,
    navSeek, setNavSeek, followedPlay, setFollowedPlay, variationScores, setVariationScores, resetPointer,
  };
}

type PointerState = ReturnType<typeof usePointerState>;

function useTimelineDerived(args: {
  pointer: PointerState;
  snapshots: TurnSnapshot[];
  branching: boolean;
  variationStartTurn: number | null;
  history: BranchHistoryEntry[];
}) {
  const { pointer, snapshots, branching, variationStartTurn, history } = args;
  const { viewTurn, viewLine, viewT0 } = pointer;
  const maxTurn = snapshots.length > 0 ? snapshots.length : 1;
  // The last snapshot is the post-battle end state when it holds the final turn's residue instead of starting a new |turn|: it is
  // labelled "End", kept stable against iframe echoes, and blocked as a branch target.
  const endSnapshotTurn = useMemo(() => {
    if (snapshots.length < 2) return null;
    const last = snapshots[snapshots.length - 1];
    return last.log.some(line => line.startsWith('|turn|')) ? null : last.turn;
  }, [snapshots]);
  const atEndPosition = endSnapshotTurn !== null && viewTurn >= endSnapshotTurn;
  /** The variation as a pure span: null until a turn actually executed. Interludes (a replacement on one side or on both) do not
   *  consume a turn (`variation-turns.ts`). */
  const variationSpan = useMemo<VariationSpan | null>(() => {
    if (variationStartTurn === null) return null;
    const turnEntries = turnEntryCount(history);
    return turnEntries > 0 ? { startTurn: variationStartTurn, length: turnEntries } : null;
  }, [variationStartTurn, history]);
  // The T0 view is a side trip: the line stays as the user left it (the step forward returns there), but nothing of the variation
  // is on screen.
  const viewingVariation = viewLine === 'variation' && !viewT0 && variationCovers(variationSpan, viewTurn);
  const liveSimTurn = branching && variationStartTurn !== null
    ? variationStartTurn + (variationSpan?.length ?? 0)
    : null;
  const liveTip = liveSimTurn !== null && viewTurn === liveSimTurn
    && (variationSpan === null || viewingVariation);
  const liveEvalView = liveTip || viewingVariation;
  const evalViewKey = `${viewingVariation ? 'variation' : 'main'}:${viewTurn}`;
  const tipTurn = variationSpan ? variationTip(variationSpan) : null;
  /** The live sim's own position, whatever the pointer shows (`key` is what `evalViewKey` reads on the tip): a frame report cannot stop the play-out. */
  const spanned = variationSpan !== null;
  const tip = useMemo(
    () => (liveSimTurn === null ? null : { key: `${spanned ? 'variation' : 'main'}:${liveSimTurn}`, turn: liveSimTurn, variation: spanned }),
    [liveSimTurn, spanned],
  );
  const serializedAtView = useMemo(() => {
    if (!viewingVariation || !variationSpan) return null;
    return settledEntryAfterTurns(history, viewTurn - variationSpan.startTurn)?.serializedPosition ?? null;
  }, [viewingVariation, variationSpan, viewTurn, history]);
  const analyzableTurns = useMemo(
    () => (snapshots.length > 0 ? finalPlayedTurn(snapshots) : 1),
    [snapshots],
  );
  return {
    maxTurn, endSnapshotTurn, atEndPosition, variationSpan, viewingVariation,
    liveSimTurn, liveTip, liveEvalView, evalViewKey, tipTurn, tip, serializedAtView, analyzableTurns,
  };
}

type TimelineDerived = ReturnType<typeof useTimelineDerived>;

interface NavArgs {
  pointer: PointerState;
  derived: TimelineDerived;
  atVariationEnd: boolean;
  branching: boolean;
  interruptPlayOut: () => void;
  onNavigate: () => void;
  executing: boolean;
  variationEnded: boolean;
  setAnalysisTurn: (turn: number) => void;
}

type SeekIntentRef = { current: { turn: number; until: number } | null };
type FrameTurnRef = { current: number | null };

/**
 * How long the frame's reports count as the app's own while it plays a followed turn in; the guard ends when the frame lands on the
 * tip. The bound covers a new document's load, which took over four seconds under the full e2e suite after a set edit.
 */
const PLAY_IN_GUARD_MS = 20_000;

/**
 * `toFrame`: the pointer takes the variation position of a turn the branch frame shows and never seeks it. `true` names the last
 * turn any frame reported, a number the turn the frame is about to show (Watch from turn N).
 */
type Navigate = (
  position: TimelinePosition,
  opts?: { seek?: boolean; internal?: boolean; followPlay?: boolean; toFrame?: true | number },
) => void;

function useNavigateTo(args: NavArgs, seekIntentRef: SeekIntentRef, frameTurnRef: FrameTurnRef) {
  const { pointer, derived, interruptPlayOut, onNavigate, variationEnded } = args;
  const { setViewTurn, setViewLine, setViewT0, setNavSeek, setFollowedPlay } = pointer;
  const { maxTurn, variationSpan } = derived;

  const navigateTo = useCallback<Navigate>((position, opts) => {
    if (!opts?.internal) interruptPlayOut();
    const frameTurn = opts?.toFrame === true ? frameTurnRef.current : opts?.toFrame ?? null;
    const atFrame = pointerAtFrame(frameTurn, variationSpan, variationEnded);
    const next = atFrame !== null ? { turn: atFrame, line: 'variation' as const } : normalizePosition(position, maxTurn, variationSpan);
    setViewT0(false);
    setViewTurn(next.turn);
    setFollowedPlay(!!opts?.followPlay);
    // The stored line is the user's intent, sticky across uncovered turns: only an explicit 'main' request (chip, notation, graph)
    // leaves the variation.
    const sticky: ViewLine =
      variationSpan === null ? 'main'
      : next.line === 'variation' ? 'variation'
      : position.line;
    setViewLine(sticky);
    onNavigate();
    if (atFrame !== null) {
      seekIntentRef.current = null;
    } else if (opts?.seek !== false) {
      setNavSeek(prev => ({ turn: next.turn, seq: (prev?.seq ?? 0) + 1 }));
      seekIntentRef.current = { turn: next.turn, until: Date.now() + 4000 };
    }
  }, [maxTurn, variationSpan, variationEnded, setViewTurn, setViewLine, setViewT0, setNavSeek, setFollowedPlay, interruptPlayOut, onNavigate, seekIntentRef, frameTurnRef]);

  return { navigateTo, ...useTipFollow(args, seekIntentRef, navigateTo) };
}

/**
 * Executed turns move the pointer with the play: the tip is where the next choice happens. A rebuild that keeps the span (a set
 * edit replays the same turns into new objects) is no executed turn, so the pointer stays where the user looks. The key names the
 * span, so a variation that ended and a new one with the same tip follows again.
 */
function useTipFollow(args: NavArgs, seekIntentRef: SeekIntentRef, navigateTo: Navigate) {
  const { pointer, derived, branching, executing, variationEnded } = args;
  const { setViewTurn, setViewLine, setViewT0, setNavSeek, setFollowedPlay } = pointer;
  const { variationSpan, tipTurn } = derived;
  const followedKeyRef = useRef<string | null>(null);
  const executingRef = useRef(false);
  const holdFollowRef = useRef(false);
  /** Puts the pointer back after a rebuild the user did not ask to follow (a failed execute): the restored span counts as followed. */
  const restorePointer = useCallback((position: TimelinePosition, span: VariationSpan | null) => {
    followedKeyRef.current = span ? `${span.startTurn}:${variationTip(span)}` : null;
    setViewT0(false);
    setViewTurn(position.turn);
    setViewLine(position.line);
    setFollowedPlay(false);
    setNavSeek(prev => ({ turn: position.turn, seq: (prev?.seq ?? 0) + 1 }));
  }, [setViewT0, setViewTurn, setViewLine, setFollowedPlay, setNavSeek]);
  /** The user starts a new variation: its tip is followed even when its span matches the one it replaces. */
  const followNextTip = useCallback(() => {
    followedKeyRef.current = null;
  }, []);
  useEffect(() => {
    if (!branching || tipTurn === null || variationSpan === null) {
      followedKeyRef.current = null;
      return;
    }
    const key = `${variationSpan.startTurn}:${tipTurn}`;
    if (followedKeyRef.current === key) {
      // The win can land a render after its turn: the guard then waits for the last played turn.
      const intent = seekIntentRef.current;
      if (variationEnded && intent?.turn === tipTurn) seekIntentRef.current = { ...intent, turn: tipTurn - 1 };
      return;
    }
    followedKeyRef.current = key;
    // The view was handed back while this turn was in flight (Stop, or the user's own click): the turn lands where the user is not
    // looking, so the pointer stays.
    if (holdFollowRef.current) {
      holdFollowRef.current = false;
      return;
    }
    // The frame plays the turn in from the one before the tip: its reports until it lands on the tip are the app's own, not the
    // user's. An ended tip has no turn of its own: the frame lands on the last played turn, and that landing ends the guard.
    seekIntentRef.current = { turn: variationEnded ? tipTurn - 1 : tipTurn, until: Date.now() + PLAY_IN_GUARD_MS };
    navigateTo({ turn: tipTurn, line: 'variation' }, { seek: false, internal: true, followPlay: true });
  }, [branching, tipTurn, variationSpan, variationEnded, navigateTo, seekIntentRef]);
  useEffect(() => {
    executingRef.current = executing;
    if (!executing) holdFollowRef.current = false;
  }, [executing]);
  const holdTipFollow = useCallback(() => {
    if (executingRef.current) holdFollowRef.current = true;
  }, []);

  return { restorePointer, holdTipFollow, followNextTip };
}

/**
 * True when the frame's report is the echo of an older seek and must not move the pointer; a report that matches the intent
 * ends the guard. A held landing (`landOnTurn`) also ends on the last turn of a finished game: its frame stops one turn before the end.
 */
function frameReportIsEcho(seekIntentRef: SeekIntentRef, turn: number, endSnapshotTurn: number | null): boolean {
  const intent = seekIntentRef.current;
  if (!intent || Date.now() >= intent.until) return false;
  const endEcho = intent.until === Infinity && endSnapshotTurn !== null && intent.turn >= endSnapshotTurn && turn >= endSnapshotTurn - 1;
  if (turn !== intent.turn && !endEcho) return true;
  seekIntentRef.current = null;
  return false;
}

/**
 * An opened game's tip. A selection like the graph's, but the guard has no time limit: the frame of a game opened at start loads
 * its scripts from the network, and a report of turn 1 that comes after the four seconds of a selection moved the pointer off the
 * tip. The guard ends when the frame reports the turn, or when the user selects another one (every selection sets its own
 * intent). Turn 0 has no report to wait for and keeps the timed guard. A new document starts clean: a landing the old frame never
 * confirmed must not hold back the next replay's reports.
 */
function useLanding(seekIntentRef: SeekIntentRef, handleGraphSelect: (turn: number) => void, resetPointerState: () => void) {
  const landOnTurn = useCallback((turn: number) => {
    handleGraphSelect(turn);
    if (turn >= 1) seekIntentRef.current = { turn, until: Infinity };
  }, [handleGraphSelect, seekIntentRef]);
  const resetPointer = useCallback(() => {
    seekIntentRef.current = null;
    resetPointerState();
  }, [resetPointerState, seekIntentRef]);
  return { landOnTurn, resetPointer };
}

function useTimelineNav(args: NavArgs) {
  const { pointer, derived, atVariationEnd, interruptPlayOut, setAnalysisTurn } = args;
  const { setViewTurn, setViewLine, setViewT0, setFollowedPlay } = pointer;
  const { endSnapshotTurn } = derived;
  // Programmatic seeks race the embed's turn echoes: while the iframe is still seeking it keeps reporting the old turn, which
  // would knock the fresh selection straight back. Stale echoes are ignored until the embed confirms the seek or the window lapses.
  const seekIntentRef = useRef<{ turn: number; until: number } | null>(null);
  const frameTurnRef = useRef<number | null>(null);
  const { navigateTo, restorePointer, holdTipFollow, followNextTip } = useNavigateTo(args, seekIntentRef, frameTurnRef);

  const handleReplayTurn = useCallback((turn: number) => {
    // Remembered before the guards drop it: a tracker posts a turn only when it changes, so a dropped report never comes again, and
    // the finish of a play-out needs the turn the frame shows.
    frameTurnRef.current = turn;
    if (turn < 1) return;
    if (frameReportIsEcho(seekIntentRef, turn, endSnapshotTurn)) return;
    if (derived.viewingVariation) {
      // The branch frame's own Last turn / Next turn. A turn the variation does not cover is the shared prefix: the pointer leaves
      // for the main line there, and the main frame that opens gets the same echo guard. The start turn itself is the exception: the
      // branch frame's turn there shows the variation's own moves, so the pointer stays on the variation at its first covered turn.
      // Like the main line's end, the frame stays on the last played turn when the pointer sits on the end.
      if (atVariationEnd && derived.tipTurn !== null && turn >= derived.tipTurn - 1) return;
      const atStart = turn === derived.variationSpan?.startTurn;
      if (!atStart && !variationCovers(derived.variationSpan, turn)) seekIntentRef.current = { turn, until: Date.now() + 4000 };
      // A landed report spends the play: the user's own step, or the frame on the tip after playing the turn in. A rebuild afterwards
      // opens its document on the tip and plays nothing in again, and that replay's landing on the turn before the tip moved the pointer.
      setFollowedPlay(false);
      setViewTurn(atStart ? pointerAtFrame(turn, derived.variationSpan, false) ?? turn : turn);
      return;
    }
    setViewTurn(current => {
      // The embed can only report real turns; when the end position is selected its echo (last turn) must not knock the slider back.
      if (endSnapshotTurn !== null && current >= endSnapshotTurn && turn >= endSnapshotTurn - 1) {
        return current;
      }
      return turn;
    });
  }, [derived.viewingVariation, derived.variationSpan, atVariationEnd, derived.tipTurn, endSnapshotTurn, setViewTurn, setFollowedPlay]);

  const handleGraphSelect = useCallback((turn: number) => {
    interruptPlayOut();
    setFollowedPlay(false);
    if (turn >= 1) {
      setViewT0(false);
      seekIntentRef.current = { turn, until: Date.now() + 4000 };
      setViewTurn(turn);
    } else {
      // Turn 0: the team-preview view opens. The intent guard swallows the remount echoes a line switch can trigger.
      seekIntentRef.current = { turn: 0, until: Date.now() + 4000 };
      setViewT0(true);
    }
    setAnalysisTurn(turn);
  }, [setViewTurn, setViewT0, setFollowedPlay, setAnalysisTurn, interruptPlayOut]);

  const handleGraphSelectLine = useCallback((turn: number, line?: 'main' | 'variation') => {
    if (turn === 0 && line === undefined) {
      handleGraphSelect(0);
      return;
    }
    if (line === 'variation') {
      navigateTo({ turn, line: 'variation' });
      return;
    }
    setViewLine('main');
    handleGraphSelect(turn);
  }, [navigateTo, handleGraphSelect, setViewLine]);

  return { navigateTo, restorePointer, holdTipFollow, followNextTip, handleReplayTurn, handleGraphSelect, handleGraphSelectLine, seekIntentRef };
}

export function useTimeline(inputs: TimelineInputs) {
  const { replayId, snapshots, branching, variationStartTurn, history, interruptPlayOut, onNavigate, variationEnded = false, executing = false } = inputs;
  void replayId; // reset runs through resetPointer from the app's load effect
  const pointer = usePointerState();
  const derived = useTimelineDerived({ pointer, snapshots, branching, variationStartTurn, history });
  const atVariationEnd = variationEnded && derived.viewingVariation && derived.tipTurn !== null && pointer.viewTurn >= derived.tipTurn;

  // The analysis follows the replay position: selecting a turn is the analysis request; a lead selection (turn 0, set by
  // handleGraphSelect) survives until the slider moves. A render-phase adjustment, not an effect.
  const [analysisTurn, setAnalysisTurn] = useState<number | null>(null);
  const followKey = `${derived.viewingVariation}:${pointer.viewTurn}:${derived.analyzableTurns}`;
  const [seenFollowKey, setSeenFollowKey] = useState<string | null>(null);
  if (seenFollowKey !== followKey) {
    setSeenFollowKey(followKey);
    if (!derived.viewingVariation) {
      const turn = Math.min(Math.max(1, pointer.viewTurn), derived.analyzableTurns);
      setAnalysisTurn(prev => (turn === prev ? prev : turn));
    }
  }

  const nav = useTimelineNav({ pointer, derived, atVariationEnd, branching, interruptPlayOut, onNavigate, executing, variationEnded, setAnalysisTurn });
  const { seekIntentRef, ...navRest } = nav;
  const landing = useLanding(seekIntentRef, nav.handleGraphSelect, pointer.resetPointer);
  return { ...pointer, ...derived, ...navRest, ...landing, analysisTurn, atVariationEnd };
}

export type Timeline = ReturnType<typeof useTimeline>;
