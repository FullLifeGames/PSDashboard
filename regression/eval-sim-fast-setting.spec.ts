import { afterEach, expect, test, vi } from 'vitest';
import { perfReport, perfReset, SIM_FAST_DEFAULT, simFastStatus } from '@fulllifegames/eval-engine';
import { simFastOn } from '../packages/eval-engine/src/forward/sim-fast/state';
import {
  adoptSimFastStamp, readSimFastLevers, recordSimFastReport, SIM_FAST_STORAGE_KEY,
} from '../src/lib/eval/sim-fast-setting';

function stubStorage(values: Record<string, string>): void {
  vi.stubGlobal('localStorage', { getItem: (key: string) => values[key] ?? null, setItem: () => undefined });
}

afterEach(() => vi.unstubAllGlobals());

test('the override: 0, 1 or a lever list; missing or unknown means the default', () => {
  stubStorage({});
  expect(readSimFastLevers()).toEqual(SIM_FAST_DEFAULT);
  stubStorage({ [SIM_FAST_STORAGE_KEY]: '0' });
  expect(readSimFastLevers()).toEqual([]);
  stubStorage({ [SIM_FAST_STORAGE_KEY]: '1' });
  expect(readSimFastLevers()).toEqual(['rules', 'clone', 'dispatch']);
  stubStorage({ [SIM_FAST_STORAGE_KEY]: 'clone' });
  expect(readSimFastLevers()).toEqual(['clone']);
  stubStorage({ [SIM_FAST_STORAGE_KEY]: 'turbo' });
  expect(readSimFastLevers()).toEqual(SIM_FAST_DEFAULT);
});

test('a worker report lands in the perf trace', () => {
  stubStorage({ 'ps-replay-interceptor:perf': '1' });
  perfReset();
  recordSimFastReport({ status: 'active', counters: { ruleTables: 2, clones: 5, dispatchCalls: 10, dispatchAnswered: 9, fallbacks: 0 } });
  perfReport('sim-fast spec');
  const perf = (globalThis as { __EVAL_PERF__?: { counters: Record<string, number> } }).__EVAL_PERF__!;
  expect(perf.counters['simFast:status:active']).toBe(1);
  expect(perf.counters['simFast:clones']).toBe(5);
  expect(perf.counters['simFast:fallbacks']).toBeUndefined();
});

test('a message without the stamp leaves the configuration alone', () => {
  // From the kill switch: a handler that falls back to the default (all levers) would turn the worker on.
  adoptSimFastStamp({ simFast: [] });
  adoptSimFastStamp({});
  expect(simFastStatus()).toBe('off');
  // From one lever: a fallback to the default would add rules and dispatch, one to [] would turn clone off.
  adoptSimFastStamp({ simFast: ['clone'] });
  adoptSimFastStamp({});
  expect(simFastStatus()).toBe('active');
  expect({ rules: simFastOn('rules'), clone: simFastOn('clone'), dispatch: simFastOn('dispatch') }).toEqual({ rules: false, clone: true, dispatch: false });
});
