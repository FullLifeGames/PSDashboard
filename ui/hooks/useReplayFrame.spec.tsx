import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useLiveAppend, useReplayBlobUrl, useSeekRequests, useSeekTurn, useTurnReports, type SeekRequest,
} from '../../src/hooks/useReplayFrame';

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
});

describe('useSeekRequests', () => {
  test('requests issued before the frame mounted are stale; later bumps are sent with retries', () => {
    vi.useFakeTimers();
    const { iframeRef, postMessage } = frame();
    const { rerender } = renderHook((request: SeekRequest | null) => useSeekRequests(iframeRef, request), { initialProps: { turn: 2, seq: 1 } as SeekRequest | null });
    expect(postMessage).not.toHaveBeenCalled();

    const bump: SeekRequest = { turn: 7, seq: 2, play: true };
    rerender(bump);
    expect(postMessage).toHaveBeenCalledWith({ type: 'ps-seek-turn', turn: 7, autoPlay: true }, '*');
    act(() => vi.advanceTimersByTime(400));
    expect(postMessage).toHaveBeenCalledTimes(3);

    // The same request re-rendered (same object, as the app's state keeps it) changes nothing.
    rerender(bump);
    act(() => vi.advanceTimersByTime(2000));
    expect(postMessage).toHaveBeenCalledTimes(6);
  });
});

describe('useLiveAppend', () => {
  type AppendArgs = Parameters<typeof useLiveAppend>[0];
  const base: Omit<AppendArgs, 'iframeRef' | 'log'> = {
    liveUpdates: true, reloadKey: 'session-1', blobUrl: 'blob:test/1', seekTurn: 2, liveAppendMode: 'follow-end', liveAppendTurn: null,
  };

  test('appended lines stream into the frame; the first pass only records the baseline', () => {
    const { iframeRef, postMessage } = frame();
    const { rerender } = renderHook((props: Parameters<typeof useLiveAppend>[0]) => useLiveAppend(props), { initialProps: { ...base, iframeRef, log: LOG } });
    expect(postMessage).not.toHaveBeenCalled();

    rerender({ ...base, iframeRef, log: `${LOG}\n|move|p2a: Ferrothorn|Leech Seed|p1a: Garchomp\n|turn|3` });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'ps-append-log', lines: ['|move|p2a: Ferrothorn|Leech Seed|p1a: Garchomp', '|turn|3'], seekTurn: 2, followEnd: true, playFromTurn: undefined,
    }, '*');
  });

  test('play mode animates from the executed turn, hold mode neither seeks nor follows', () => {
    const { iframeRef, postMessage } = frame();
    const { rerender } = renderHook((props: Parameters<typeof useLiveAppend>[0]) => useLiveAppend(props), { initialProps: { ...base, iframeRef, log: LOG } });
    rerender({ ...base, iframeRef, log: `${LOG}\n|turn|3`, liveAppendMode: 'play', liveAppendTurn: 2 });
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ followEnd: false, playFromTurn: 2 }), '*');

    rerender({ ...base, iframeRef, log: `${LOG}\n|turn|3\n|turn|4`, liveAppendMode: 'hold' });
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ lines: ['|turn|4'], seekTurn: undefined, followEnd: false }), '*');
  });

  test('a diverging log, a new session, or a non-live frame posts nothing', () => {
    const { iframeRef, postMessage } = frame();
    const { rerender } = renderHook((props: Parameters<typeof useLiveAppend>[0]) => useLiveAppend(props), { initialProps: { ...base, iframeRef, log: LOG } });
    rerender({ ...base, iframeRef, log: LOG.replace('Earthquake', 'Stone Edge') });
    rerender({ ...base, iframeRef, log: `${LOG}\n|turn|3`, reloadKey: 'session-2' });
    rerender({ ...base, iframeRef, log: `${LOG}\n|turn|3\n|turn|4`, liveUpdates: false });
    expect(postMessage).not.toHaveBeenCalled();
  });
});
