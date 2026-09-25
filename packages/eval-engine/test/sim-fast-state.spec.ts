import { afterEach, describe, expect, test } from 'vitest';
import {
  breakSimFast, configureSimFast, parseSimFastSwitch, resetSimFastForTests, SIM_FAST_DEFAULT, simFastCounters, simFastOn,
  simFastStatus, takeSimFastReport,
} from '../src/forward/sim-fast/state';

afterEach(() => resetSimFastForTests());

function withEnvironment(value: string | undefined, run: () => void): void {
  const saved = process.env.EVAL_SIM_FAST;
  if (value === undefined) delete process.env.EVAL_SIM_FAST;
  else process.env.EVAL_SIM_FAST = value;
  try {
    resetSimFastForTests();
    run();
  } finally {
    if (saved === undefined) delete process.env.EVAL_SIM_FAST;
    else process.env.EVAL_SIM_FAST = saved;
    resetSimFastForTests();
  }
}

describe('the switch', () => {
  test('reads 0, 1 and lever lists; an empty value means the default', () => {
    expect(parseSimFastSwitch(undefined)).toBeNull();
    expect(parseSimFastSwitch(' ')).toBeNull();
    expect(parseSimFastSwitch('0')).toEqual([]);
    expect(parseSimFastSwitch('1')).toEqual(['rules', 'clone', 'dispatch']);
    expect(parseSimFastSwitch('dispatch, rules')).toEqual(['rules', 'dispatch']);
    expect(() => parseSimFastSwitch('clone,turbo')).toThrow(/unknown lever "turbo"/);
  });

  test('a configured list turns exactly those levers on', () => {
    configureSimFast(['clone']);
    expect([simFastOn('rules'), simFastOn('clone'), simFastOn('dispatch')]).toEqual([false, true, false]);
    expect(simFastStatus()).toBe('active');
    configureSimFast([]);
    expect(simFastStatus()).toBe('off');
  });

  test('under Node a set variable decides and forces', () => {
    withEnvironment('dispatch', () => {
      expect(simFastOn('dispatch')).toBe(true);
      expect(simFastOn('clone')).toBe(false);
      expect(() => breakSimFast('fallback', 'probe')).toThrow(/sim-fast fallback: probe/);
    });
  });

  test('under Node without the variable the default holds and nothing is forced', () => {
    withEnvironment(undefined, () => {
      expect(simFastStatus()).toBe(SIM_FAST_DEFAULT.length > 0 ? 'active' : 'off');
      expect(() => breakSimFast('fallback', 'probe')).not.toThrow();
      expect(simFastStatus()).toBe('fallback');
    });
  });
});

describe('status and counters', () => {
  test('a report carries the counters since the last report', () => {
    configureSimFast(['clone']);
    simFastCounters.clones += 3;
    expect(takeSimFastReport()).toEqual({
      status: 'active', counters: { ruleTables: 0, clones: 3, dispatchCalls: 0, dispatchAnswered: 0, fallbacks: 0 },
    });
    expect(takeSimFastReport().counters.clones).toBe(0);
  });

  test('a break turns every lever off and outlives what the host configures next', () => {
    configureSimFast(['rules', 'clone', 'dispatch']);
    breakSimFast('fallback', 'probe');
    expect(simFastStatus()).toBe('fallback');
    expect(simFastOn('clone')).toBe(false);
    configureSimFast(['clone']);
    expect(simFastOn('clone')).toBe(false);
    expect(takeSimFastReport().counters.fallbacks).toBe(1);
  });

  test('forced mode throws instead of falling back', () => {
    configureSimFast(['clone'], { forced: true });
    expect(() => breakSimFast('hash-mismatch', 'Battle.runEvent')).toThrow(/sim-fast hash-mismatch: Battle.runEvent/);
    expect(simFastStatus()).toBe('active');
  });
});
