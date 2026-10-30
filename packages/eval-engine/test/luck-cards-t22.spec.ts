import { test, expect, describe } from 'vitest';
import type { SideAnalysis, TurnAnalysis } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import type { KoOddsInfo, RankedChoice } from '../src/types';

/**
 * Round 67 (T22 stage a): on the turn card a swing reads as luck only with a
 * roll in its direction (rolledFor, turn-analysis/luck.ts); without one the
 * card names it as the engine re-reading the position. Without the turn's
 * dice (no rolledFor) every sentence keeps its old wording.
 */

const ranked = (choice: string, label: string, ev: number, koOdds?: KoOddsInfo): RankedChoice =>
  ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: null, ...(koOdds ? { koOdds } : {}) });

const playing = (played: RankedChoice | null): SideAnalysis =>
  ({ playedRaw: null, played, best: played, safe: played, regret: 0 });

const quiet = playing(null);

/** A hand-built turn for the card sentences: the deltas, the attribution, the sides and (optionally) the turn's rolls. */
const turnWith = (over: Partial<TurnAnalysis>): TurnAnalysis => ({
  turn: 12, scoreBefore: 0, scoreAfter: 0.24, swing: 0.24, playedOutcome: 0, decisionDelta: 0, chanceDelta: 0.24,
  attribution: 'chance', p1: quiet, p2: quiet, playedTracking: true, ...over,
});

const names: [string, string] = ['BKC', 'devin'];

describe('T22 cards: a swing without a roll in its direction is an estimate that moved with no roll behind it', () => {
  test('singles chance card (649664 t12 shape): no roll toward BKC, so no "how the turn rolled"', () => {
    const reRead = summarizeTurn(turnWith({ rolledFor: { p1: false, p2: false } }), names);
    expect(reRead).toContain('the estimate moved +12% with no roll behind it');
    expect(reRead).not.toContain('how the turn rolled');
    expect(summarizeTurn(turnWith({ rolledFor: { p1: true, p2: false } }), names)).toContain('how the turn rolled (+12%)');
    // A roll the other way does not explain a swing toward BKC.
    expect(summarizeTurn(turnWith({ rolledFor: { p1: false, p2: true } }), names)).not.toContain('how the turn rolled');
    // Without the turn's dice the card keeps its old wording.
    expect(summarizeTurn(turnWith({}), names)).toContain('how the turn rolled (+12%)');
  });

  test('doubles chance card (2663093831 t2 shape): the same rule', () => {
    const pair = playing(ranked('move heatwave, move protect', 'Heat Wave + Protect', 0.1));
    const reRead = summarizeTurn(turnWith({ p1: pair, p2: pair, chanceDelta: -0.4, swing: -0.4, scoreAfter: -0.4, rolledFor: { p1: true, p2: false } }), names);
    expect(reRead).toContain('the estimate moved −20% with no roll behind it');
    expect(reRead).not.toContain('how the turn rolled');
  });

  test('a decision turn\'s luck rider names the unrolled move when no roll went that way', () => {
    const mistake: SideAnalysis = {
      ...playing(ranked('move bulkup', 'Bulk Up', -0.1)), best: ranked('move drainpunch', 'Drain Punch', 0.25), regret: 0.35, tier: 'mistake',
    };
    const turn = (rolledFor: { p1: boolean; p2: boolean }) =>
      turnWith({ attribution: 'p1-decision', p1: mistake, chanceDelta: -0.3, swing: -0.4, scoreAfter: -0.4, rolledFor });
    expect(summarizeTurn(turn({ p1: false, p2: false }), names)).toContain('On top of that, the estimate moved −15% with no roll behind it.');
    expect(summarizeTurn(turn({ p1: false, p2: false }), names)).not.toContain('luck contributed');
    expect(summarizeTurn(turn({ p1: false, p2: true }), names)).toContain('On top of that, luck contributed −15%.');
  });

  test('a read credit\'s luck rider follows the same rule (653785 t25 shape)', () => {
    const credit: SideAnalysis = {
      ...playing(ranked('switch 4', '→ Cofagrigus', 0.2)), safe: ranked('switch 3', '→ Volcanion', 0.1),
      readCredit: { payoff: 0.31 },
    };
    // The side holds its ground (−0.05): a credit on a lost turn stays silent (T59).
    const turn = (rolledFor: { p1: boolean; p2: boolean }) =>
      turnWith({ attribution: 'quiet', p1: credit, chanceDelta: -0.15, swing: -0.05, scoreAfter: -0.05, rolledFor });
    expect(summarizeTurn(turn({ p1: false, p2: false }), names)).toContain('On top of that, the estimate moved −8% for BKC with no roll behind it.');
    expect(summarizeTurn(turn({ p1: false, p2: true }), names)).toContain('On top of that, luck contributed −8% for BKC.');
  });

  test('a shift names the unrolled part in its split', () => {
    const shift = (rolledFor: { p1: boolean; p2: boolean }) => turnWith({
      attribution: 'shift', p1: playing(ranked('move uturn', 'U-turn', 0.1)), p2: playing(ranked('move pursuit', 'Pursuit', -0.1)),
      decisionDelta: 0.23, chanceDelta: 0.12, swing: 0.35, scoreAfter: 0.35, rolledFor,
    });
    expect(summarizeTurn(shift({ p1: false, p2: false }), names)).toContain('(+12% expected, +6% with no roll behind it)');
    expect(summarizeTurn(shift({ p1: true, p2: false }), names)).toContain('(+12% expected, +6% from the rolls)');
  });
});
