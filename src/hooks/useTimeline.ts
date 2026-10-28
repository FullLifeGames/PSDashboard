import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { finalPlayedTurn, type TurnSnapshot } from '@fulllifegames/replay-core';
import {
  normalizePosition, variationCovers, variationTip,
  type TimelinePosition, type VariationSpan, type ViewLine,
} from '../lib/timeline';
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
  const { viewTurn, viewLine } = pointer;
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
   *  Forced interludes do not consume a turn (mirrors alignHistoryRows). */
  const variationSpan = useMemo<VariationSpan | null>(() => {
    if (variationStartTurn === null) return null;
    const turnEntries = history.filter(entry => entry.kind !== 'forced').length;
    return turnEntries > 0 ? { startTurn: variationStartTurn, length: turnEntries } : null;
  }, [variationStartTurn, history]);
  const viewingVariation = viewLine === 'variation' && variationCovers(variationSpan, viewTurn);
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
  /** Recorded position for the VIEWED variation turn (variant B pickers). */
  const serializedAtView = useMemo(() => {
    if (!viewingVariation || !variationSpan) return null;
    const wanted = viewTurn - variationSpan.startTurn;
    let consumed = 0;
    let last: string | null = null;
    for (const entry of history) {
      if (entry.kind !== 'forced') {
        if (consumed === wanted) break;
        consumed += 1;
      }
      if (consumed <= wanted) last = entry.serializedPosition ?? null;
    }
    return consumed === wanted ? last : null;
  }, [viewingVariation, variationSpan, viewTurn, history]);
  // The sweep counts PLAYED turns: the end snapshot is the slider's "End"
  // sentinel, not a turn.
  const analyzableTurns = useMemo(
    () => (snapshots.length > 0 ? finalPlayedTurn(snapshots) : 1),
    [snapshots],
  );
  return {
    maxTurn, endSnapshotTurn, atEndPosition, variationSpan, viewingVariation,
    liveSimTurn, liveTip, liveEvalView, evalViewKey, tipTurn, serializedAtView, analyzableTurns,
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
  setAnalysisTurn: (turn: number) => void;
}

type SeekIntentRef = { current: { turn: number; until: number } | null };

/** The single pointer move plus the tip-follow after executed turns. */
function useNavigateTo(args: NavArgs, seekIntentRef: SeekIntentRef) {
  const { pointer, derived, branching, interruptPlayOut, onNavigate } = args;
  const { setViewTurn, setViewLine, setViewT0, setNavSeek, setFollowedPlay } = pointer;
  const { maxTurn, variationSpan, tipTurn } = derived;

  const navigateTo = useCallback((position: TimelinePosition, opts?: { seek?: boolean; internal?: boolean; followPlay?: boolean }) => {
    if (!opts?.internal) interruptPlayOut();
    const next = normalizePosition(position, maxTurn, variationSpan);
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
    if (opts?.seek !== false) {
      setNavSeek(prev => ({ turn: next.turn, seq: (prev?.seq ?? 0) + 1 }));
      seekIntentRef.current = { turn: next.turn, until: Date.now() + 4000 };
    }
  }, [maxTurn, variationSpan, setViewTurn, setViewLine, setViewT0, setNavSeek, setFollowedPlay, interruptPlayOut, onNavigate, seekIntentRef]);

  // Executed turns move the pointer WITH the play — the tip is where the
  // next choice happens (chess: the board follows the line you play).
  // A rebuild that keeps the span (a set edit replays the same turns into new objects) is no executed
  // turn: the pointer stays where the user looks (round 77, D3). The key names the span, so a variation
  // that ended and a new one with the same tip follows again.
  const followedKeyRef = useRef<string | null>(null);
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
  useEffect(() => {
    if (!branching || tipTurn === null || variationSpan === null) {
      followedKeyRef.current = null;
      return;
    }
    const key = `${variationSpan.startTurn}:${tipTurn}`;
    if (followedKeyRef.current === key) return;
    followedKeyRef.current = key;
    // The frame plays the turn in from the one before the tip: its reports until it lands on the tip are the
    // app's own, not the user's (round 77, A-4).
    seekIntentRef.current = { turn: tipTurn, until: Date.now() + 4000 };
    navigateTo({ turn: tipTurn, line: 'variation' }, { seek: false, internal: true, followPlay: true });
  }, [branching, tipTurn, variationSpan, navigateTo, seekIntentRef]);

  return { navigateTo, restorePointer };
}

/** Embed echo guard and the graph's explicit line-addressed selections. */
function useTimelineNav(args: NavArgs) {
  const { pointer, derived, atVariationEnd, interruptPlayOut, setAnalysisTurn } = args;
  const { setViewTurn, setViewLine, setViewT0, setFollowedPlay, viewTurnRef } = pointer;
  const { endSnapshotTurn } = derived;
  // Programmatic seeks race the embed's turn echoes: while the iframe is
  // still seeking it keeps reporting the OLD turn, which would knock the
  // fresh selection straight back. Stale echoes are ignored until the embed
  // confirms the seek or the window lapses.
  const seekIntentRef = useRef<{ turn: number; until: number } | null>(null);
  const { navigateTo, restorePointer } = useNavigateTo(args, seekIntentRef);

  const handleReplayTurn = useCallback((turn: number) => {
    if (turn < 1) return;
    const intent = seekIntentRef.current;
    if (intent && Date.now() < intent.until) {
      if (turn !== intent.turn) return;
      seekIntentRef.current = null;
    }
    if (derived.viewingVariation) {
      // The branch frame's own Last turn / Next turn. A turn the variation does not cover is the shared prefix: the
      // pointer leaves for the main line there, and the main frame that opens gets the same echo guard.
      // Like the main line's end (B12): the frame stays on the last played turn when the pointer sits on the end.
      if (atVariationEnd && derived.tipTurn !== null && turn >= derived.tipTurn - 1) return;
      if (!variationCovers(derived.variationSpan, turn)) seekIntentRef.current = { turn, until: Date.now() + 4000 };
      if (turn !== viewTurnRef.current) setFollowedPlay(false);
      setViewTurn(turn);
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
  }, [derived.viewingVariation, derived.variationSpan, atVariationEnd, derived.tipTurn, endSnapshotTurn, setViewTurn, setFollowedPlay, viewTurnRef]);

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
    if (line === 'variation') {
      navigateTo({ turn, line: 'variation' });
      return;
    }
    setViewLine('main');
    handleGraphSelect(turn);
  }, [navigateTo, handleGraphSelect, setViewLine]);

  return { navigateTo, restorePointer, handleReplayTurn, handleGraphSelect, handleGraphSelectLine };
}

export function useTimeline(inputs: TimelineInputs) {
  const { replayId, snapshots, branching, variationStartTurn, history, interruptPlayOut, onNavigate, variationEnded = false } = inputs;
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

  const nav = useTimelineNav({ pointer, derived, atVariationEnd, branching, interruptPlayOut, onNavigate, setAnalysisTurn });
  return { ...pointer, ...derived, ...nav, analysisTurn, atVariationEnd };
}

export type Timeline = ReturnType<typeof useTimeline>;
