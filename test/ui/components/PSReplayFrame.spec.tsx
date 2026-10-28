import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PSReplayFrame } from '../../../src/components/PSReplayFrame';

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
});

describe('PSReplayFrame', () => {
  test('without a log the frame shows the empty notice; with one it mounts the document as a blob', () => {
    const { rerender } = render(<PSReplayFrame log="" height={300} />);
    expect(screen.getByText('No battle log loaded')).toHaveStyle({ height: '300px' });

    rerender(<PSReplayFrame log={LOG} title="Battle" height={480} />);
    const frame = screen.getByTitle('Battle');
    expect(frame).toHaveAttribute('src', 'blob:test/1');
    expect(frame).toHaveStyle({ height: '480px' });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  test('the frame seeks to its turn once the document loaded and again on an explicit request', () => {
    render(<PSReplayFrame log={LOG} seekTurn={2} autoPlay seekRequest={{ turn: 1, seq: 1 }} />);
    const frame = screen.getByTitle('PS Replay') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: { postMessage } });
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith({ type: 'ps-seek-turn', turn: 2, autoPlay: true }, '*');
  });

  test('a live frame with a turn listener carries the turn tracker and reports landed turns (round 77, A-4)', async () => {
    const onTurnChange = vi.fn();
    render(<PSReplayFrame log={LOG} liveUpdates reloadKey="session" title="Branch" onTurnChange={onTurnChange} />);
    const html = await (vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).text();
    expect(html).toContain('trackTurn');
    act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'ps-turn', turn: 1 } })); });
    expect(onTurnChange).toHaveBeenCalledWith(1);

    render(<PSReplayFrame log={LOG} liveUpdates reloadKey="quiet" title="Quiet" />);
    const quiet = await (vi.mocked(URL.createObjectURL).mock.calls[1][0] as Blob).text();
    expect(quiet).not.toContain('trackTurn');
  });

  test('a new reload key remounts the document; a live frame keeps its document across log growth', () => {
    const { rerender } = render(<PSReplayFrame log={LOG} reloadKey="a" />);
    rerender(<PSReplayFrame log={LOG} reloadKey="b" />);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);

    const live = render(<PSReplayFrame log={LOG} liveUpdates reloadKey="session" />);
    live.rerender(<PSReplayFrame log={`${LOG}\n|turn|3`} liveUpdates reloadKey="session" />);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
  });

  test('a live log that stops extending the shown one starts a new document, and the next turn appends to that', async () => {
    // Round 77 (user report 28.10.2026): one turn back in a variation and a new choice rebuilt the branch. The frame kept the old
    // line and the new turn appended after its tail, so the frame played the old attack and then the new one.
    const oldLine = `${LOG}\n|move|p1a: Garchomp|Earthquake|p2a: Ferrothorn\n|turn|3`;
    const newTurn = ['|move|p1a: Garchomp|Stone Edge|p2a: Ferrothorn', '|turn|3'];
    const { rerender } = render(<PSReplayFrame log={oldLine} liveUpdates reloadKey="session" title="Branch" />);
    rerender(<PSReplayFrame log={LOG} liveUpdates reloadKey="session" title="Branch" />);
    const frame = screen.getByTitle('Branch') as HTMLIFrameElement;
    expect(frame).toHaveAttribute('src', 'blob:test/2');
    const rebuilt = vi.mocked(URL.createObjectURL).mock.calls[1][0] as Blob;
    expect(await rebuilt.text()).not.toContain('|turn|3');

    const postMessage = vi.fn();
    const contentWindow = { postMessage };
    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: contentWindow });
    const ready = new MessageEvent('message', { data: { type: 'ps-replay-ready' } });
    Object.defineProperty(ready, 'source', { value: contentWindow });
    act(() => { window.dispatchEvent(ready); });
    rerender(<PSReplayFrame log={`${LOG}\n${newTurn.join('\n')}`} liveUpdates reloadKey="session" title="Branch" />);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ps-append-log', lines: newTurn }), '*');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  test('a new live document for a turn just played opens at the start of that turn and plays it in', async () => {
    // Round 77 (user report 28.10.2026): the first turn of a new variation (Iron Head into Recover) showed its end at
    // once, while every later turn played out. The frame mounts after the turn ran, with the turn already in its log.
    const played = ['|move|p1a: Garchomp|Earthquake|p2a: Ferrothorn', '|-damage|p2a: Ferrothorn|40/100', '|turn|2'];
    const log = `|player|p1|Alice|\n|player|p2|Bob|\n|turn|1\n${played.join('\n')}`;
    const props = { log, liveUpdates: true, reloadKey: 'session', title: 'Branch', seekTurn: 2, liveAppendMode: 'play' as const, liveAppendTurn: 1 };
    const { rerender } = render(<PSReplayFrame {...props} openAtTurn={1} />);
    const html = await (vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).text();
    expect(html).toContain('|turn|1');
    expect(html).not.toContain('|turn|2');
    expect(html).toContain('{ turn: 1, autoPlay: false }');

    const frame = screen.getByTitle('Branch') as HTMLIFrameElement;
    const postMessage = vi.fn();
    const contentWindow = { postMessage };
    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: contentWindow });
    const ready = new MessageEvent('message', { data: { type: 'ps-replay-ready' } });
    Object.defineProperty(ready, 'source', { value: contentWindow });
    act(() => { window.dispatchEvent(ready); });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ps-append-log', lines: played, playFromTurn: 1 }), '*');

    // The pointer moving on keeps the document; only a new document reads the opening turn.
    rerender(<PSReplayFrame {...props} openAtTurn={null} />);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  test('a live document opened by navigation shows the position, with the whole line in its log', async () => {
    render(<PSReplayFrame log={`${LOG}\n|move|p1a: Garchomp|Earthquake|p2a: Ferrothorn\n|turn|3`} liveUpdates reloadKey="session" seekTurn={3} liveAppendMode="play" liveAppendTurn={2} />);
    const html = await (vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).text();
    expect(html).toContain('|turn|3');
    expect(html).toContain('{ turn: 3, autoPlay: false }');
  });
});
