import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FRAME_HEIGHT_PROPERTY, followContentHeight } from '../../../src/lib/replay-frame-height';
import { PHONE_CLASS } from '../../../src/lib/replay-phone';

// The page's own observer on the frame's body raised "ResizeObserver loop completed with undelivered notifications".
let frameCallback: (() => void) | null = null;
let pageObservers = 0;
let observed: unknown[] = [];
let disconnected = 0;

beforeEach(() => {
  frameCallback = null;
  pageObservers = 0;
  observed = [];
  disconnected = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor() { pageObservers += 1; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

function frame(height: number, phone: boolean) {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  const root = doc.documentElement;
  if (phone) root.classList.add(PHONE_CLASS);
  let current = height;
  Object.defineProperty(doc.body, 'offsetHeight', { get: () => current, configurable: true });
  Object.defineProperty(iframe.contentWindow!, 'ResizeObserver', {
    configurable: true,
    value: class {
      constructor(callback: () => void) { frameCallback = callback; }
      observe(target: unknown) { observed.push(target); }
      disconnect() { disconnected += 1; }
    },
  });
  return { iframe, root, body: doc.body, setHeight: (next: number) => { current = next; } };
}

describe('followContentHeight', () => {
  test('a phone frame takes its content\'s height', () => {
    const { iframe } = frame(812.4, true);
    followContentHeight(iframe);
    expect(iframe.style.getPropertyValue(FRAME_HEIGHT_PROPERTY)).toBe('813px');
  });

  test('a desktop frame sets nothing, so the frame keeps its own height', () => {
    const { iframe } = frame(463, false);
    const write = vi.spyOn(iframe.style, 'setProperty');
    const clear = vi.spyOn(iframe.style, 'removeProperty');
    followContentHeight(iframe);
    frameCallback!();
    frameCallback!();
    expect(iframe.style.getPropertyValue(FRAME_HEIGHT_PROPERTY)).toBe('');
    expect(write).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  test('a change of the content moves the height while the frame stays a phone frame', () => {
    const { iframe, setHeight } = frame(800, true);
    followContentHeight(iframe);
    setHeight(1000);
    frameCallback!();
    expect(iframe.style.getPropertyValue(FRAME_HEIGHT_PROPERTY)).toBe('1000px');
  });

  test('the content shrinking shrinks the frame: the root\'s scrollHeight (never below the viewport) does not count', () => {
    const { iframe, root, setHeight } = frame(1000, true);
    Object.defineProperty(root, 'scrollHeight', { get: () => 1000, configurable: true });
    followContentHeight(iframe);
    setHeight(700);
    frameCallback!();
    expect(iframe.style.getPropertyValue(FRAME_HEIGHT_PROPERTY)).toBe('700px');
  });

  test('the same height is written once, however often the observer reports', () => {
    const { iframe } = frame(800, true);
    const write = vi.spyOn(iframe.style, 'setProperty');
    followContentHeight(iframe);
    frameCallback!();
    frameCallback!();
    frameCallback!();
    expect(write).toHaveBeenCalledTimes(1);
  });

  test('the observer is the frame document\'s own and watches its body; the page\'s ResizeObserver is never built', () => {
    const { iframe, body } = frame(800, true);
    followContentHeight(iframe);
    expect(observed).toEqual([body]);
    expect(pageObservers).toBe(0);
  });

  test('the frame leaving phone mode gives the height back', async () => {
    const { iframe, root } = frame(800, true);
    followContentHeight(iframe);
    root.classList.remove(PHONE_CLASS);
    await Promise.resolve();
    expect(iframe.style.getPropertyValue(FRAME_HEIGHT_PROPERTY)).toBe('');
  });

  test('the disposer stops following', () => {
    const { iframe } = frame(800, true);
    const dispose = followContentHeight(iframe);
    dispose();
    expect(disconnected).toBeGreaterThan(0);
    expect(iframe.style.getPropertyValue(FRAME_HEIGHT_PROPERTY)).toBe('');
  });

  test('a frame window without the observer (jsdom, an old browser) gets the first measurement only', () => {
    const { iframe } = frame(640, true);
    Object.defineProperty(iframe.contentWindow!, 'ResizeObserver', { configurable: true, value: undefined });
    vi.stubGlobal('ResizeObserver', undefined);
    followContentHeight(iframe);
    expect(iframe.style.getPropertyValue(FRAME_HEIGHT_PROPERTY)).toBe('640px');
  });

  test('a frame without a document (not loaded, or cross-origin) is left alone', () => {
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'contentDocument', { get: () => null });
    expect(() => followContentHeight(iframe)()).not.toThrow();
  });
});
