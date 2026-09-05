import { useEffect, useMemo, useRef } from 'react';
import { generateReplayHtml, createBlobUrl, revokeBlobUrl } from '../lib/replay-html';
import { localFontAwesomeUrl } from '../lib/replay-compat';

type FrameRef = React.RefObject<HTMLIFrameElement | null>;

const postSeek = (iframeRef: FrameRef, turn: number, autoPlay: boolean) =>
  iframeRef.current?.contentWindow?.postMessage({ type: 'ps-seek-turn', turn, autoPlay }, '*');

/** The replay document as a blob URL (revoked when it changes or the frame unmounts). */
export function useReplayBlobUrl(args: {
  documentLog: string;
  format?: string;
  p1?: string;
  p2?: string;
  title?: string;
  initialSeek: { seekTurn?: number; autoPlay?: boolean };
  reportTurn: boolean;
  viewpoint?: 'p1' | 'p2';
}): string | null {
  const { documentLog, format, p1, p2, title, initialSeek, reportTurn, viewpoint } = args;
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
      viewpoint,
      fontAwesomeWoff2Url: localFontAwesomeUrl(),
    });
    return createBlobUrl(html);
  }, [documentLog, format, p1, p2, title, initialSeek, reportTurn, viewpoint]);

  useEffect(() => {
    if (!blobUrl) return;
    return () => revokeBlobUrl(blobUrl);
  }, [blobUrl]);

  return blobUrl;
}

/** Listen for turn change messages from the iframe; remembers the last turn it reported. */
export function useTurnReports(onTurnChange: ((turn: number) => void) | undefined, blobUrl: string | null) {
  const lastReportedTurnRef = useRef<number | null>(null);

  useEffect(() => {
    if (!onTurnChange) return;

    const handler = (e: MessageEvent) => {
      if (e.data && e.data.type === 'ps-turn' && typeof e.data.turn === 'number') {
        lastReportedTurnRef.current = e.data.turn;
        onTurnChange(e.data.turn);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onTurnChange]);

  useEffect(() => {
    lastReportedTurnRef.current = null;
  }, [blobUrl]);

  return lastReportedTurnRef;
}

/** Seeks the frame to seekTurn (once for live frames; never for a turn the frame itself just reported). */
export function useSeekTurn(args: {
  iframeRef: FrameRef;
  seekTurn: number | undefined;
  autoPlay: boolean | undefined;
  blobUrl: string | null;
  liveUpdates: boolean;
  lastReportedTurnRef: React.RefObject<number | null>;
}) {
  const { iframeRef, seekTurn, autoPlay, blobUrl, liveUpdates, lastReportedTurnRef } = args;
  const didInitialLiveSeekRef = useRef(false);
  useEffect(() => {
    if (seekTurn == null) return;
    if (liveUpdates && didInitialLiveSeekRef.current) return;
    // When the seekTurn change is just the echo of a turn the iframe itself
    // reported (user pressed Play/Next inside the embed), re-seeking would
    // pause playback after every turn (B9a) — skip it.
    if (!liveUpdates && lastReportedTurnRef.current === seekTurn) return;
    const sendSeek = () => postSeek(iframeRef, seekTurn, !!autoPlay);
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
  }, [seekTurn, autoPlay, blobUrl, liveUpdates, iframeRef, lastReportedTurnRef]);
}

export interface SeekRequest {
  turn: number;
  seq: number;
  play?: boolean;
}

/**
 * Explicit navigation/watch seeks (seekRequest): requests issued before this
 * frame instance mounted are stale — the initial seekTurn already positioned
 * it — so only seq bumps AFTER mount are sent. Short retry window because a
 * bump can land while the embed is still booting.
 */
export function useSeekRequests(iframeRef: FrameRef, seekRequest: SeekRequest | null) {
  const seenSeekSeqRef = useRef<number | null>(seekRequest?.seq ?? null);
  useEffect(() => {
    if (!seekRequest || seekRequest.seq === seenSeekSeqRef.current) return;
    seenSeekSeqRef.current = seekRequest.seq;
    const send = () => postSeek(iframeRef, seekRequest.turn, !!seekRequest.play);
    send();
    const retry = window.setInterval(send, 200);
    const stopRetry = window.setTimeout(() => window.clearInterval(retry), 1200);
    return () => {
      window.clearInterval(retry);
      window.clearTimeout(stopRetry);
    };
  }, [seekRequest, iframeRef]);
}

/** Streams appended log lines into a live frame instead of rebuilding it. */
export function useLiveAppend(args: {
  iframeRef: FrameRef;
  liveUpdates: boolean;
  reloadKey: string;
  blobUrl: string | null;
  log: string;
  seekTurn: number | undefined;
  liveAppendMode: 'play' | 'follow-end' | 'hold';
  liveAppendTurn: number | null;
}) {
  const { iframeRef, liveUpdates, reloadKey, blobUrl, log, seekTurn, liveAppendMode, liveAppendTurn } = args;
  const sentLogRef = useRef<{ key: string; blobUrl: string; lines: string[] } | null>(null);
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
      const shouldPlayAppend = liveAppendMode === 'play' && typeof liveAppendTurn === 'number';
      const holdAppend = liveAppendMode === 'hold';
      iframeRef.current?.contentWindow?.postMessage({
        type: 'ps-append-log',
        lines: lines.slice(previous.lines.length),
        seekTurn: holdAppend ? undefined : seekTurn,
        followEnd: !shouldPlayAppend && !holdAppend,
        playFromTurn: shouldPlayAppend ? liveAppendTurn : undefined,
      }, '*');
    }
    sentLogRef.current = { key: reloadKey, blobUrl, lines };
  }, [liveUpdates, reloadKey, blobUrl, log, seekTurn, liveAppendMode, liveAppendTurn, iframeRef]);
}
