import { useRef, useState } from 'react';
import {
  useLiveAppend, useReplayBlobUrl, useSeekRequests, useSeekTurn, useTurnReports, type SeekRequest,
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
}

export function PSReplayFrame(props: Props) {
  const key = props.liveUpdates
    ? `live:${props.reloadKey ?? 'default'}`
    : `static:${props.reloadKey ?? props.log.length}`;
  return <PSReplayFrameDocument key={key} {...props} documentLog={props.log} />;
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
  const [initialSeek] = useState(() => ({ seekTurn, autoPlay }));

  const blobUrl = useReplayBlobUrl({ documentLog, format, p1, p2, title, initialSeek, reportTurn, viewpoint });
  const lastReportedTurnRef = useTurnReports(onTurnChange, blobUrl);
  useSeekTurn({ iframeRef, seekTurn, autoPlay, blobUrl, liveUpdates, lastReportedTurnRef });
  useSeekRequests(iframeRef, seekRequest);
  useLiveAppend({ iframeRef, liveUpdates, reloadKey, blobUrl, log, seekTurn, liveAppendMode, liveAppendTurn });

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
        if (seekTurn == null) return;
        iframeRef.current?.contentWindow?.postMessage({
          type: 'ps-seek-turn',
          turn: seekTurn,
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
