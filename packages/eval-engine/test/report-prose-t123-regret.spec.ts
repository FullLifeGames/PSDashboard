import { test, expect, describe } from 'vitest';
import type { SideAnalysis, TurnAnalysis } from '../src/analysis';
import { buildGameReport } from '../src/report';
import { seedPhrase } from '../src/win-reason';
import type { RankedChoice } from '../src/types';

/**
 * Round 64 (T123 point 8, decision 22): regret is best ev minus played ev on
 * the score scale [−1, 1], so it reaches 2. Above 1 the played pair turned a
 * board the engine's line held into one it loses, and the linear points
 * ("−84%") claim more than the two win chances the card shows (85% and 19%,
 * 2630685175 t8). Such a regret reads as those two chances.
 */

const choice = (choiceStr: string, label: string, ev: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase: ev, expected: ev, ev });

const side = (fields: Partial<SideAnalysis>): SideAnalysis =>
  ({ playedRaw: null, played: null, best: null, safe: null, regret: null, ...fields });

const turn = (n: number, p2: SideAnalysis, score: number): TurnAnalysis => ({
  turn: n, scoreBefore: score, scoreAfter: score, swing: 0, playedOutcome: score, decisionDelta: 0, chanceDelta: 0,
  attribution: 'p2-decision', p1: side({}), p2,
});

// 2630685175 t8: Taunt + Body Press (−0.767) against Astral Barrage + Body Press (+0.920), regret 1.687.
const doublesThrow = side({
  played: choice('move taunt 1, move bodypress 2', 'Taunt→Calyrex-Ice + Body Press→Terapagos-Stellar', -0.767),
  best: choice('move astralbarrage, move bodypress 1', 'Astral Barrage + Body Press→Calyrex-Ice', 0.92),
  regret: 1.687, tier: 'mistake',
});
const singlesMistake = side({
  played: choice('move stoneedge', 'Stone Edge', 0.1), best: choice('move earthquake', 'Earthquake', 0.4), regret: 0.3, tier: 'mistake',
});

describe('point 8: a regret over 1 reads as the two win chances it spans', () => {
  test('the seed phrase (doubles, 2630685175 t8): "85% to 19%", no points, no dash', () => {
    const seed = seedPhrase(turn(8, doublesThrow, 0.9), 'p2');
    expect(seed).toBe('turn 8 (Taunt→Calyrex-Ice + Body Press→Terapagos-Stellar, 85% to 19%; safer was Astral Barrage + Body Press→Calyrex-Ice)');
  });

  test('singles: a regret under 1 keeps its points, the frame without the dash', () => {
    expect(seedPhrase(turn(5, singlesMistake, 0.1), 'p2')).toBe('turn 5 (Stone Edge, −15%; safer was Earthquake)');
  });

  test('the report misplay carries the span only above 1', () => {
    const report = buildGameReport([turn(1, singlesMistake, 0.1), turn(2, doublesThrow, 0.9), turn(3, side({}), 0.9)], ['Alpha', 'Beta'], 'p1');
    const byTurn = new Map(report.misplays.map(misplay => [misplay.turn, misplay]));
    expect(byTurn.get(2)?.span).toEqual({ from: 0.92, to: -0.767 });
    expect(byTurn.get(1)).not.toHaveProperty('span');
  });
});
