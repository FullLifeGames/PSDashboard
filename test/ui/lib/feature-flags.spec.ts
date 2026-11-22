import { afterEach, describe, expect, test, vi } from 'vitest';
import { gameReviewEnabled, opponentReadsEnabled } from '../../../src/lib/feature-flags';

/**
 * Round 89 (ruling 49): both flags are off unless a build sets its env variable to 1 or true. The vitest config of the ui project
 * switches both on for the specs of the two features, so each row stubs the variable it reads.
 */
afterEach(() => vi.unstubAllEnvs());

const flags = [
  ['Game review', 'VITE_FEATURE_GAME_REVIEW', gameReviewEnabled],
  ['Opponent reads my move', 'VITE_FEATURE_OPPONENT_READS', opponentReadsEnabled],
] as const;

describe.each(flags)('the flag %s', (_name, variable, enabled) => {
  test.each([['1', true], ['true', true], ['0', false], ['false', false], ['', false], ['yes', false]])('%j reads as %s', (value, expected) => {
    vi.stubEnv(variable, value);
    expect(enabled()).toBe(expected);
  });

  test('an unset variable is off', () => {
    vi.stubEnv(variable, undefined);
    expect(enabled()).toBe(false);
  });

  test('the other flag stays as it was', () => {
    vi.stubEnv(variable, '');
    const other = flags.find(entry => entry[1] !== variable)!;
    expect(other[2]()).toBe(true);
  });
});
