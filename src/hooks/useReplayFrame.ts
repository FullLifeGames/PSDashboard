import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { generateReplayHtml, createBlobUrl, revokeBlobUrl } from '../lib/replay-html';
import { localFontAwesomeUrl } from '../lib/replay-compat';
import { subscribeTablePart, tablePartPending, teambuilderTablePartUrl } from '../lib/teambuilder-table';

type FrameRef = React.RefObject<HTMLIFrameElement | null>;

export type FrameSide = 'p1' | 'p2';

// `id` names one request across its retries: the bridge runs a play seek with an id once.
const postSeek = (iframeRef: FrameRef, turn: number, autoPlay: boolean, id?: number) =>
  iframeRef.current?.contentWindow?.postMessage(id === undefined ? { type: 'ps-seek-turn', turn, autoPlay } : { type: 'ps-seek-turn', turn, autoPlay, id }, '*');

/** The replay document as a blob URL (revoked when it changes or the frame unmounts). */
export function useReplayBlobUrl(args: {
  documentLog: string;
  format?: string;
  p1?: string;
  p2?: string;
  title?: string;
  initialSeek: { seekTurn?: number; autoPlay?: boolean };
  reportTurn: boolean;
  /** The document reports the side it shows near, and hides the two choosers (Color scheme, Music). */
  reportSide?: boolean;
  hideChoosers?: boolean;
  viewpoint?: 'p1' | 'p2';
}): string | null {
  const { documentLog, format, p1, p2, title, initialSeek, reportTurn, reportSide, hideChoosers, viewpoint } = args;
  // Turns false once and stays false, so a standing frame is never rebuilt when the table part arrives.
  const tableWait = useSyncExternalStore(subscribeTablePart, tablePartPending, () => false);
  const blobUrl = useMemo(() => {
    if (!documentLog.trim() || tableWait) {
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
      reportSide,
      hideChoosers,
      viewpoint,
      fontAwesomeWoff2Url: localFontAwesomeUrl(),
      // Read when the document is built, not a dependency: a part that arrives later never reloads a frame.
      teambuilderTableUrl: teambuilderTablePartUrl(),
    });
    return createBlobUrl(html);
  }, [documentLog, format, p1, p2, title, initialSeek, reportTurn, reportSide, hideChoosers, viewpoint, tableWait]);

  useEffect(() => {
    if (!blobUrl) return;
    return () => revokeBlobUrl(blobUrl);
  }, [blobUrl]);

  return blobUrl;
}

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

