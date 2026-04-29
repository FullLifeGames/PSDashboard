import { useEffect, useMemo, useRef, useState } from 'react';
import { generateReplayHtml, createBlobUrl, revokeBlobUrl } from '../lib/replay-html';

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
  reloadKey?: string;
  onTurnChange?: (turn: number) => void;
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
  reloadKey = 'default',
  onTurnChange,
}: DocumentProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sentLogRef = useRef<{ key: string; blobUrl: string; lines: string[] } | null>(null);
  const didInitialLiveSeekRef = useRef(false);
  const reportTurn = !!onTurnChange;
  const [documentLog] = useState(initialDocumentLog);
  const [initialSeek] = useState(() => ({ seekTurn, autoPlay }));

  const blobUrl = useMemo(() => {
    if (!documentLog.trim()) {
      return null;
    }

    const html = generateReplayHtml({
      log: documentLog,
      format,
      p1,
      p2,
      title,
      seekTurn: initialSeek.seekTurn,
      autoPlay: initialSeek.autoPlay,
      reportTurn,
    });
    return createBlobUrl(html);
  }, [documentLog, format, p1, p2, title, initialSeek, reportTurn]);

  useEffect(() => {
    if (!blobUrl) return;
    return () => revokeBlobUrl(blobUrl);
  }, [blobUrl]);

  // Listen for turn change messages from the iframe
  useEffect(() => {
    if (!onTurnChange) return;

    const handler = (e: MessageEvent) => {
      if (e.data && e.data.type === 'ps-turn' && typeof e.data.turn === 'number') {
        onTurnChange(e.data.turn);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onTurnChange]);

  useEffect(() => {
    if (seekTurn == null) return;
    if (liveUpdates && didInitialLiveSeekRef.current) return;
    const sendSeek = () => iframeRef.current?.contentWindow?.postMessage({
      type: 'ps-seek-turn',
      turn: seekTurn,
      autoPlay: !!autoPlay,
    }, '*');
    didInitialLiveSeekRef.current = true;
    sendSeek();
    const retry = window.setInterval(sendSeek, 200);
    const stopRetry = window.setTimeout(() => window.clearInterval(retry), 1200);

    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'ps-replay-ready') sendSeek();
    };
    window.addEventListener('message', handler);
    return () => {
      window.clearInterval(retry);
      window.clearTimeout(stopRetry);
      window.removeEventListener('message', handler);
    };
  }, [seekTurn, autoPlay, blobUrl, liveUpdates]);

  useEffect(() => {
    if (!liveUpdates || !blobUrl) return;

    const lines = log.split('\n').filter(Boolean);
    const previous = sentLogRef.current;
    if (!previous || previous.key !== reloadKey || previous.blobUrl !== blobUrl) {
      sentLogRef.current = { key: reloadKey, blobUrl, lines };
      return;
    }

    const canAppend = previous.lines.length <= lines.length &&
      previous.lines.every((line, index) => line === lines[index]);
    if (canAppend && lines.length > previous.lines.length) {
      iframeRef.current?.contentWindow?.postMessage({
        type: 'ps-append-log',
        lines: lines.slice(previous.lines.length),
        seekTurn,
        followEnd: true,
      }, '*');
    }
    sentLogRef.current = { key: reloadKey, blobUrl, lines };
  }, [liveUpdates, reloadKey, blobUrl, log, seekTurn]);

  if (!blobUrl) {
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

  return (
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
      sandbox="allow-scripts allow-same-origin"
      title={title || 'PS Replay'}
    />
  );
}
