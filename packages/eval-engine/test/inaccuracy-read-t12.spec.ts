import { test, expect, describe } from 'vitest';
import { analyzeTurn, type AnalyzeTurnParams } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import type { EvalResult, RankedChoice } from '../src/types';

const names: [string, string] = ['LordEnz', 'Dflo'];

const ranked = (choice: string, label: string, worstCase: number, expected: number, ev: number, punishedBy: string | null): RankedChoice =>
  ({ choice, label, worstCase, expected, ev, punishedBy });

/**
 * Round 77 (user report 28.10.2026, the expert pin smogtours-gen8ou-562428 t12): LordEnz's Tapu Bulu at 45% clicks Close
 * Combat into Dflo's Blacephalon, which outspeeds and takes it with Shadow Ball; Dflo switches to Weavile instead, and Close
 * Combat knocks it out on entry. The safe line is the switch to Mandibuzz. Since T249 (round 73) the regret is 0.159, an
 * inaccuracy, and the floor given up is 0.159: under the mistake band, which books its risk, and under the gamble's bound of a
 * mistake-sized floor. The read fell through every rule and the turn read as a plain shift. The numbers are the round 76
 * feedback dump's.
 */
describe('an inaccuracy that paid off as a read (562428 t12)', () => {
  const t12 = (overrides: Partial<AnalyzeTurnParams> = {}, closeCombatFloor = 0.014) => {
    const result: EvalResult = {
      score: 0.173, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [
          ranked('switch 5', '→ Mandibuzz', 0.173, 0.252, 0.173, 'Shadow Ball'),
          ranked('move closecombat', 'Close Combat', closeCombatFloor, 0.325, closeCombatFloor, 'Shadow Ball'),
        ],
        p2: [
          ranked('move shadowball', 'Shadow Ball', -0.173, 0.017, -0.173, '→ Mandibuzz'),
          ranked('switch 6', '→ Weavile', -0.621, -0.359, -0.258, 'Close Combat'),
        ],
      },
    };
    return analyzeTurn({
      turn: 12, result,
      played: { p1: { kind: 'move', name: 'Close Combat' }, p2: { kind: 'switch', name: 'Weavile' } },
      playedOutcome: 0.621, futureOutcomes: [0.615, 0.6],
      scoreBefore: 0.173, scoreAfter: 0.615,
      ...overrides,
    });
  };

  test('the inaccuracy whose punisher never came and whose outcome beat the safe floor reads as a paid-off read', () => {
    const analysis = t12();
    expect(analysis.p1.tier).toBe('inaccuracy');
    expect(analysis.p1.riskPaidOff).toBe(true);
    expect(analysis.p1.riskPayoff).toBeCloseTo(0.448, 3);
    expect(analysis.attribution).toBe('p1-read');
    const summary = summarizeTurn(analysis, names);
    expect(summary).toContain('LordEnz played Close Combat: a read that paid off, +22% over the safe switch to Mandibuzz');
    expect(summary).toContain('The floor priced in Shadow Ball; switching to Weavile came instead.');
    // The read speaks for the inaccuracy: no second sentence that calls it one.
    expect(summary).not.toContain('was an inaccuracy');
    // The credit only: the inaccuracy band keeps no risk label.
    expect(analysis.p1.riskUnpunished).toBeUndefined();
  });

  test('guards: the punisher clicked, a small payoff, a lost position, or no floor given up earn nothing', () => {
    const punished = t12({ played: { p1: { kind: 'move', name: 'Close Combat' }, p2: { kind: 'move', name: 'Shadow Ball' } }, playedOutcome: 0.014 });
    expect(punished.p1.riskPaidOff).toBeUndefined();
    expect(t12({ playedOutcome: 0.2 }).p1.riskPaidOff).toBeUndefined();
    expect(t12({ scoreBefore: -0.75 }).p1.riskPaidOff).toBeUndefined();
    // A Close Combat that kept the safe line's floor gave nothing up: no read to credit, whatever its regret.
    const noFloor = t12({}, 0.173);
    expect(noFloor.p1.riskPaidOff).toBeUndefined();
  });
});
