import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FRAME_HEIGHT_PROPERTY, followContentHeight } from '../../../src/lib/replay-frame-height';
import { PHONE_CLASS } from '../../../src/lib/replay-phone';

/**
 * Round 84 (T315, A7c, ruling 10a): in phone mode the frame's height follows its content (the scene, the controls and the log
 * stand in one column) instead of REPLAY_FRAME_HEIGHT; in the desktop layout the property stays unset and the frame keeps its height.
 */
let resizeCallback: (() => void) | null = null;
let disconnected = 0;

beforeEach(() => {
  resizeCallback = null;
  disconnected = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeCallback = callback; }
    observe() {}
    disconnect() { disconnected += 1; }
  });
});
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

function frame(height: number, phone: boolean) {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const root = iframe.contentDocument!.documentElement;
  if (phone) root.classList.add(PHONE_CLASS);
  let current = height;
  Object.defineProperty(root, 'scrollHeight', { get: () => current, configurable: true });
  return { iframe, root, setHeight: (next: number) => { current = next; } };
}

describe('followContentHeight', () => {
  test('a phone frame takes its content\'s height', () => {
    const { iframe } = frame(812.4, true);
    followContentHeight(iframe);
    expect(iframe.style.getPropertyValue(FRAME_HEIGHT_PROPERTY)).toBe('813px');
  });

  test('a desktop frame sets nothing, so the frame keeps its own height', () => {
    const { iframe } = frame(463, false);
    followContentHeight(iframe);
    expect(iframe.style.getPropertyValue(FRAME_HEIGHT_PROPERTY)).toBe('');
  });

  test('a change of the content moves the height while the frame stays a phone frame', () => {
    const { iframe, setHeight } = frame(800, true);
    followContentHeight(iframe);
    setHeight(1000);
    resizeCallback!();
    expect(iframe.style.getPropertyValue(FRAME_HEIGHT_PROPERTY)).toBe('1000px');
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
  });

  test('a frame without a document (not loaded, or cross-origin) is left alone', () => {
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'contentDocument', { get: () => null });
    expect(() => followContentHeight(iframe)()).not.toThrow();
  });
});
