import { describe, expect, test } from 'vitest';
import { playedOutcomeSettings } from '../../src/lib/eval/worker-client';

// Serialization strips the custom rules of draft leagues and custom games; the flag restores the clause.
describe('played-pair sub-search settings', () => {
  test("the played pair's sub-search keeps the Sleep Clause of the sweep", () => {
    expect(playedOutcomeSettings({ depth: 2, samples: 3, tera: false, sleepClause: true, ruleset: 'standard' })?.sleepClause).toBe(true);
    expect(playedOutcomeSettings({ depth: 3, samples: 1, tera: true, sleepClause: true, ruleset: 'vgc' })?.sleepClause).toBe(true);
    expect(playedOutcomeSettings({ depth: 1, samples: 1, tera: false, mode: 'mcts', sleepClause: true, ruleset: 'standard' })?.sleepClause).toBe(true);
  });

  test('a format without the clause stays without it', () => {
    expect(playedOutcomeSettings({ depth: 2, samples: 3, tera: false, sleepClause: false, ruleset: 'standard' })?.sleepClause).toBe(false);
  });
});
