import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEmbedHost } from '../../src/hooks/useEmbedHost';
import type { LoadReplayResult } from '../../src/hooks/useReplay';
import { singlesReplay } from '../fixtures/replay';

const loaded = (): LoadReplayResult => ({ data: singlesReplay(), error: null });
const failed = (): LoadReplayResult => ({ data: null, error: 'Double-check the replay id' });

function setup(search: string, hash = '') {
  window.history.replaceState(null, '', `/${search}${hash}`);
  const loadReplay = vi.fn(async () => loaded());
  const loadReplayFile = vi.fn(async () => loaded());
  const hook = renderHook(() => useEmbedHost({ loadReplay, loadReplayFile }));
  return { ...hook, loadReplay, loadReplayFile };
}

/** A host message: the app answers `event.source`, which jsdom only accepts as a window. */
function postFromHost(replay: string) {
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'ps-load-replay', replay }, source: window }));
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('useEmbedHost', () => {
  test('reads the embed flag and the requested replay off the query and loads it once', async () => {
    const { result, loadReplay, rerender } = setup('?embed=1&replay=gen9ou-1');
    expect(result.current).toEqual({ embed: true, requestedReplay: 'gen9ou-1' });
    await waitFor(() => expect(loadReplay).toHaveBeenCalledWith('gen9ou-1'));
    rerender();
    expect(loadReplay).toHaveBeenCalledTimes(1);
  });

  test('a share link owns the view: the requested replay is not fetched behind a #branch= hash', () => {
    const { result, loadReplay } = setup('?replay=gen9ou-1', '#branch=abc');
    expect(result.current).toEqual({ embed: false, requestedReplay: 'gen9ou-1' });
    expect(loadReplay).not.toHaveBeenCalled();
  });

  test('a posted replay id loads through loadReplay and the host hears ps-replay-loaded', async () => {
    const { loadReplay, loadReplayFile } = setup('?embed=1');
    const answer = vi.spyOn(window, 'postMessage');
    act(() => postFromHost('gen9ou-1'));
    await waitFor(() => expect(answer).toHaveBeenCalledWith({ type: 'ps-replay-loaded', id: singlesReplay().id, format: singlesReplay().formatid }, '*'));
    expect(loadReplay).toHaveBeenCalledWith('gen9ou-1');
    expect(loadReplayFile).not.toHaveBeenCalled();
  });

  test('a posted protocol log loads through loadReplayFile as host-replay', async () => {
    const { loadReplay, loadReplayFile } = setup('?embed=1');
    const log = '|player|p1|Alice|\n|player|p2|Bob|\n|turn|1';
    act(() => postFromHost(log));
    await waitFor(() => expect(loadReplayFile).toHaveBeenCalledWith(log, 'host-replay'));
    expect(loadReplay).not.toHaveBeenCalled();
  });

  test('a failed load answers with ps-replay-error and its message', async () => {
    window.history.replaceState(null, '', '/?embed=1');
    const loadReplay = vi.fn(async () => failed());
    renderHook(() => useEmbedHost({ loadReplay, loadReplayFile: vi.fn(async () => failed()) }));
    const answer = vi.spyOn(window, 'postMessage');
    act(() => postFromHost('nonsense'));
    await waitFor(() => expect(answer).toHaveBeenCalledWith({ type: 'ps-replay-error', message: 'Double-check the replay id' }, '*'));
  });

  test('messages of other types and without a string replay are ignored', () => {
    const { loadReplay, loadReplayFile } = setup('?embed=1');
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'ps-seek-turn', turn: 3 }, source: window }));
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'ps-load-replay', replay: 42 }, source: window }));
      window.dispatchEvent(new MessageEvent('message', { data: null, source: window }));
    });
    expect(loadReplay).not.toHaveBeenCalled();
    expect(loadReplayFile).not.toHaveBeenCalled();
  });

  test('embedded in another page the app announces ps-embed-ready to its parent; standalone it stays quiet', () => {
    const parentPost = vi.fn();
    const original = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage: parentPost } });
    try {
      setup('?embed=1');
      expect(parentPost).toHaveBeenCalledWith({ type: 'ps-embed-ready' }, '*');
      parentPost.mockClear();
      setup('');
      expect(parentPost).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(window, 'parent', original);
    }
  });
});
