import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEmbedHost } from '../../../src/hooks/useEmbedHost';
import type { LoadReplayResult } from '../../../src/hooks/useReplay';
import { singlesReplay } from '../fixtures/replay';
import { savedRecord } from '../fixtures/saved-game';

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

beforeEach(() => localStorage.clear());

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('useEmbedHost', () => {
  test('reads the embed flag and the requested replay off the query and loads it once', async () => {
    const { result, loadReplay, rerender } = setup('?embed=1&replay=gen9ou-1');
    expect(result.current).toEqual({ embed: true, requestedReplay: 'gen9ou-1', requestedTurn: null, requestedGame: null });
    await waitFor(() => expect(loadReplay).toHaveBeenCalledWith('gen9ou-1'));
    rerender();
    expect(loadReplay).toHaveBeenCalledTimes(1);
  });

  test('a ?game= the browser holds wins over a ?replay= beside it; one it does not hold leaves the replay link its way (round 89, #105)', async () => {
    const record = await savedRecord();
    const held = setup(`?game=${record.id}&replay=gen9ou-1`);
    expect(held.result.current).toEqual({ embed: false, requestedReplay: null, requestedTurn: null, requestedGame: record.id });
    expect(held.loadReplay).not.toHaveBeenCalled();
    const unknown = setup('?game=newgame-zzzz&replay=gen9ou-1');
    expect(unknown.result.current).toEqual({ embed: false, requestedReplay: 'gen9ou-1', requestedTurn: null, requestedGame: 'newgame-zzzz' });
    await waitFor(() => expect(unknown.loadReplay).toHaveBeenCalledWith('gen9ou-1'));
  }, 60_000);

  test('a share link owns the view: the requested replay is not fetched behind a #branch= hash', () => {
    const { result, loadReplay } = setup('?replay=gen9ou-1', '#branch=abc');
    expect(result.current).toEqual({ embed: false, requestedReplay: 'gen9ou-1', requestedTurn: null, requestedGame: null });
    expect(loadReplay).not.toHaveBeenCalled();
  });

  test('reads ?turn= beside ?replay= (round 89, lane L): a whole number only, and only for a replay link', () => {
    expect(setup('?replay=gen9ou-1&turn=7').result.current.requestedTurn).toBe(7);
    expect(setup('?embed=1&replay=gen9doublesou-2693620934&turn=5').result.current).toEqual({
      embed: true, requestedReplay: 'gen9doublesou-2693620934', requestedTurn: 5, requestedGame: null,
    });
    for (const turn of ['abc', '', '7.5', '7x']) expect(setup(`?replay=gen9ou-1&turn=${turn}`).result.current.requestedTurn, turn).toBeNull();
    expect(setup('?replay=gen9ou-1').result.current.requestedTurn).toBeNull();
    expect(setup('?turn=7').result.current.requestedTurn).toBeNull();
  });

  test('a share link or a held game keeps its precedence: ?turn= is not read behind them', async () => {
    expect(setup('?replay=gen9ou-1&turn=7', '#branch=abc').result.current.requestedTurn).toBeNull();
    const record = await savedRecord();
    expect(setup(`?game=${record.id}&replay=gen9ou-1&turn=7`).result.current.requestedTurn).toBeNull();
    expect(setup('?game=newgame-zzzz&replay=gen9ou-1&turn=7').result.current.requestedTurn).toBe(7);
  }, 60_000);

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
