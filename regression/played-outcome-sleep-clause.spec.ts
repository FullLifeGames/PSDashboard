import { describe, expect, test } from 'vitest';
import { playedOutcomeSettings } from '../src/lib/eval/worker-client';

/**
 * Round 67 (T140): the played pair is re-searched with the sweep's own rules.
 * The sub-search's option filter falls back to the rule table that survived
 * serialization, and serialization strips the custom rules of draft leagues
 * and custom games ("@@@Sleep Clause Mod"): without the flag, the re-search
 * lets a second Pokémon fall asleep where the sweep around it does not.
 */
describe('played-pair sub-search settings', () => {
  test("the played pair's sub-search keeps the Sleep Clause of the sweep", () => {
    expect(playedOutcomeSettings({ depth: 2, samples: 3, tera: false, sleepClause: true, ruleset: 'standard' })?.sleepClause).toBe(true);
    expect(playedOutcomeSettings({ depth: 3, samples: 1, tera: true, sleepClause: true, ruleset: 'vgc' })?.sleepClause).toBe(true);
    // The tree's pair is approximated by a depth-1 sub-search: same rules.
    expect(playedOutcomeSettings({ depth: 1, samples: 1, tera: false, mode: 'mcts', sleepClause: true, ruleset: 'standard' })?.sleepClause).toBe(true);
  });

  test('a format without the clause stays without it', () => {
    expect(playedOutcomeSettings({ depth: 2, samples: 3, tera: false, sleepClause: false, ruleset: 'standard' })?.sleepClause).toBe(false);
  });
});
