import { describe, expect, test } from 'vitest';
import { stoppedEmptyHere } from '../../../src/lib/stopped-line';

/**
 * Round 89 (SB-9): the panel's line for a stop before a first result belongs to the stopped position only. The rule reads no game
 * type: singles and doubles tags are the same strings ("main:3", "variation:2").
 */
describe('stoppedEmptyHere', () => {
  const shown = { live: true, status: 'idle' as const, key: 'variation:2' };
  test.each(['variation:2', 'main:7'])('the mark of %s shows only on its own position, idle, live', tag => {
    expect(stoppedEmptyHere({ tag, empty: true }, shown)).toBe(tag === shown.key);
  });
  test('a stop that kept a partial result, no stop, a running search and a viewed turn show no line', () => {
    expect(stoppedEmptyHere({ tag: 'variation:2' }, shown)).toBe(false);
    expect(stoppedEmptyHere(null, shown)).toBe(false);
    expect(stoppedEmptyHere({ tag: 'variation:2', empty: true }, { ...shown, status: 'searching' })).toBe(false);
    expect(stoppedEmptyHere({ tag: 'variation:2', empty: true }, { ...shown, live: false })).toBe(false);
  });
});
