import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useLiveAppend, useReplayBlobUrl, useSeekRequests, useSeekTurn, useSideReports, useTurnReports, type SeekRequest,
} from '../../../src/hooks/useReplayFrame';

type FrameRef = React.RefObject<HTMLIFrameElement | null>;

/** An iframe stand-in whose window records every message the hooks post. */
function frame() {
  const postMessage = vi.fn();
  const iframeRef = { current: { contentWindow: { postMessage } } as unknown as HTMLIFrameElement } as FrameRef;
  return { iframeRef, postMessage };
}

const LOG = '|player|p1|Alice|\n|player|p2|Bob|\n|turn|1\n|move|p1a: Garchomp|Earthquake|p2a: Ferrothorn\n|turn|2';

beforeEach(() => {
  let counter = 0;
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:test/${++counter}`),
    revokeObjectURL: vi.fn(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useReplayBlobUrl', () => {
  test('an empty log yields no document; a log becomes a blob URL that is revoked on change and unmount', () => {
    const initialSeek = { seekTurn: 1 };
    const { result, rerender, unmount } = renderHook(
      (log: string) => useReplayBlobUrl({ documentLog: log, format: '[Gen 9] OU', p1: 'Alice', p2: 'Bob', initialSeek, reportTurn: true }),
      { initialProps: '   ' },
    );
    expect(result.current).toBeNull();

    rerender(LOG);
    const first = result.current;
    expect(first).toMatch(/^blob:test\//);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    rerender(`${LOG}\n|turn|3`);
    expect(result.current).not.toBe(first);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

/** A message the way the frame's tracker posts it: `source` is the posting window. */
function postFromFrame(source: unknown, data: unknown) {
  const event = new MessageEvent('message', { data });
  Object.defineProperty(event, 'source', { value: source });
  act(() => { window.dispatchEvent(event); });
}

// Round 88 (T316, #56): the side the frame shows near reaches the app through `ps-side`, from its own window only.
describe('useSideReports', () => {
  test('forwards the side its own frame reports and nothing else', () => {
    const { iframeRef } = frame();
    const onSideChange = vi.fn();
    renderHook(() => useSideReports(iframeRef, onSideChange));

    postFromFrame(iframeRef.current?.contentWindow, { type: 'ps-side', side: 'p2' });
    expect(onSideChange).toHaveBeenCalledTimes(1);
    expect(onSideChange).toHaveBeenLastCalledWith('p2');
    postFromFrame(iframeRef.current?.contentWindow, { type: 'ps-side', side: 'p1' });
    expect(onSideChange).toHaveBeenLastCalledWith('p1');

    // Another window (a dying document, another frame), a side that is no side, a missing side and other messages.
    postFromFrame({}, { type: 'ps-side', side: 'p2' });
    postFromFrame(iframeRef.current?.contentWindow, { type: 'ps-side', side: 'p3' });
    postFromFrame(iframeRef.current?.contentWindow, { type: 'ps-side' });
    postFromFrame(iframeRef.current?.contentWindow, { type: 'ps-turn', turn: 3 });
    expect(onSideChange).toHaveBeenCalledTimes(2);
  });

  test('adds no listener without a callback, and removes its own on unmount', () => {
    const { iframeRef } = frame();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    renderHook(() => useSideReports(iframeRef, undefined));
    expect(add).not.toHaveBeenCalledWith('message', expect.anything());

    const { unmount } = renderHook(() => useSideReports(iframeRef, vi.fn()));
    expect(add).toHaveBeenCalledWith('message', expect.anything());
    unmount();
    expect(remove).toHaveBeenCalledWith('message', expect.anything());
    add.mockRestore();
    remove.mockRestore();
  });
});

describe('useReplayBlobUrl with the workspace options', () => {
  test('reportSide and hideChoosers build a document that carries them', async () => {
    const initialSeek = { seekTurn: 1 };
    renderHook(() => useReplayBlobUrl({ documentLog: LOG, initialSeek, reportTurn: true, reportSide: true, hideChoosers: true, viewpoint: 'p2' }));
    const html = await (vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).text();
    expect(html).toContain('trackSide');
    expect(html).toContain("var ownSide = 'p2';");
    expect(html).toContain('.soundchooser');
    expect(html).not.toContain('data-action="ffto"');

    renderHook(() => useReplayBlobUrl({ documentLog: LOG, initialSeek, reportTurn: true }));
    const plain = await (vi.mocked(URL.createObjectURL).mock.calls[1][0] as Blob).text();
    expect(plain).not.toContain('trackSide');
    expect(plain).not.toContain('.soundchooser');
  });
});

describe('useTurnReports', () => {
  test('remembers the turns the frame reports and forwards them; a new document forgets', () => {
    const onTurnChange = vi.fn();
    const { result, rerender } = renderHook((blobUrl: string) => useTurnReports(onTurnChange, blobUrl), { initialProps: 'blob:test/1' });

    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'ps-turn', turn: 4 } }));
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'ps-seek-turn', turn: 9 } }));
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'ps-turn', turn: 'x' } }));
    });
    expect(onTurnChange).toHaveBeenCalledTimes(1);
    expect(onTurnChange).toHaveBeenCalledWith(4);
    expect(result.current.current).toBe(4);

    rerender('blob:test/2');
    expect(result.current.current).toBeNull();
  });
});

describe('useSeekTurn', () => {
  test('seeks once at mount, retries every 200 ms for 1.2 s, and again when the frame reports ready', () => {
    vi.useFakeTimers();
    const { iframeRef, postMessage } = frame();
    const lastReportedTurnRef = { current: null as number | null };
    renderHook(() => useSeekTurn({ iframeRef, seekTurn: 5, autoPlay: false, blobUrl: 'blob:test/1', liveUpdates: false, lastReportedTurnRef }));
    expect(postMessage).toHaveBeenCalledWith({ type: 'ps-seek-turn', turn: 5, autoPlay: false }, '*');
    expect(postMessage).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1000));
    expect(postMessage).toHaveBeenCalledTimes(6);
    act(() => vi.advanceTimersByTime(2000));
    expect(postMessage).toHaveBeenCalledTimes(6);

    act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'ps-replay-ready' } })); });
    expect(postMessage).toHaveBeenCalledTimes(7);
  });

  test('a turn the frame itself just reported is not re-seeked; a live frame seeks only at its first mount', () => {
    vi.useFakeTimers();
    const { iframeRef, postMessage } = frame();
    const lastReportedTurnRef = { current: 3 as number | null };
    const { rerender } = renderHook(
      (props: { seekTurn: number; liveUpdates: boolean }) => useSeekTurn({ iframeRef, seekTurn: props.seekTurn, autoPlay: true, blobUrl: 'blob:test/1', liveUpdates: props.liveUpdates, lastReportedTurnRef }),
      { initialProps: { seekTurn: 3, liveUpdates: false } },
    );
    expect(postMessage).not.toHaveBeenCalled();

    rerender({ seekTurn: 4, liveUpdates: true });
    expect(postMessage).toHaveBeenCalledWith({ type: 'ps-seek-turn', turn: 4, autoPlay: true }, '*');
    act(() => vi.advanceTimersByTime(1500));
    const afterFirst = postMessage.mock.calls.length;

    rerender({ seekTurn: 6, liveUpdates: true });
    act(() => vi.advanceTimersByTime(1500));
    expect(postMessage).toHaveBeenCalledTimes(afterFirst);
  });

  test('a live frame that reports ready stops its retries: a late retry would cut short a turn its appends play', () => {
    // Round 77 (user report 28.10.2026): a new variation's first turn plays in from an append right after ready.
    vi.useFakeTimers();
    const { iframeRef, postMessage } = frame();
    const lastReportedTurnRef = { current: null as number | null };
    renderHook(() => useSeekTurn({ iframeRef, seekTurn: 4, autoPlay: false, blobUrl: 'blob:test/1', liveUpdates: true, lastReportedTurnRef }));
    act(() => vi.advanceTimersByTime(200));
    expect(postMessage).toHaveBeenCalledTimes(2);
    reportReady(iframeRef);
    expect(postMessage).toHaveBeenCalledTimes(3);
    act(() => vi.advanceTimersByTime(1000));
    expect(postMessage).toHaveBeenCalledTimes(3);
  });
});

describe('useSeekRequests', () => {
  test('requests issued before the frame mounted are stale; later bumps are sent with retries', () => {
    vi.useFakeTimers();
    const { iframeRef, postMessage } = frame();
    const { rerender } = renderHook((request: SeekRequest | null) => useSeekRequests(iframeRef, request), { initialProps: { turn: 2, seq: 1 } as SeekRequest | null });
    expect(postMessage).not.toHaveBeenCalled();

    const bump: SeekRequest = { turn: 7, seq: 2, play: true };
    rerender(bump);
    // Round 88 (T347, #83): the request's seq rides every retry as its id; the bridge runs a play seek once per id.
    expect(postMessage).toHaveBeenCalledWith({ type: 'ps-seek-turn', turn: 7, autoPlay: true, id: 2 }, '*');
    act(() => vi.advanceTimersByTime(400));
    expect(postMessage).toHaveBeenCalledTimes(3);
    expect(postMessage.mock.calls.every(([message]) => (message as { id?: number }).id === 2)).toBe(true);

    // The same request re-rendered (same object, as the app's state keeps it) changes nothing.
    rerender(bump);
    act(() => vi.advanceTimersByTime(2000));
    expect(postMessage).toHaveBeenCalledTimes(6);
  });
});

/** The frame's bridge reports ready, as the replay document does once its battle exists. */
function reportReady(iframeRef: FrameRef) {
  const event = new MessageEvent('message', { data: { type: 'ps-replay-ready' } });
  Object.defineProperty(event, 'source', { value: iframeRef.current?.contentWindow });
  act(() => { window.dispatchEvent(event); });
}

describe('useLiveAppend', () => {
  type AppendArgs = Parameters<typeof useLiveAppend>[0];
  const base: Omit<AppendArgs, 'iframeRef' | 'log'> = {
    liveUpdates: true, reloadKey: 'session-1', blobUrl: 'blob:test/1', seekTurn: 2, liveAppendMode: 'follow-end', liveAppendTurn: null,
  };

  test('lines appended before the frame reports ready wait for it and then go out as one append', () => {
    // Round 77 (user report 28.10.2026): after one turn back and a new choice the frame reloaded for the rebuilt line, and the
    // new turn's lines went out while the embed script still loaded. Nothing listened yet, so the frame never showed the turn.
    const { iframeRef, postMessage } = frame();
    const { rerender } = renderHook((props: Parameters<typeof useLiveAppend>[0]) => useLiveAppend(props), { initialProps: { ...base, iframeRef, log: LOG } });
    rerender({ ...base, iframeRef, log: `${LOG}\n|move|p2a: Ferrothorn|Leech Seed|p1a: Garchomp`, liveAppendMode: 'play', liveAppendTurn: 2 });
    rerender({ ...base, iframeRef, log: `${LOG}\n|move|p2a: Ferrothorn|Leech Seed|p1a: Garchomp\n|turn|3`, liveAppendMode: 'play', liveAppendTurn: 2 });
    expect(postMessage).not.toHaveBeenCalled();

    // Another frame's ready message changes nothing; this frame's sends every waiting line at once.
    const other = new MessageEvent('message', { data: { type: 'ps-replay-ready' } });
    act(() => { window.dispatchEvent(other); });
    expect(postMessage).not.toHaveBeenCalled();
    reportReady(iframeRef);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'ps-append-log', lines: ['|move|p2a: Ferrothorn|Leech Seed|p1a: Garchomp', '|turn|3'], seekTurn: 2, followEnd: false, playFromTurn: 2,
    }, '*');

    // A new document waits for its own ready message.
    rerender({ ...base, iframeRef, log: `${LOG}\n|turn|3`, blobUrl: 'blob:test/2' });
    rerender({ ...base, iframeRef, log: `${LOG}\n|turn|3\n|turn|4`, blobUrl: 'blob:test/2' });
    expect(postMessage).toHaveBeenCalledTimes(1);
    reportReady(iframeRef);
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ lines: ['|turn|4'] }), '*');
  });

  test('appended lines stream into the frame; the first pass only records the baseline', () => {
    const { iframeRef, postMessage } = frame();
    const { rerender } = renderHook((props: Parameters<typeof useLiveAppend>[0]) => useLiveAppend(props), { initialProps: { ...base, iframeRef, log: LOG } });
    reportReady(iframeRef);
    expect(postMessage).not.toHaveBeenCalled();

    rerender({ ...base, iframeRef, log: `${LOG}\n|move|p2a: Ferrothorn|Leech Seed|p1a: Garchomp\n|turn|3` });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'ps-append-log', lines: ['|move|p2a: Ferrothorn|Leech Seed|p1a: Garchomp', '|turn|3'], seekTurn: 2, followEnd: true, playFromTurn: undefined,
    }, '*');
  });

  test('play mode animates from the executed turn, hold mode neither seeks nor follows', () => {
    const { iframeRef, postMessage } = frame();
    const { rerender } = renderHook((props: Parameters<typeof useLiveAppend>[0]) => useLiveAppend(props), { initialProps: { ...base, iframeRef, log: LOG } });
    reportReady(iframeRef);
    rerender({ ...base, iframeRef, log: `${LOG}\n|turn|3`, liveAppendMode: 'play', liveAppendTurn: 2 });
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ followEnd: false, playFromTurn: 2 }), '*');

    rerender({ ...base, iframeRef, log: `${LOG}\n|turn|3\n|turn|4`, liveAppendMode: 'hold' });
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ lines: ['|turn|4'], seekTurn: undefined, followEnd: false }), '*');
  });

  test('a diverging log, a new session, or a non-live frame posts nothing', () => {
    const { iframeRef, postMessage } = frame();
    const { rerender } = renderHook((props: Parameters<typeof useLiveAppend>[0]) => useLiveAppend(props), { initialProps: { ...base, iframeRef, log: LOG } });
    reportReady(iframeRef);
    rerender({ ...base, iframeRef, log: LOG.replace('Earthquake', 'Stone Edge') });
    rerender({ ...base, iframeRef, log: `${LOG}\n|turn|3`, reloadKey: 'session-2' });
    rerender({ ...base, iframeRef, log: `${LOG}\n|turn|3\n|turn|4`, liveUpdates: false });
    expect(postMessage).not.toHaveBeenCalled();
  });
});
