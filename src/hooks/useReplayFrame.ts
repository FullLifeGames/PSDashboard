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

/** The lines of a log a frame holds (the embed skips blank lines). */
export function frameLines(log: string): string[] {
  return log.split('\n').filter(Boolean);
}

/** True when `next` keeps every line of `previous` in order and adds lines only after them: a frame showing `previous` can append. */
export function extendsLines(previous: string[], next: string[]): boolean {
  return previous.length <= next.length && previous.every((line, index) => line === next[index]);
}

interface LiveAppendArgs {
  iframeRef: FrameRef;
  liveUpdates: boolean;
  reloadKey: string;
  blobUrl: string | null;
  /** The log the document opened with, when it opened on less than `log`: the lines after it reach the frame as appends. */
  documentLog?: string;
  log: string;
  seekTurn: number | undefined;
  liveAppendMode: 'play' | 'follow-end' | 'hold';
  liveAppendTurn: number | null;
}

type SentLog = { key: string; blobUrl: string; lines: string[] };

/**
 * Streams appended log lines into a live frame instead of rebuilding it.
 * The frame's bridge listens only once its document has loaded, and the
 * embed script comes from the network: lines posted before that were lost.
 * After one turn back and a new choice the frame reloaded for the rebuilt
 * line, and it never showed the new turn (round 77, user report
 * 28.10.2026). New lines wait for the frame's ready message and then go out
 * as one append.
 */
export function useLiveAppend(args: LiveAppendArgs) {
  const { iframeRef, liveUpdates, reloadKey, blobUrl, documentLog, log, seekTurn, liveAppendMode, liveAppendTurn } = args;
  /** The lines the frame holds, or holds once its bridge reports ready. */
  const sentLogRef = useRef<SentLog | null>(null);
  /** The document whose bridge reported ready. */
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

/** Posts the lines the frame lacks; a new document records the lines it opened with, and a frame not ready yet keeps them waiting. */
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

/** One append message with the lines after the ones the frame holds, when the log still extends them. */
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