/** Forwards the side the frame's document shows near; a report of a document going away never reaches the app. */
export function useSideReports(iframeRef: FrameRef, onSideChange: ((side: FrameSide) => void) | undefined) {
  useEffect(() => {
    if (!onSideChange) return;
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const side = e.data && e.data.type === 'ps-side' ? e.data.side : null;
      if (side === 'p1' || side === 'p2') onSideChange(side);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [iframeRef, onSideChange]);
}

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
    // seekTurn may only echo a turn the iframe reported (Play/Next inside the embed); re-seeking would pause playback.
    if (!liveUpdates && lastReportedTurnRef.current === seekTurn) return;
    const sendSeek = () => postSeek(iframeRef, seekTurn, !!autoPlay);
    didInitialLiveSeekRef.current = true;
    sendSeek();
    const retry = window.setInterval(sendSeek, 200);
    const stopRetry = window.setTimeout(() => window.clearInterval(retry), 1200);

    const handler = (event: MessageEvent) => {
      if (event.data?.type !== 'ps-replay-ready') return;
      sendSeek();
      // A ready live frame has its opening seek; a retry after it would cut short a turn its appends play.
      if (liveUpdates && event.source === iframeRef.current?.contentWindow) window.clearInterval(retry);
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

/** Seeks on navigation or watch requests; only seq bumps after mount count, the initial seekTurn already placed it. */
export function useSeekRequests(iframeRef: FrameRef, seekRequest: SeekRequest | null) {
  const seenSeekSeqRef = useRef<number | null>(seekRequest?.seq ?? null);
  useEffect(() => {
    if (!seekRequest || seekRequest.seq === seenSeekSeqRef.current) return;
    seenSeekSeqRef.current = seekRequest.seq;
    const send = () => postSeek(iframeRef, seekRequest.turn, !!seekRequest.play, seekRequest.seq);
    send();
    const retry = window.setInterval(send, 200);
    const stopRetry = window.setTimeout(() => window.clearInterval(retry), 1200);
    return () => {
      window.clearInterval(retry);
      window.clearTimeout(stopRetry);
    };
  }, [seekRequest, iframeRef]);
}

export function frameLines(log: string): string[] {
  return log.split('\n').filter(Boolean);
}

export function extendsLines(previous: string[], next: string[]): boolean {
  return previous.length <= next.length && previous.every((line, index) => line === next[index]);
}

interface LiveAppendArgs {
  iframeRef: FrameRef;
  liveUpdates: boolean;
  reloadKey: string;
  blobUrl: string | null;
  /** The log the document opened with, when that is less than `log`: the lines after it arrive as appends. */
  documentLog?: string;
  log: string;
  seekTurn: number | undefined;
  liveAppendMode: 'play' | 'follow-end' | 'hold';
  liveAppendTurn: number | null;
}

type SentLog = { key: string; blobUrl: string; lines: string[] };

/** Streams appended log lines into a live frame, after its ready message: the bridge listens only once loaded. */
export function useLiveAppend(args: LiveAppendArgs) {
  const { iframeRef, liveUpdates, reloadKey, blobUrl, documentLog, log, seekTurn, liveAppendMode, liveAppendTurn } = args;
  const sentLogRef = useRef<SentLog | null>(null);
  const readyRef = useRef<string | null>(null);
  const latestRef = useRef<LiveAppendArgs | null>(null);
  useEffect(() => {
    if (!liveUpdates || !blobUrl) return;
    const current = { iframeRef, liveUpdates, reloadKey, blobUrl, documentLog, log, seekTurn, liveAppendMode, liveAppendTurn };
    latestRef.current = current;
    appendNewLines(current, sentLogRef, readyRef.current === blobUrl);
  }, [liveUpdates, reloadKey, blobUrl, documentLog, log, seekTurn, liveAppendMode, liveAppendTurn, iframeRef]);
  useEffect(() => {
    if (!liveUpdates || !blobUrl) return;
    const onReady = (event: MessageEvent) => {
      if (event.data?.type !== 'ps-replay-ready' || event.source !== iframeRef.current?.contentWindow) return;
      readyRef.current = blobUrl;
      if (latestRef.current?.blobUrl === blobUrl) appendNewLines(latestRef.current, sentLogRef, true);
    };
    window.addEventListener('message', onReady);
    return () => window.removeEventListener('message', onReady);
  }, [liveUpdates, blobUrl, iframeRef]);
}

function appendNewLines(args: LiveAppendArgs, sentLogRef: React.RefObject<SentLog | null>, ready: boolean): void {
  const { reloadKey, blobUrl, documentLog, log } = args;
  if (!blobUrl) return;
  const previous = sentLogRef.current;
  const sent = previous && previous.key === reloadKey && previous.blobUrl === blobUrl
    ? previous
    : { key: reloadKey, blobUrl, lines: frameLines(documentLog ?? log) };
  if (!ready) {
    sentLogRef.current = sent;
    return;
  }
  postAppend(args, sent);
  sentLogRef.current = { key: reloadKey, blobUrl, lines: frameLines(log) };
}

function postAppend(args: LiveAppendArgs, sent: SentLog): void {
  const { iframeRef, log, seekTurn, liveAppendMode, liveAppendTurn } = args;
  const lines = frameLines(log);
  if (!extendsLines(sent.lines, lines) || lines.length <= sent.lines.length) return;
  const shouldPlayAppend = liveAppendMode === 'play' && typeof liveAppendTurn === 'number';
  const holdAppend = liveAppendMode === 'hold';
  iframeRef.current?.contentWindow?.postMessage({
    type: 'ps-append-log',
    lines: lines.slice(sent.lines.length),
    seekTurn: holdAppend ? undefined : seekTurn,
    followEnd: !shouldPlayAppend && !holdAppend,
    playFromTurn: shouldPlayAppend ? liveAppendTurn : undefined,
  }, '*');
}
