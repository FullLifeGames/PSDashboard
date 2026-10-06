import { test, expect, describe } from 'vitest';
import type { SideAnalysis } from '../src/analysis';
import { inaccuracyClause, readCreditClause, sackClause, sideClause } from '../src/prose/clauses';
import type { RankedChoice } from '../src/types';

/**
 * Round 64 (T123 point 6, doubles only: singles has no hidden partner). A
 * slot never seen (flinch, sleep) makes the matched pair the best one the
 * visible slot allows; the verdict clause said so, the read credit and the
 * inaccuracy did not.
 */

const choice = (choiceStr: string, label: string, ev: number, worstCase = ev): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: ev, ev, punishedBy: 'Reply' });

const side = (fields: Partial<SideAnalysis>): SideAnalysis =>
  ({ playedRaw: null, played: null, best: null, safe: null, regret: null, ...fields });

const quiet = side({});

describe('point 6: every clause on a partial side names the hidden slot', () => {
  test('the read credit (2629703929 t1 shape) says it credits the visible slot', () => {
    const played = choice('move tailwind, move solarbeam 1', 'Tailwind + Solar Beam→Groudon', 0.4, -0.2);
    const safe = choice('move tailwind terastallize, move solarbeam 1', 'Tera + Tailwind + Solar Beam→Groudon', 0.3, -0.1);
    const credit = { played, best: safe, safe, regret: 0.05, readCredit: { payoff: 0.6 } };
    expect(readCreditClause('Alpha', side({ ...credit, playedPartial: true }), null))
      .toMatch(/\(Partner's action hidden; credited on the visible slot\.\)$/);
    expect(readCreditClause('Alpha', side(credit), null)).not.toContain('hidden');
  });

  test('the inaccuracy (2630685175 t5 shape) and the verdict clause say they grade the visible slot, without a dash', () => {
    const played = choice('move protect, move bodypress 1', 'Protect + Body Press→Calyrex-Ice', 0.1);
    const best = choice('move astralbarrage, move bodypress 1', 'Astral Barrage + Body Press→Calyrex-Ice', 0.25);
    expect(inaccuracyClause('Alpha', side({ played, best, safe: best, regret: 0.15, tier: 'inaccuracy', playedPartial: true })))
      .toMatch(/\(Partner's action hidden; graded on the visible slot\.\)$/);
    expect(sideClause('Alpha', side({ played, best, safe: best, regret: 0.25, tier: 'mistake', playedPartial: true }), quiet))
      .toMatch(/\(Partner's action hidden; graded on the visible slot\.\)$/);
  });

  test('guard: the sack clause stays without the note (the hidden slot is the fed body itself)', () => {
    const sack = sackClause('Alpha', side({ playedPartial: true, sacrifice: { name: 'TeraTurtle', hpFraction: 0.5, stayed: true, verified: true } }));
    expect(sack).not.toContain('hidden');
  });
});
