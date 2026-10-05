import { test, expect, describe } from 'vitest';
import { analyzeTurn, type AnalyzeTurnParams } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import type { SackInfo } from '../src/played';
import type { EvalResult, RankedChoice } from '../src/types';

const names: [string, string] = ['Alpha', 'Beta'];

const ranked = (choice: string, label: string, worstCase: number, expected: number, ev: number, punishedBy: string | null): RankedChoice =>
  ({ choice, label, worstCase, expected, ev, punishedBy });

/**
 * Round 63 (T17, decision 17): praise without a verdict band. Only sides
 * the regret leaves untiered get the new forms; every tiered turn keeps
 * today's sack logic to the letter.
 */
describe('the stayed feed without a band (573756 t68)', () => {
  /** p2 leaves Weavile in to die to Body Press: the floor it priced is what came, and the sweep follows. */
  const t68 = (overrides: Partial<AnalyzeTurnParams> = {}, sack: SackInfo = { name: 'Weavile', hpFraction: 0.6, stayed: true }) => {
    const result: EvalResult = {
      score: 0.183, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [ranked('move bodypress', 'Body Press', 0.359, 0.4, 0.178, 'Knock Off')],
        p2: [
          ranked('switch 3', '→ Toxapex', -0.156, 0.0, -0.149, 'Body Press'),
          ranked('move knockoff', 'Knock Off', -0.359, 0.08, -0.178, 'Body Press'),
        ],
      },
    };
    return analyzeTurn({
      turn: 68, result,
      played: { p1: { kind: 'move', name: 'Body Press' }, p2: { kind: 'move', name: 'Knock Off' } },
      playedOutcome: 0.448, futureOutcomes: [0.326, 0.242, -0.389],
      scoreBefore: 0.183, scoreAfter: 0.282,
      sacks: { p2: sack },
      ...overrides,
    });
  };

  test('the untiered feed whose floor came and whose window repaid it is stamped and spoken', () => {
    const analysis = t68();
    expect(analysis.p2.tier).toBeUndefined();
    expect(analysis.p2.sacrifice).toEqual({ name: 'Weavile', hpFraction: 0.6, stayed: true, verified: true });
    expect(summarizeTurn(analysis, names)).toContain('Beta fed Weavile (60% HP)');
    // The verdict fields stay as they were: no band, no risk credit, the same attribution.
    expect(analysis.p2.riskPaidOff).toBeUndefined();
    expect(analysis.attribution).toBe('quiet');
  });

  test('a feed above its priced floor (the rolls helped) is no verified sacrifice', () => {
    expect(t68({ playedOutcome: 0.2, futureOutcomes: [0.326, 0.242, -0.389] }).p2.sacrifice).toBeUndefined();
  });

  test('an already-lost position earns no praise (the gamble credit\'s bound)', () => {
    expect(t68({ scoreBefore: 0.75 }).p2.sacrifice).toBeUndefined();
  });

  test('untiered low-HP and healthy faints stay unstamped: those shapes are leniencies, not praise', () => {
    expect(t68({}, { name: 'Weavile', hpFraction: 0.1 }).p2.sacrifice).toBeUndefined();
    expect(t68({}, { name: 'Weavile', hpFraction: 0.6, healthy: true }).p2.sacrifice).toBeUndefined();
  });
});

describe('the hazard sack without a band (653785 t19)', () => {
  /** p1 switches a 22% Weavile into the rocks; it falls before Charizard's Flare Blitz, which hits nothing. */
  const t19 = (overrides: Partial<AnalyzeTurnParams> = {}) => {
    const result: EvalResult = {
      score: -0.045, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [
          ranked('move painsplit', 'Pain Split', -0.3, 0.0, -0.082, 'Mega + Flare Blitz'),
          ranked('switch 5', '→ Tornadus-Therian', -0.106, 0.0, -0.09, 'Mega + Roost'),
          ranked('switch 4', '→ Weavile', -0.22, 0.0, -0.0839, 'Mega + Roost'),
        ],
        p2: [ranked('move flareblitz mega', 'Mega + Flare Blitz', 0.0, 0.0, 0.08, 'Pain Split')],
      },
    };
    return analyzeTurn({
      turn: 19, result,
      played: { p1: { kind: 'switch', name: 'Weavile', species: 'Weavile' }, p2: { kind: 'move', name: 'Flare Blitz', mega: true } },
      playedOutcome: 0.23, futureOutcomes: [0.395, 0.547],
      scoreBefore: -0.045, scoreAfter: 0.18,
      sacks: { p1: { name: 'Weavile', hpFraction: 63 / 281, healthy: true, hazard: true } },
      ...overrides,
    });
  };

  test('singles: the untiered hazard sack is stamped and the card names the hazards', () => {
    const analysis = t19();
    expect(analysis.p1.tier).toBeUndefined();
    expect(analysis.p1.sacrifice).toEqual({ name: 'Weavile', hpFraction: 63 / 281, healthy: true, hazard: true, verified: true });
    const summary = summarizeTurn(analysis, names);
    expect(summary).toContain('Alpha sacked Weavile (22% HP) into the entry hazards');
  });

  test('when the rolls after the pair carried the gain, the hazard sack earns nothing', () => {
    expect(t19({ scoreAfter: 0.4 }).p1.sacrifice).toBeUndefined();
  });
});

describe('doubles: the same forms ride on the pair choice', () => {
  test('an untiered stayed feed of a doubles side is stamped like a singles one', () => {
    const result: EvalResult = {
      score: 0.3, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [
          ranked('move protect, move heatwave', 'Protect + Heat Wave', 0.2, 0.3, 0.25, 'Close Combat→Chi-Yu + Protect'),
          ranked('move darkpulse 1, move heatwave', 'Dark Pulse→Rillaboom + Heat Wave', -0.1, 0.3, 0.2, 'Close Combat→Chi-Yu + Protect'),
        ],
        p2: [ranked('move closecombat 1, move protect', 'Close Combat→Chi-Yu + Protect', -0.2, -0.2, -0.2, null)],
      },
    };
    const analysis = analyzeTurn({
      turn: 9, result,
      played: {
        p1: null, p2: null,
        p1Slots: [{ kind: 'move', name: 'Dark Pulse', targetLoc: 1 }, { kind: 'move', name: 'Heat Wave', targetLoc: null }],
        p2Slots: [{ kind: 'move', name: 'Close Combat', targetLoc: 1 }, { kind: 'move', name: 'Protect', targetLoc: null }],
      },
      playedOutcome: -0.1, futureOutcomes: [0.2, 0.4],
      scoreBefore: 0.3, scoreAfter: -0.12,
      sacks: { p1: { name: 'Chi-Yu', hpFraction: 0.5, stayed: true } },
    });
    expect(analysis.p1.tier).toBeUndefined();
    expect(analysis.p1.sacrifice).toEqual({ name: 'Chi-Yu', hpFraction: 0.5, stayed: true, verified: true });
  });
});
