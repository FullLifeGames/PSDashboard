import { useEffect, useRef, useState } from 'react';
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
}

/**
 * Renders a real Pokémon Showdown replay viewer in an iframe.
 * The iframe loads replay-embed.js from play.pokemonshowdown.com
 * which provides the full battle scene, animations, and playback controls.
 *
 * When seekTurn is set, the replay automatically seeks to that turn.
 * autoPlay controls whether the replay plays or pauses after seeking.
 */
export function PSReplayFrame({ log, format, p1, p2, title, height = 400, seekTurn, autoPlay }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!log.trim()) {
      setBlobUrl(null);
      return;
    }

    const html = generateReplayHtml({ log, format, p1, p2, title, seekTurn, autoPlay });
    const url = createBlobUrl(html);
    setBlobUrl(url);

    return () => revokeBlobUrl(url);
  }, [log, format, p1, p2, title, seekTurn, autoPlay]);

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
      }}
      sandbox="allow-scripts allow-same-origin"
      title={title || 'PS Replay'}
    />
  );
}
