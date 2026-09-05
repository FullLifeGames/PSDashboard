import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useReplay } from '../../src/hooks/useReplay';
import { singlesReplay } from '../fixtures/replay';
import EXPORTED_HTML from '../../e2e/fixtures/exported-replay.html?raw';

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useReplay', () => {
  test('starts empty and idle', () => {
    const { result } = renderHook(() => useReplay());
    expect(result.current).toMatchObject({ loading: false, error: null, replayData: null, snapshots: [], p1Info: null, opponentInfo: null });
  });

  test('loadReplay fetches the replay, parses its log, and infers both teams', async () => {
    const replay = singlesReplay();
    const fetchMock = stubFetch(() => jsonResponse(replay));
    const { result } = renderHook(() => useReplay());

    let outcome: Awaited<ReturnType<typeof result.current.loadReplay>> | undefined;
    await act(async () => { outcome = await result.current.loadReplay(replay.id); });

    expect(fetchMock.mock.calls[0][0]).toContain(replay.id);
    expect(outcome).toEqual({ data: expect.objectContaining({ id: replay.id }), error: null });
    expect(result.current.loading).toBe(false);
    expect(result.current.replayData?.id).toBe(replay.id);
    expect(result.current.snapshots.length).toBeGreaterThan(1);
    expect(result.current.p1Info?.pokemon.length).toBeGreaterThan(0);
    expect(result.current.opponentInfo?.pokemon.length).toBeGreaterThan(0);
  });

  test('loading is true while the fetch is in flight', async () => {
    let release: (value: Response) => void = () => {};
    stubFetch(() => new Promise<Response>(resolve => { release = resolve; }));
    const { result } = renderHook(() => useReplay());

    let pending: Promise<unknown> = Promise.resolve();
    act(() => { pending = result.current.loadReplay('gen9ou-1'); });
    await waitFor(() => expect(result.current.loading).toBe(true));

    await act(async () => {
      release(jsonResponse(singlesReplay()));
      await pending;
    });
    expect(result.current.loading).toBe(false);
  });

  test('a failed fetch keeps the previous replay and reports the message', async () => {
    stubFetch(() => jsonResponse(singlesReplay()));
    const { result } = renderHook(() => useReplay());
    await act(async () => { await result.current.loadReplay('gen9ou-1'); });
    const before = result.current.replayData;

    stubFetch(() => new Response('', { status: 404 }));
    let outcome: Awaited<ReturnType<typeof result.current.loadReplay>> | undefined;
    await act(async () => { outcome = await result.current.loadReplay('gen9ou-2632003305'); });
    expect(outcome?.data).toBeNull();
    expect(outcome?.error).toMatch(/Double-check the replay id/);
    expect(result.current.error).toMatch(/Double-check the replay id/);
    expect(result.current.replayData).toBe(before);
  });

  test('nonsense input never reaches the network', async () => {
    const fetchMock = stubFetch(() => jsonResponse(singlesReplay()));
    const { result } = renderHook(() => useReplay());
    await act(async () => { await result.current.loadReplay('https://example.com/foo'); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/replay link or id/i);
  });

  test('loadReplayFile parses an exported replay document and a raw log, and rejects other text', async () => {
    const { result } = renderHook(() => useReplay());
    await act(async () => { await result.current.loadReplayFile(EXPORTED_HTML, 'exported-replay.html'); });
    expect(result.current.error).toBeNull();
    expect(result.current.replayData?.log).toContain('|turn|');
    expect(result.current.snapshots.length).toBeGreaterThan(0);

    const log = singlesReplay().log;
    await act(async () => { await result.current.loadReplayFile(log, 'My Game.log'); });
    expect(result.current.replayData?.id).toBe('my-game');

    let outcome: Awaited<ReturnType<typeof result.current.loadReplayFile>> | undefined;
    await act(async () => { outcome = await result.current.loadReplayFile('<html><body>hello</body></html>', 'page.html'); });
    expect(outcome?.error).toMatch(/does not look like an exported replay/);
    expect(result.current.replayData?.id).toBe('my-game');
  });
});
