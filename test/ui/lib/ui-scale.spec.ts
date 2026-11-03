import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  STACK_BREAKPOINT, UI_SCALE_ROOM, UI_SCALE_STEPS, autoScale, resolveScale, scaleLabel, stepAllowed, stepDisabledReason,
} from '../../../src/lib/ui-scale';
import { UI_SCALE_STORAGE_KEY, parseUiScale, readUiScale, writeUiScale } from '../../../src/lib/ui-scale-setting';

/**
 * Round 84 (T315, A7c): the rule for Auto (spec addendum A, 7a) and the setting. The table is the spec's: the largest step of 25 % at
 * which the window still gives the app 1400 x 820 px, measured in CSS pixels so a browser zoom already set counts.
 */
describe('Auto', () => {
  test.each([
    [1366, 657, 1], [1366, 768, 1], [1920, 970, 1], [1920, 1080, 1.25], [1400, 820, 1],
    [2560, 1290, 1.5], [2560, 1440, 1.75], [3840, 2010, 2], [3840, 2160, 2],
    [1750, 1025, 1.25], [1749, 1025, 1], [1750, 1024, 1],
    [2100, 1230, 1.5], [2099, 1230, 1.25], [2100, 1229, 1.25],
    [2450, 1435, 1.75], [2449, 1435, 1.5], [2800, 1640, 2], [2799, 1640, 1.75],
    [5000, 3000, 2], [800, 600, 1], [390, 844, 1],
  ] as const)('%i x %i gives %f', (width, height, expected) => {
    expect(autoScale({ width, height })).toBe(expected);
  });

  test('every edge: a step is chosen exactly when width and height each reach 1400 and 820 times the step', () => {
    for (const step of UI_SCALE_STEPS.slice(1)) {
      const width = UI_SCALE_ROOM.width * step;
      const height = UI_SCALE_ROOM.height * step;
      expect(autoScale({ width, height })).toBe(step);
      expect(autoScale({ width: width - 1, height })).toBeLessThan(step);
      expect(autoScale({ width, height: height - 1 })).toBeLessThan(step);
    }
  });

  test('a browser zoom already set counts and never doubles: 2560 x 1290 at 150 % reads 1707 x 860 and stays at 100 %', () => {
    expect(autoScale({ width: Math.round(2560 / 1.5), height: Math.round(1290 / 1.5) })).toBe(1);
    // At 200 % browser zoom the same screen reads 1280 x 645: still 100 %.
    expect(autoScale({ width: 1280, height: 645 })).toBe(1);
  });

  test('the window growing and shrinking moves the step both ways', () => {
    expect(autoScale({ width: 1920, height: 1000 })).toBe(1);
    expect(autoScale({ width: 2560, height: 1290 })).toBe(1.5);
    expect(autoScale({ width: 1920, height: 1000 })).toBe(1);
  });
});

describe('the steps and the narrow window', () => {
  test('the steps run from 100 % to 200 % in quarters', () => {
    expect([...UI_SCALE_STEPS]).toEqual([1, 1.25, 1.5, 1.75, 2]);
    expect(STACK_BREAKPOINT).toBe(1050);
  });

  test('a step is allowed while the app keeps 1050 px of width after it', () => {
    expect(stepAllowed(1.5, 1575)).toBe(true);
    expect(stepAllowed(1.5, 1574)).toBe(false);
    expect(stepAllowed(2, 2100)).toBe(true);
    expect(stepAllowed(2, 2099)).toBe(false);
    expect(stepAllowed(1, 390)).toBe(true);
  });

  test('a disabled step says why, in plain words', () => {
    expect(stepDisabledReason(1.5, 1400)).toBe('Needs a window at least 1575 px wide');
    expect(stepDisabledReason(1.5, 1600)).toBeNull();
  });
});

describe('the factor the page takes', () => {
  test('Auto is the rule', () => {
    expect(resolveScale('auto', { width: 2560, height: 1290 })).toBe(1.5);
  });

  test('a chosen step overrides Auto, even above what Auto would pick', () => {
    expect(resolveScale(1.25, { width: 2560, height: 1290 })).toBe(1.25);
    expect(resolveScale(1.75, { width: 2560, height: 1290 })).toBe(1.75);
    expect(resolveScale(1, { width: 3840, height: 2160 })).toBe(1);
  });

  test('a chosen step that the window no longer allows falls back to the largest allowed one below it', () => {
    expect(resolveScale(2, { width: 1800, height: 1000 })).toBe(1.5);
    expect(resolveScale(2, { width: 1320, height: 900 })).toBe(1.25);
    expect(resolveScale(2, { width: 1000, height: 700 })).toBe(1);
  });

  test('labels', () => {
    expect(scaleLabel('auto')).toBe('Auto');
    expect(scaleLabel(1.25)).toBe('125 %');
    expect(scaleLabel(2)).toBe('200 %');
  });
});

describe('the setting', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  test('reads a stored step, and Auto for anything else', () => {
    expect(parseUiScale('1.5')).toBe(1.5);
    expect(parseUiScale('2')).toBe(2);
    expect(parseUiScale('1')).toBe(1);
    for (const raw of [null, undefined, '', 'auto', '3', '1.3', 'big']) expect(parseUiScale(raw)).toBe('auto');
  });

  test('persists under the key of the app and Auto removes it', () => {
    expect(UI_SCALE_STORAGE_KEY).toBe('ps-replay-interceptor:ui-scale');
    expect(readUiScale()).toBe('auto');
    writeUiScale(1.75);
    expect(localStorage.getItem(UI_SCALE_STORAGE_KEY)).toBe('1.75');
    expect(readUiScale()).toBe(1.75);
    writeUiScale('auto');
    expect(localStorage.getItem(UI_SCALE_STORAGE_KEY)).toBeNull();
    expect(readUiScale()).toBe('auto');
  });

  test('a storage that throws means Auto and never an error', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readUiScale()).toBe('auto');
    expect(() => writeUiScale(2)).not.toThrow();
  });
});
