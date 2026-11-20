import { describe, expect, test } from 'vitest';
import type { TurnAnalysis } from '../src/analysis';
import { buildGameReport } from '../src/report';
import { seedPhrase } from '../src/win-reason';

const PHANTOM = 'stayed in (KO’d before acting)';
const WORDS = 'knocked out before it moved, so the log shows no choice';

/** The Game report (issue 162): the misplay row and the seed sentence say what happened, in the same words as the card. */
describe('the game report on a side that never acted (singles)', () => {
  const choice = (id: string, label: string, ev: number) => ({ choice: id, label, worstCase: ev, expected: ev, ev });
  const side = (fields: Partial<TurnAnalysis['p1']>): TurnAnalysis['p1'] => ({ playedRaw: null, played: null, best: null, safe: null, regret: null, ...fields });
  const stayIn = choice('move toxic', PHANTOM, -0.8);
  const best = choice('switch 3', '→ Landorus-Therian', -0.3);
  const idle = side({ played: stayIn, best, regret: 0.5, tier: 'blunder', neverActed: true, faintedFraction: 0.25 });
  const moved = side({ played: choice('move stoneedge', 'Stone Edge', -0.8), best, regret: 0.5, tier: 'blunder' });
  const turn = (n: number, p2: TurnAnalysis['p2']): TurnAnalysis => ({
    turn: n, scoreBefore: 0.2, scoreAfter: 0.2, swing: 0, playedOutcome: 0.2, decisionDelta: 0, chanceDelta: 0,
    attribution: 'p2-decision', p1: side({}), p2,
  });

  test('GameReport.misplays carries the flag and the stand-in chance for a never-acted side, and not for an acted one', () => {
    const report = buildGameReport([turn(1, idle), turn(2, moved)], ['Alpha', 'Beta'], 'p1');
    const byTurn = new Map(report.misplays.map(misplay => [misplay.turn, misplay]));
    expect(byTurn.get(1)?.neverActed).toEqual({ ev: -0.8, faintedFraction: 0.25 });
    expect(byTurn.get(2)).not.toHaveProperty('neverActed');
  });

  test('the seed sentence of the loss names the knockout in the row\'s words, not the label', () => {
    const seed = seedPhrase(turn(1, idle), 'p2');
    expect(seed).toContain(WORDS);
    expect(seed).not.toContain('stayed in');
    expect(seedPhrase(turn(2, moved), 'p2')).toContain('Stone Edge');
  });
});
