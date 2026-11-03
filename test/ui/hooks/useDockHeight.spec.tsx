import { afterEach, describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useDockHeight } from '../../../src/hooks/useDockHeight';

const root = document.documentElement;
const read = () => root.style.getPropertyValue('--ps-dock-h');

function Probe({ show = true, height = 120 }: { show?: boolean; height?: number }) {
  const attach = useDockHeight();
  return show ? <div ref={element => { if (element) element.getBoundingClientRect = () => ({ height }) as DOMRect; attach(element); }} data-testid="dock" /> : null;
}

/** A recording stand-in for the browser's observer: the test fires its callback by hand. */
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

afterEach(() => {
  vi.unstubAllGlobals();
  root.style.removeProperty('--ps-dock-h');
  root.style.removeProperty('--ps-scale');
});

/**
 * Round 84 (turn dock), step A6b: below 1050 px the dock is fixed, so the page pads by its height and the tray stands on top of it.
 * The hook writes the height as a CSS custom property on the root element from a ResizeObserver; React state stays out of it.
 */
describe('useDockHeight', () => {
  test('writes the dock\'s height at once, follows the observer, and removes the property with the dock', () => {
    const observer = stubObserver();
    const { rerender, unmount } = render(<Probe height={120} />);
    expect(read()).toBe('120px');
    expect(observer.observed).toBe(1);

    rerender(<Probe height={168.4} />);
    // The observer reports a new size: the property follows the element's box (rounded up).
    observer.callback?.();
    expect(read()).toBe('169px');

    rerender(<Probe show={false} />);
    expect(read()).toBe('');
    expect(observer.disconnected).toBeGreaterThan(0);
    rerender(<Probe height={90} />);
    expect(read()).toBe('90px');
    unmount();
    expect(read()).toBe('');
  });

  test('a window without a ResizeObserver still gets the first measurement and throws nothing', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { unmount } = render(<Probe height={77} />);
    expect(read()).toBe('77px');
    unmount();
    expect(read()).toBe('');
  });

  /**
   * Round 84 (T315, A7d): under the root's zoom `getBoundingClientRect` reads visual pixels (150 for a 100 px box at 150 %, Chromium
   * and WebKit), while the property feeds a CSS length inside the zoomed tree. The hook divides by the factor the root carries.
   */
  test.each([[1.5, 150, '100px'], [2, 301, '151px'], [1.25, 125, '100px'], [1, 120, '120px']])(
    'at the root factor %f a box of %f visual px writes %s',
    (factor, visual, expected) => {
      stubObserver();
      root.style.setProperty('--ps-scale', String(factor));
      render(<Probe height={visual} />);
      expect(read()).toBe(expected);
    },
  );
});
