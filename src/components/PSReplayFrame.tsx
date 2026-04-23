import { useEffect, useMemo, useRef } from 'react';
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
  onTurnChange?: (turn: number) => void;
}

/**
 * Renders a real Pokémon Showdown replay viewer in an iframe.
 * The iframe loads replay-embed.js from play.pokemonshowdown.com
 * which provides the full battle scene, animations, and playback controls.
 *
 * When seekTurn is set, the replay automatically seeks to that turn.
 * autoPlay controls whether the replay plays or pauses after seeking.
 * onTurnChange fires when the user scrubs/plays to a different turn.
 */
export function PSReplayFrame({ log, format, p1, p2, title, height = 400, seekTurn, autoPlay, onTurnChange }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const reportTurn = !!onTurnChange;

  const blobUrl = useMemo(() => {
    if (!log.trim()) {
      return null;
    }

    const html = generateReplayHtml({ log, format, p1, p2, title, seekTurn, autoPlay, reportTurn });
    return createBlobUrl(html);
  }, [log, format, p1, p2, title, seekTurn, autoPlay, reportTurn]);

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
      style={{
        width: '100%',
        height,
        border: 'none',
        borderRadius: 5,
        background: '#344b6c',
        marginTop: '-22px',
      }}
      sandbox="allow-scripts allow-same-origin"
      title={title || 'PS Replay'}
    />
  );
}
