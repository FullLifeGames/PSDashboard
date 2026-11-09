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
  /** User navigation must stop an engine play-out (internal moves keep it). */
  interruptPlayOut: () => void;
  /** Every pointer move clears position-bound drafts. */
  onNavigate: () => void;
  /** The live sim of the variation has a winner: its tip is an end position (round 77, A-6). */
  variationEnded?: boolean;
  /** A turn of the live sim is running; the turn lands with the history entry (round 77, C5). */
  executing?: boolean;
}

/** The pointer's own state: view turn (with its synchronous ref), line,
 *  T0 flag, one-shot seek, variation score overlay. */
function usePointerState() {
  const [viewTurn, setViewTurnState] = useState(1);
  /**
   * Synchronous mirror of viewTurn: a slider change followed by an
   * immediate "Branch Here" click can fire BEFORE React commits the
   * re-render, so the click handler's closure still holds the old turn.
   * Handlers that act on the selected turn read the ref, never the closure.
   */
  const viewTurnRef = useRef(1);
  const setViewTurn = useCallback((value: number | ((turn: number) => number)) => {
    // The REF is authoritative and written synchronously in the event —
    // a setState updater only runs at the NEXT render, which is exactly
    // the window the race lives in.
    const next = typeof value === 'function' ? value(viewTurnRef.current) : value;
    viewTurnRef.current = next;
    setViewTurnState(next);
  }, []);
  const [viewLine, setViewLine] = useState<ViewLine>('main');
  const [viewT0, setViewT0] = useState(false);
  /**
   * One-shot seek command for the branch iframe, which ignores seekTurn prop
   * changes after mount (re-seeking every render fought the append stream).
   * Bumped by user navigation; the tip-follow after an executed turn skips it.
   */
  const [navSeek, setNavSeek] = useState<{ turn: number; seq: number; play?: boolean } | null>(null);
  /**
   * The pointer stands where it followed an executed turn, not where the user moved it: a branch frame
   * that opens there plays that turn in (round 77, user report 28.10.2026).
   */
  const [followedPlay, setFollowedPlay] = useState(false);
  /**
   * Variation evals for the graph overlay: variationScores[turn − 1] = score
   * of the variation position before that turn. Session-scoped.
   */
  const [variationScores, setVariationScores] = useState<(number | null)[]>([]);
  /** One call resets the pointer for a fresh replay (slider at turn 1, B11). */
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

/** Everything derived from the pointer plus the branch session. */
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
  // The last snapshot is the post-battle end state when it holds the final
  // turn's residue instead of starting a new |turn| — it is labelled "End",
  // kept stable against iframe echoes, and blocked as a branch target.
  const endSnapshotTurn = useMemo(() => {
    if (snapshots.length < 2) return null;
    const last = snapshots[snapshots.length - 1];
    return last.log.some(line => line.startsWith('|turn|')) ? null : last.turn;
  }, [snapshots]);
  const atEndPosition = endSnapshotTurn !== null && viewTurn >= endSnapshotTurn;
  /** The variation as a pure span: null until a turn actually executed.
   *  Interludes (a replacement on one side or on both) do not consume a turn (round 88, T348: `variation-turns.ts`). */
  const variationSpan = useMemo<VariationSpan | null>(() => {
    if (variationStartTurn === null) return null;
    const turnEntries = turnEntryCount(history);
    return turnEntries > 0 ? { startTurn: variationStartTurn, length: turnEntries } : null;
  }, [variationStartTurn, history]);
  // The T0 view is a side trip: the line stays as the user left it (the step forward returns there), but nothing of
  // the variation is on screen (round 77, C9).
  const viewingVariation = viewLine === 'variation' && !viewT0 && variationCovers(variationSpan, viewTurn);
  /** Where the live sim stands (the tip of what has been replayed/executed). */
  const liveSimTurn = branching && variationStartTurn !== null
    ? variationStartTurn + (variationSpan?.length ?? 0)
    : null;
  /** The pointer sits ON the live sim — pickers/executes go straight to it. */
  const liveTip = liveSimTurn !== null && viewTurn === liveSimTurn
    && (variationSpan === null || viewingVariation);
  /** Positions whose evaluation is the LIVE single result rather than the
   *  main line's stored graph data. */
  const liveEvalView = liveTip || viewingVariation;
  /** Identity of the position on screen for the eval result (stale guard). */
  const evalViewKey = `${viewingVariation ? 'variation' : 'main'}:${viewTurn}`;
  const tipTurn = variationSpan ? variationTip(variationSpan) : null;
  /**
   * Round 89 (#112): the live sim's own position, whatever the pointer shows: `key` is what `evalViewKey` reads while the pointer
   * stands on the tip. The play-out evaluates and steps on this position, so a frame report that moves the pointer elsewhere
   * does not stop the run.
   */
  const spanned = variationSpan !== null;
  const tip = useMemo(
    () => (liveSimTurn === null ? null : { key: `${spanned ? 'variation' : 'main'}:${liveSimTurn}`, turn: liveSimTurn, variation: spanned }),
    [liveSimTurn, spanned],
  );
  /** Recorded position for the VIEWED variation turn (variant B pickers). */
  const serializedAtView = useMemo(() => {
    if (!viewingVariation || !variationSpan) return null;
    return settledEntryAfterTurns(history, viewTurn - variationSpan.startTurn)?.serializedPosition ?? null;
  }, [viewingVariation, variationSpan, viewTurn, history]);
  // The sweep counts PLAYED turns: the end snapshot is the slider's "End"
  // sentinel, not a turn.
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
  /** The live sim of the variation has a winner (round 77, A-6). */
  variationEnded: boolean;
  setAnalysisTurn: (turn: number) => void;
}

