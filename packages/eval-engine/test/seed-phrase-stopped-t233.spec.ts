import { describe, expect, test } from 'vitest';
import type { SideAnalysis, TurnAnalysis } from '../src/analysis';
import { seedPhrase } from '../src/win-reason';
import type { KoOddsInfo, RankedChoice } from '../src/types';

/**
 * Round 76 (T233): the game report's seed of a loss quoted the played line's KO odds even when the opponent's click stopped
 * the hit (round 70, 4a: the turn card already drops such a claim, `hitStopped.played`). A seed reads "turn 7 (Tera Starstorm
 * (kills ~4% of the time), ...)" for a Tera Starstorm that Wide Guard turned away. The same reading now gates the report.
 * The seed is game-type blind; the doubles row carries the pair label and the attacker's slot.
 */

const ranked = (choice: string, label: string, ev: number, koOdds?: KoOddsInfo): RankedChoice =>
  ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: null, ...(koOdds ? { koOdds } : {}) });

const side = (fields: Partial<SideAnalysis>): SideAnalysis =>
  ({ playedRaw: null, played: null, best: null, safe: null, regret: null, ...fields });

const turnOf = (loser: SideAnalysis): TurnAnalysis => ({
  turn: 7, scoreBefore: 0, scoreAfter: -0.3, swing: -0.3, playedOutcome: -0.2, decisionDelta: -0.2, chanceDelta: -0.1,
  attribution: 'p1-decision', p1: loser, p2: side({}),
});

const SCENES: [string, RankedChoice, RankedChoice][] = [
  ['singles', ranked('move closecombat', 'Close Combat', -0.1, { accuracy: 0.9, killFraction: 0.5 }), ranked('move protect', 'Protect', 0.3)],
  ['doubles', ranked('move terastarstorm 1, move protect', 'Tera Starstorm→Calyrex-Shadow + Protect', -0.1,
    { accuracy: 0.95, killFraction: 0.04, label: 'Tera Starstorm→Calyrex-Shadow', attacker: { slot: 0, species: 'Terapagos' } }),
  ranked('move protect, move protect', 'Protect + Protect', 0.3)],
];

describe.each(SCENES)('%s: the seed of a loss and the played line\'s KO odds', (_name, played, best) => {
  const loser = (extra: Partial<SideAnalysis> = {}) => side({ played, best, regret: 0.4, tier: 'mistake', ...extra });

  test('the odds are quoted while the hit stood', () => {
    expect(seedPhrase(turnOf(loser()), 'p1')).toMatch(/roll into a ~\d+% kill range|kills ~\d+% of the time/);
  });

  test('the odds stay out when the click stopped the hit (red before: the seed quoted a roll that did not happen)', () => {
    const open = seedPhrase(turnOf(loser()), 'p1');
    const stopped = seedPhrase(turnOf(loser({ hitStopped: { played: true } })), 'p1');
    expect(stopped).not.toBe(open);
    expect(stopped).not.toMatch(/roll into|kills ~|of the time/);
    expect(stopped.startsWith('turn 7 (')).toBe(true);
    // The recommendation's claim does not enter the seed.
    expect(seedPhrase(turnOf(loser({ hitStopped: { best: true } })), 'p1')).toBe(open);
  });
});
