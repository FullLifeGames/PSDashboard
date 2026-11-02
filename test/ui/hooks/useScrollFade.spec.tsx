import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useScrollFade } from '../../../src/hooks/useScrollFade';

/**
 * Round 84 (turn dock), A7b, ruling 9a: a list that scrolls inside its panel fades out at its foot while more follows. The hook
 * writes `data-more="true"` on the list from its scroll position and its size, never through React state: the fade is gone at the
 * list's end and when everything fits.
 */
type Geometry = { scrollTop: number; clientHeight: number; scrollHeight: number };
const geometry: Geometry = { scrollTop: 0, clientHeight: 200, scrollHeight: 500 };

function Probe() {
  const attach = useScrollFade();
  return (
    <div
      data-testid="list"
      ref={element => {
        if (element) for (const key of Object.keys(geometry) as (keyof Geometry)[]) Object.defineProperty(element, key, { configurable: true, get: () => geometry[key] });
        attach(element);
      }}
    />
  );
}
const more = (element: HTMLElement) => element.getAttribute('data-more');

function stubObservers() {
  const state = { resize: null as null | (() => void), mutate: null as null | (() => void), disconnected: 0 };
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { state.resize = callback; }
    observe() {}
    disconnect() { state.disconnected++; }
  });
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { state.mutate = callback; }
    observe() {}
    disconnect() { state.disconnected++; }
  });
  return state;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(geometry, { scrollTop: 0, clientHeight: 200, scrollHeight: 500 });
});

describe('useScrollFade', () => {
  test('marks a list with more below it, and drops the mark at the list\'s end', () => {
    stubObservers();
    const { container } = render(<Probe />);
    const list = container.firstElementChild as HTMLElement;
    expect(more(list)).toBe('true');
    geometry.scrollTop = 150;
    fireEvent.scroll(list);
    expect(more(list)).toBe('true');
    geometry.scrollTop = 300;
    fireEvent.scroll(list);
    expect(more(list)).toBeNull();
  });

  test('a list that fits has no mark, and a resize or a change of content sets it', () => {
    const observers = stubObservers();
    geometry.scrollHeight = 200;
    const { container } = render(<Probe />);
    const list = container.firstElementChild as HTMLElement;
    expect(more(list)).toBeNull();
    geometry.scrollHeight = 600;
    observers.resize?.();
    expect(more(list)).toBe('true');
    geometry.scrollHeight = 200;
    observers.mutate?.();
    expect(more(list)).toBeNull();
  });

  test('lets go of the observers with the list', () => {
    const observers = stubObservers();
    const { unmount } = render(<Probe />);
    unmount();
    expect(observers.disconnected).toBeGreaterThanOrEqual(2);
  });
});