type SeekIntentRef = { current: { turn: number; until: number } | null };
/** The last turn any frame reported, whether the guards let it move the pointer or not (round 88, T347). */
type FrameTurnRef = { current: number | null };

/**
 * How long the frame's reports count as the app's own while it plays a followed turn in. The guard ends when the frame
 * lands on the tip; the bound covers a new document's load, which took more than four seconds under the full e2e suite
 * after a set edit, and its landing on the turn before the tip moved the pointer off the variation (round 77).
 */
const PLAY_IN_GUARD_MS = 20_000;

/**
 * `toFrame` (round 88, T347, #83): the pointer takes the variation position of a turn the branch frame shows and never
 * seeks it. `true` names the last turn any frame reported, a number the turn the frame is about to show (Watch from turn
 * N); without a variation or a report the given position stands.
 */
type Navigate = (
  position: TimelinePosition,
  opts?: { seek?: boolean; internal?: boolean; followPlay?: boolean; toFrame?: true | number },
) => void;

/** The single pointer move plus the tip-follow after executed turns. */
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
    // The stored line is the user's INTENT, sticky across uncovered turns:
    // only an explicit 'main' request (chip, notation, graph) leaves the
    // variation.
    const sticky: ViewLine =
      variationSpan === null ? 'main'
      : next.line === 'variation' ? 'variation'
      : position.line;
    setViewLine(sticky);
    onNavigate();
    if (atFrame !== null) {
      // The frame's own reports move the pointer from here on: the guard of the run's tip-follow ends.
      seekIntentRef.current = null;
    } else if (opts?.seek !== false) {
      setNavSeek(prev => ({ turn: next.turn, seq: (prev?.seq ?? 0) + 1 }));
      seekIntentRef.current = { turn: next.turn, until: Date.now() + 4000 };
    }
  }, [maxTurn, variationSpan, variationEnded, setViewTurn, setViewLine, setViewT0, setNavSeek, setFollowedPlay, interruptPlayOut, onNavigate, seekIntentRef, frameTurnRef]);

  return { navigateTo, ...useTipFollow(args, seekIntentRef, navigateTo) };
}

/**
 * Executed turns move the pointer WITH the play — the tip is where the
 * next choice happens (chess: the board follows the line you play).
 * A rebuild that keeps the span (a set edit replays the same turns into new objects) is no executed
 * turn: the pointer stays where the user looks (round 77, D3). The key names the span, so a variation
 * that ended and a new one with the same tip follows again.
 */
