import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  UI_SCALE_EVENT, UI_SCALE_PROPERTY, appliedUiScale, getUiScaleState, setUiScaleSetting, startUiScale, subscribeUiScale,
} from '../../../src/lib/ui-scale-store';
import { UI_SCALE_STORAGE_KEY } from '../../../src/lib/ui-scale-setting';

/**
 * Round 84 (T315, A7d): the scale lives in one store, started once at the app's root. It reads the setting and the window, writes
 * `--ps-scale` onto the root element (base.css gives `html` its `zoom` from it and divides the vh rules by it), and follows the
 * window's resize with a listener, no React state and no effect. The window is the real one in CSS pixels, never the zoomed tree.
 */
function resizeTo(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

let stop: (() => void) | null = null;
const root = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  root().style.removeProperty(UI_SCALE_PROPERTY);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 2560 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1290 });
});
afterEach(() => { stop?.(); stop = null; vi.restoreAllMocks(); });

describe('the store', () => {
  test('Auto at 2560 x 1290 writes the factor 1.5 to the root', () => {
    stop = startUiScale();
    expect(getUiScaleState()).toMatchObject({ setting: 'auto', scale: 1.5, width: 2560 });
    expect(root().style.getPropertyValue(UI_SCALE_PROPERTY)).toBe('1.5');
    expect(appliedUiScale()).toBe(1.5);
  });

  test('a window that gives the app no more than its own room writes nothing: the stylesheet\'s fallback is 100 %', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1366 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 657 });
    stop = startUiScale();
    expect(getUiScaleState().scale).toBe(1);
    expect(root().style.getPropertyValue(UI_SCALE_PROPERTY)).toBe('');
    expect(appliedUiScale()).toBe(1);
  });

  test('the window\'s resize moves the factor both ways, and listeners hear each change once', () => {
    stop = startUiScale();
    const heard = vi.fn();
    const off = subscribeUiScale(heard);
    resizeTo(3840, 2010);
    expect(getUiScaleState().scale).toBe(2);
    expect(root().style.getPropertyValue(UI_SCALE_PROPERTY)).toBe('2');
    resizeTo(1920, 970);
    expect(getUiScaleState().scale).toBe(1);
    expect(root().style.getPropertyValue(UI_SCALE_PROPERTY)).toBe('');
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    resizeTo(2560, 1290);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  test('a resize that leaves the step as it was leaves the root and the frames alone; the menu hears the new width', () => {
    stop = startUiScale();
    const heard = vi.fn();
    const frames = vi.fn();
    subscribeUiScale(heard);
    window.addEventListener(UI_SCALE_EVENT, frames);
    resizeTo(2600, 1300);
    expect(getUiScaleState()).toMatchObject({ scale: 1.5, width: 2600 });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(frames).not.toHaveBeenCalled();
    resizeTo(2600, 1300);
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(UI_SCALE_EVENT, frames);
  });

  test('a chosen step overrides Auto, persists, and Auto takes it back', () => {
    stop = startUiScale();
    setUiScaleSetting(1.25);
    expect(getUiScaleState()).toMatchObject({ setting: 1.25, scale: 1.25 });
    expect(root().style.getPropertyValue(UI_SCALE_PROPERTY)).toBe('1.25');
    expect(localStorage.getItem(UI_SCALE_STORAGE_KEY)).toBe('1.25');
    setUiScaleSetting('auto');
    expect(getUiScaleState().scale).toBe(1.5);
    expect(localStorage.getItem(UI_SCALE_STORAGE_KEY)).toBeNull();
  });

  test('a stored step is read at the start, as after a reload', () => {
    localStorage.setItem(UI_SCALE_STORAGE_KEY, '1.75');
    stop = startUiScale();
    expect(getUiScaleState()).toMatchObject({ setting: 1.75, scale: 1.75 });
  });

  test('a stored step the window no longer allows falls back to the largest allowed one below it', () => {
    localStorage.setItem(UI_SCALE_STORAGE_KEY, '2');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1700 });
    stop = startUiScale();
    // 1700 / 1.5 = 1133 reaches 1050, 1700 / 1.75 = 971 does not.
    expect(getUiScaleState()).toMatchObject({ setting: 2, scale: 1.5 });
  });

  test('a change tells the frames: the event fires after the root changed', () => {
    stop = startUiScale();
    const seen: string[] = [];
    window.addEventListener(UI_SCALE_EVENT, () => seen.push(root().style.getPropertyValue(UI_SCALE_PROPERTY)));
    setUiScaleSetting(2);
    expect(seen).toEqual(['2']);
  });

  test('stopping removes the listener and the property', () => {
    stop = startUiScale();
    stop();
    stop = null;
    expect(root().style.getPropertyValue(UI_SCALE_PROPERTY)).toBe('');
    resizeTo(3840, 2010);
    expect(getUiScaleState().scale).toBe(1.5);
  });

  test('storage that throws leaves Auto and a choice that holds for the page', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    stop = startUiScale();
    expect(getUiScaleState().setting).toBe('auto');
    expect(() => setUiScaleSetting(1.25)).not.toThrow();
    expect(getUiScaleState().scale).toBe(1.25);
  });
});
