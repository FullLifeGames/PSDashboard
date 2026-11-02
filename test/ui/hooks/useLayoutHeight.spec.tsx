import { afterEach, describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useLayoutHeight } from '../../../src/hooks/useLayoutHeight';

/**
 * Round 84 (turn dock), A7b, ruling 9a: the layout's own height goes to the layout element as `--ps-layout-h` (the cap of the left
 * column), from a ResizeObserver; React state stays out of it. A height of 0 (no layout yet) writes nothing, so the CSS fallback holds.
 */
function Probe({ height = 700 }: { height?: number }) {
  const attach = useLayoutHeight();
  return <div data-testid="layout" ref={element => { if (element) Object.defineProperty(element, 'clientHeight', { configurable: true, value: height }); attach(element); }} />;
}
const read = (element: HTMLElement) => element.style.getPropertyValue('--ps-layout-h');

function stubObserver() {
  const state = { callback: null as null | (() => void), disconnected: 0, observed: 0 };
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { state.callback = callback; }
    observe() { state.observed++; }
    unobserve() {}
    disconnect() { state.disconnected++; }
  });
  return state;
}

afterEach(() => vi.unstubAllGlobals());

describe('useLayoutHeight', () => {
  test('writes the height at once, follows the observer, and lets go with the element', () => {
    const observer = stubObserver();
    const { container, unmount } = render(<Probe height={700} />);
    const layout = container.firstElementChild as HTMLElement;
    expect(read(layout)).toBe('700px');
    expect(observer.observed).toBe(1);
    Object.defineProperty(layout, 'clientHeight', { configurable: true, value: 640 });
    observer.callback?.();
    expect(read(layout)).toBe('640px');
    unmount();
    expect(observer.disconnected).toBeGreaterThan(0);
  });

  test('a layout without a height writes nothing, so the stylesheet\'s 100% stays', () => {
    stubObserver();
    const { container } = render(<Probe height={0} />);
    expect(read(container.firstElementChild as HTMLElement)).toBe('');
  });

  test('a window without the observer gets the first measurement only', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { container } = render(<Probe height={500} />);
    expect(read(container.firstElementChild as HTMLElement)).toBe('500px');
  });
});