function useTipFollow(args: NavArgs, seekIntentRef: SeekIntentRef, navigateTo: Navigate) {
  const { pointer, derived, branching, executing, variationEnded } = args;
  const { setViewTurn, setViewLine, setViewT0, setNavSeek, setFollowedPlay } = pointer;
  const { variationSpan, tipTurn } = derived;
  const followedKeyRef = useRef<string | null>(null);
  const executingRef = useRef(false);
  const holdFollowRef = useRef(false);
  /**
   * Puts the pointer back after a rebuild the user did not ask to follow (a failed execute restored the old
   * variation, round 77): the span that comes back counts as followed already, so the tip-follow stays put.
   */
  const restorePointer = useCallback((position: TimelinePosition, span: VariationSpan | null) => {
    followedKeyRef.current = span ? `${span.startTurn}:${variationTip(span)}` : null;
    setViewT0(false);
    setViewTurn(position.turn);
    setViewLine(position.line);
    setFollowedPlay(false);
    setNavSeek(prev => ({ turn: position.turn, seq: (prev?.seq ?? 0) + 1 }));
  }, [setViewT0, setViewTurn, setViewLine, setFollowedPlay, setNavSeek]);
  /**
   * The user starts a new variation (round 80): its tip is followed even when its span matches the one it replaces.
   * A second start from turn 0 kept the key "0:1" and left the pointer on the lead picker (Champions VGC 2646618972).
   */
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
    // The view was handed back while this turn was in flight (Stop, or the user's own click): the turn lands
    // where the user is not looking, so the pointer stays (round 77, C5).
    if (holdFollowRef.current) {
      holdFollowRef.current = false;
      return;
    }
    // The frame plays the turn in from the one before the tip: its reports until it lands on the tip are the
    // app's own, not the user's (round 77, A-4). An ended tip has no turn of its own: the frame lands on the last
    // played turn, and that landing ends the guard.
    seekIntentRef.current = { turn: variationEnded ? tipTurn - 1 : tipTurn, until: Date.now() + PLAY_IN_GUARD_MS };
    navigateTo({ turn: tipTurn, line: 'variation' }, { seek: false, internal: true, followPlay: true });
  }, [branching, tipTurn, variationSpan, variationEnded, navigateTo, seekIntentRef]);
  // Declared after the follow effect: a landing turn is seen by it before this one clears the hold.
  useEffect(() => {
    executingRef.current = executing;
    if (!executing) holdFollowRef.current = false;
  }, [executing]);
  /** Keeps the pointer where it is when the turn in flight lands; void when no turn is in flight. */
  const holdTipFollow = useCallback(() => {
    if (executingRef.current) holdFollowRef.current = true;
  }, []);

  return { restorePointer, holdTipFollow, followNextTip };
}

