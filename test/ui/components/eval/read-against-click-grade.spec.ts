import { describe, expect, test } from 'vitest';
import { lostGround, type SideAnalysis } from '@fulllifegames/eval-engine';
import { gradedSides, gradedTier } from '../../../../src/components/eval/game-review';
import { sideAnalysis, turnAnalysis } from '../../fixtures/analysis';
import { rankedChoice } from '../../fixtures/eval-result';

/**
 * Round 89 (B6a): the Game review grades a side as the turn card does, from the fields alone, so singles and doubles read the same
 * rule. The engine (packages/eval-engine/test/read-against-click.spec.ts) decides which risks keep `riskPaidOff`; here a risk whose
 * played cell trailed the safe cell in the clicked column (the field `safeAgainstClick` without the credit) is graded as the tier
 * it earned, as 2663093831 t6 (an inaccuracy) and t8 (a mistake) are.
 */
const best = rankedChoice('move 1', 'Hydro Pump', 0.1);
const played = rankedChoice('move 2', 'Hyper Voice', -0.05);
const risk = (tier: 'inaccuracy' | 'mistake', overrides: Partial<SideAnalysis> = {}): SideAnalysis => ({
  ...sideAnalysis(), played, best, safe: best, regret: 0.15, tier,
  safeAgainstClick: { against: 'Protect', playedValue: 0.325, safeValue: 0.454 }, ...overrides,
});

describe('a risk that the safe line matched against the click is graded', () => {
  test.each(['inaccuracy', 'mistake'] as const)('%s: graded without the read credit', tier => {
    expect(gradedTier(risk(tier))).toBe(tier);
  });

  test.each(['inaccuracy', 'mistake'] as const)('%s: with the credit it is no grade', tier => {
    expect(gradedTier(risk(tier, { riskPaidOff: true }))).toBeNull();
  });

  test('the review lists the graded side of a turn', () => {
    const analysis = turnAnalysis(8, { p1: risk('inaccuracy'), p2: sideAnalysis() });
    expect(gradedSides([analysis]).map(entry => [entry.side, entry.grade])).toEqual([['p1', 'inaccuracy']]);
    expect(lostGround(analysis, 'p1')).toBe(false);
  });
});
