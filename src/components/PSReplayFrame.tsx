import { useRef, useState } from 'react';
import {
  extendsLines, frameLines, useLiveAppend, useReplayBlobUrl, useSeekRequests, useSeekTurn, useTurnReports, type SeekRequest,
} from '../hooks/useReplayFrame';

interface Props {
  log: string;
  format?: string;
  p1?: string;
  p2?: string;
  title?: string;
  height?: number;
  seekTurn?: number;
  autoPlay?: boolean;
  liveUpdates?: boolean;
  /** 'hold' appends without seeking — the frame stays where it is while a
   *  play-out streams turns in; the finish notice's watch seek moves it. */
  liveAppendMode?: 'play' | 'follow-end' | 'hold';
  liveAppendTurn?: number | null;
  /**
   * A live document that opens now opens at the start of this turn and plays the turn in: the pointer
   * followed a turn that just ran, and the frame mounted after it (the first turn of a new variation).
   */
  openAtTurn?: number | null;
  reloadKey?: string;
  /** Viewer perspective — 'p2' renders from player 2's side (the ?p2 replay-URL flag). */
  viewpoint?: 'p1' | 'p2';
  onTurnChange?: (turn: number) => void;
  /**
   * Explicit one-shot seek command for live-update frames, which ignore
   * seekTurn prop changes after mount (re-seeking on every render fought
   * the append stream). Bump `seq` to send; `play` starts playback there —
   * the "watch the line from its branch point" affordance.
   */
  seekRequest?: SeekRequest | null;
}

/**
 * Renders a real Pokémon Showdown replay viewer in an iframe.
 * The iframe loads replay-embed.js from play.pokemonshowdown.com
 * which provides the full battle scene, animations, and playback controls.
 *
 * When seekTurn is set, the replay is asked to seek in-place via postMessage
 * so changing turns does not rebuild the iframe.
 * onTurnChange fires when the user scrubs/plays to a different turn.
 */
interface DocumentProps extends Props {
  documentLog: string;
  /** The turn a new document opens on: the opening turn's start, or the pointer's turn. */
  documentSeekTurn?: number;
}

export function PSReplayFrame(props: Props) {
  const generation = useLiveDocumentGeneration(props.log, !!props.liveUpdates);
  const key = props.liveUpdates
    ? `live:${props.reloadKey ?? 'default'}:${generation}`
    : `static:${props.reloadKey ?? props.log.length}`;
  const opening = props.liveUpdates ? openingAt(props.log, props.openAtTurn) : null;
  return (
    <PSReplayFrameDocument
      key={key}
      {...props}
      documentLog={opening?.log ?? props.log}
      documentSeekTurn={opening ? opening.turn : props.seekTurn}
    />
  );
}

/**
 * The log up to the line that starts `turn`, when lines follow it: a document on that prefix shows the
 * position before the turn, and the append that brings the rest plays the turn (round 77, user report
 * 28.10.2026: the first turn of a new variation opened on its end).
 */
function openingAt(log: string, turn: number | null | undefined): { log: string; turn: number } | null {
  if (turn == null || turn < 1) return null;
  const lines = log.split('\n');
  const start = lines.indexOf(`|turn|${turn}`);
  if (start < 0 || !lines.slice(start + 1).some(Boolean)) return null;
  return { log: lines.slice(0, start + 1).join('\n'), turn };
}

/**
 * A live frame keeps its document and streams appended lines into it. A log that no longer extends the last one (the
 * branch rebuilt for a new choice behind its tip, or for a team edit) starts a new document: appended to the old one, the
 * new turn played after the old tail, and the frame showed the old attack and then the new one (round 77, user report
 * 28.10.2026). Reconciled during render, as state that follows a prop is.
 */
function useLiveDocumentGeneration(log: string, liveUpdates: boolean): number {
  const [seen, setSeen] = useState({ log, generation: 0 });
  if (liveUpdates && log !== seen.log) {
    const appends = extendsLines(frameLines(seen.log), frameLines(log));
    setSeen({ log, generation: appends ? seen.generation : seen.generation + 1 });
  }
  return seen.generation;
}

function EmptyFrame({ height }: { height: number }) {
  return (
    <div style={{
      height,
      background: '#1a2a4c',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#556',
      fontSize: 13,
    }}>
      No battle log loaded
    </div>
  );
}

function PSReplayFrameDocument({
  log,
  documentLog: initialDocumentLog,
  documentSeekTurn,
  format,
  p1,
  p2,
  title,
  height = 400,
  seekTurn,
  autoPlay,
  liveUpdates = false,
  liveAppendMode = 'follow-end',
  liveAppendTurn = null,
  reloadKey = 'default',
  viewpoint,
  onTurnChange,
  seekRequest = null,
}: DocumentProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const reportTurn = !!onTurnChange;
  const [documentLog] = useState(initialDocumentLog);
  const [initialSeek] = useState(() => ({ seekTurn: documentSeekTurn, autoPlay }));
  // A live document seeks once, to where it opened; navigation reaches it through seekRequest and new
  // lines through appends, so a later seekTurn never moves it (a late load event would end a turn playing in).
  const frameSeekTurn = liveUpdates ? initialSeek.seekTurn : seekTurn;

  const blobUrl = useReplayBlobUrl({ documentLog, format, p1, p2, title, initialSeek, reportTurn, viewpoint });
  const lastReportedTurnRef = useTurnReports(onTurnChange, blobUrl);
  useSeekTurn({ iframeRef, seekTurn: frameSeekTurn, autoPlay, blobUrl, liveUpdates, lastReportedTurnRef });
  useSeekRequests(iframeRef, seekRequest);
  useLiveAppend({ iframeRef, liveUpdates, reloadKey, blobUrl, documentLog, log, seekTurn, liveAppendMode, liveAppendTurn });

  if (!blobUrl) {
    return <EmptyFrame height={height} />;
  }

  return (
    // No sandbox: a same-origin blob document with allow-scripts can strip
    // its own sandboxing (Firefox warns about exactly that combination), so
    // the attribute bought console noise, not isolation.
    <iframe
      ref={iframeRef}
      src={blobUrl}
      onLoad={() => {
        if (frameSeekTurn == null) return;
        iframeRef.current?.contentWindow?.postMessage({
          type: 'ps-seek-turn',
          turn: frameSeekTurn,
          autoPlay: !!autoPlay,
        }, '*');
      }}
      style={{
        width: '100%',
        height,
        border: 'none',
        borderRadius: 5,
        background: '#344b6c',
        marginTop: 0,
      }}
      title={title || 'PS Replay'}
    />
  );
}