/** Embed echo guard and the graph's explicit line-addressed selections. */
function useTimelineNav(args: NavArgs) {
  const { pointer, derived, atVariationEnd, interruptPlayOut, setAnalysisTurn } = args;
  const { setViewTurn, setViewLine, setViewT0, setFollowedPlay } = pointer;
  const { endSnapshotTurn } = derived;
  // Programmatic seeks race the embed's turn echoes: while the iframe is
  // still seeking it keeps reporting the OLD turn, which would knock the
  // fresh selection straight back. Stale echoes are ignored until the embed
  // confirms the seek or the window lapses.
  const seekIntentRef = useRef<{ turn: number; until: number } | null>(null);
  const frameTurnRef = useRef<number | null>(null);
  const { navigateTo, restorePointer, holdTipFollow, followNextTip } = useNavigateTo(args, seekIntentRef, frameTurnRef);

  const handleReplayTurn = useCallback((turn: number) => {
    // Remembered before the guards drop it: a tracker posts a turn only when it changes, so a dropped report never comes
    // again, and the finish of a play-out needs the turn the frame shows (round 88, T347).
    frameTurnRef.current = turn;
    if (turn < 1) return;
    const intent = seekIntentRef.current;
    if (intent && Date.now() < intent.until) {
      if (turn !== intent.turn) return;
      seekIntentRef.current = null;
    }
    if (derived.viewingVariation) {
      // The branch frame's own Last turn / Next turn. A turn the variation does not cover is the shared prefix: the
      // pointer leaves for the main line there, and the main frame that opens gets the same echo guard. The start turn
      // itself is the exception (round 88, T347): the branch frame's turn there shows the variation's own moves, so the pointer
      // stays on the variation at its first covered turn.
      // Like the main line's end (B12): the frame stays on the last played turn when the pointer sits on the end.
      if (atVariationEnd && derived.tipTurn !== null && turn >= derived.tipTurn - 1) return;
      const atStart = turn === derived.variationSpan?.startTurn;
      if (!atStart && !variationCovers(derived.variationSpan, turn)) seekIntentRef.current = { turn, until: Date.now() + 4000 };
      // A landed report spends the play: the user's own step, or the frame on the tip after playing the turn in. A
      // rebuild afterwards (a set edit) opens its document on the tip and plays nothing in again; that replay's landing
      // on the turn before the tip moved the pointer off the variation (round 77).
      setFollowedPlay(false);
      setViewTurn(atStart ? pointerAtFrame(turn, derived.variationSpan, false) ?? turn : turn);
      return;
    }
    setViewTurn(current => {
      // The embed can only report real turns; when the end position is
      // selected its echo (last turn) must not knock the slider back (B12).
      if (endSnapshotTurn !== null && current >= endSnapshotTurn && turn >= endSnapshotTurn - 1) {
        return current;
      }
      return turn;
    });
  }, [derived.viewingVariation, derived.variationSpan, atVariationEnd, derived.tipTurn, endSnapshotTurn, setViewTurn, setFollowedPlay]);

  const handleGraphSelect = useCallback((turn: number) => {
    // Selecting a turn is user navigation — it bypasses navigateTo, so the
    // same "navigation stops the engine's run" rule applies here.
    interruptPlayOut();
    setFollowedPlay(false);
    if (turn >= 1) {
      setViewT0(false);
      seekIntentRef.current = { turn, until: Date.now() + 4000 };
      // Direct, not via handleReplayTurn: an explicit selection beats the
      // echo guards (which exist to protect against the embed, not the user).
      setViewTurn(turn);
    } else {
      // Turn 0: the team-preview view opens — the replay frame seeks to the
      // preview and the lead picker replaces the turn pickers. The intent
      // guard swallows the remount echoes a line switch can trigger.
      seekIntentRef.current = { turn: 0, until: Date.now() + 4000 };
      setViewT0(true);
    }
    setAnalysisTurn(turn);
  }, [setViewTurn, setViewT0, setFollowedPlay, setAnalysisTurn, interruptPlayOut]);

  /** Graph clicks name their line explicitly — gold points navigate the
   *  variation, blue points the main line. */
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

  return { navigateTo, restorePointer, holdTipFollow, followNextTip, handleReplayTurn, handleGraphSelect, handleGraphSelectLine };
}

export function useTimeline(inputs: TimelineInputs) {
  const { replayId, snapshots, branching, variationStartTurn, history, interruptPlayOut, onNavigate, variationEnded = false, executing = false } = inputs;
  void replayId; // reset runs through resetPointer from the app's load effect
  const pointer = usePointerState();
  const derived = useTimelineDerived({ pointer, snapshots, branching, variationStartTurn, history });
  /** The pointer sits on the ended tip of the variation (the main line's End has its own flag). */
  const atVariationEnd = variationEnded && derived.viewingVariation && derived.tipTurn !== null && pointer.viewTurn >= derived.tipTurn;

  // The analysis follows the replay position — selecting a turn IS the
  // analysis request; a lead selection (turn 0, set by handleGraphSelect)
  // survives until the slider moves. Render-phase adjustment keyed on the
  // old effect's dependency tuple, so it fires exactly when that did.
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
  return { ...pointer, ...derived, ...nav, analysisTurn, atVariationEnd };
}

export type Timeline = ReturnType<typeof useTimeline>;
