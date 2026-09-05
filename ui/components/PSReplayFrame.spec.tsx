import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PSReplayFrame } from '../../src/components/PSReplayFrame';

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

  test('a new reload key remounts the document; a live frame keeps its document across log growth', () => {
    const { rerender } = render(<PSReplayFrame log={LOG} reloadKey="a" />);
    rerender(<PSReplayFrame log={LOG} reloadKey="b" />);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);

    const live = render(<PSReplayFrame log={LOG} liveUpdates reloadKey="session" />);
    live.rerender(<PSReplayFrame log={`${LOG}\n|turn|3`} liveUpdates reloadKey="session" />);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
  });
});
