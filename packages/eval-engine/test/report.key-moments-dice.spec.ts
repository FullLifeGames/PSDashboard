import { test, expect, describe } from 'vitest';
import type { SideAnalysis } from '../src/analysis';
import { buildGameReport } from '../src/report';
import { seedPhrase } from '../src/win-reason';
import { analyzeTurn, type TurnAnalysis } from '../src/analysis';
import { forcedQualifier } from '../src/prose/phrases';
import { summarizeTurn } from '../src/summary';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * The report keeps its four biggest key moments and adds every dice turn that qualifies (score at least 0.25, not quiet, not a resolution
 * turn) whose chance went against the winner. 573756 turn 73: a 95 % Fire Fang missed, the turn ranked eighth of eight and the luck that
 * turned the game was not on the list. The report is game-type blind, so the doubles rows repeat the singles rows with the pair sides of a
 * doubles analysis.
 */

const names: [string, string] = ['Alpha', 'Beta'];

const single = (): SideAnalysis => ({ playedRaw: null, played: null, best: null, safe: null, regret: 0 });
const doublesSide = (): SideAnalysis => ({
  ...single(), playedSlots: [{ kind: 'move', name: 'Heat Wave', targetLoc: null }, { kind: 'move', name: 'Protect', targetLoc: null }],
});

type Kind = 'singles' | 'doubles';
const kinds: Kind[] = ['singles', 'doubles'];

const decision = (kind: Kind, turn: number, size: number): TurnAnalysis => {
  const side = kind === 'singles' ? single : doublesSide;
  return {
    turn, scoreBefore: 0.9, scoreAfter: 0.9 - size, swing: -size, playedOutcome: null, decisionDelta: -size,
    chanceDelta: null, attribution: 'p2-decision', p1: side(), p2: side(),
  };
};

const dice = (kind: Kind, turn: number, chance: number, over: Partial<TurnAnalysis> = {}): TurnAnalysis => {
  const side = kind === 'singles' ? single : doublesSide;
  return {
    turn, scoreBefore: 0.9, scoreAfter: 0.9 + chance, swing: chance, playedOutcome: null, decisionDelta: 0,
    chanceDelta: chance, attribution: 'chance', p1: side(), p2: side(), ...over,
  };
};

/** Four decision turns at 0.6 to 0.45 fill the cap; a fifth, smaller decision turn is rank 5. */
const pool = (kind: Kind, extra: TurnAnalysis[]): TurnAnalysis[] => [
  decision(kind, 1, 0.6), decision(kind, 2, 0.55), decision(kind, 3, 0.5), decision(kind, 4, 0.45),
  ...extra,
];

const turnsOf = (analyses: TurnAnalysis[], diceTurns: ReadonlySet<number> | null, winner: 'p1' | 'p2' | null = 'p2') =>
  buildGameReport(analyses, names, winner, true, diceTurns).keyMoments.map(moment => moment.turn);

describe.each(kinds)('T264 key moments, %s', kind => {
  test('a dice turn at rank 6 whose chance went against the winner joins, in turn order', () => {
    const analyses = pool(kind, [decision(kind, 5, 0.3), dice(kind, 6, 0.27)]);
    expect(turnsOf(analyses, new Set([6]))).toEqual([1, 2, 3, 4, 6]);
  });

  test('a non-dice turn at rank 5 does not join', () => {
    const analyses = pool(kind, [decision(kind, 5, 0.3), dice(kind, 6, 0.27)]);
    expect(turnsOf(analyses, new Set())).toEqual([1, 2, 3, 4]);
  });

  test('a dice turn whose chance went toward the winner does not join', () => {
    // Early in the game, so the favor boundary leaves it a genuine roll and not a resolution turn.
    const analyses = [dice(kind, 1, -0.27), ...pool(kind, []).map(entry => ({ ...entry, turn: entry.turn + 1 }))];
    expect(turnsOf(analyses, new Set([1]))).toEqual([2, 3, 4, 5]);
  });

  test('a dice turn under the key-moment threshold does not join', () => {
    expect(turnsOf(pool(kind, [dice(kind, 5, 0.2)]), new Set([5]))).toEqual([1, 2, 3, 4]);
  });

  test('a quiet dice turn does not join', () => {
    expect(turnsOf(pool(kind, [dice(kind, 5, 0.3, { attribution: 'quiet' })]), new Set([5]))).toEqual([1, 2, 3, 4]);
  });

  test('a dice turn already in the top four is listed once', () => {
    const analyses = [dice(kind, 1, 0.7), ...pool(kind, []).map(entry => ({ ...entry, turn: entry.turn + 1 }))];
    expect(turnsOf(analyses, new Set([1]))).toEqual([1, 2, 3, 4]);
  });

  test('without dice info or without a winner nothing joins', () => {
    const analyses = pool(kind, [dice(kind, 5, 0.27)]);
    expect(turnsOf(analyses, null)).toEqual([1, 2, 3, 4]);
    expect(turnsOf(analyses, new Set([5]), null)).toEqual([1, 2, 3, 4]);
  });

  test('the turn\'s own rolls decide when the report carries them', () => {
    const rolled = pool(kind, [dice(kind, 5, 0.27, { rolledFor: { p1: true, p2: false } })]);
    const reRead = pool(kind, [dice(kind, 5, 0.27, { rolledFor: { p1: false, p2: false } })]);
    expect(turnsOf(rolled, new Set())).toEqual([1, 2, 3, 4, 5]);
    expect(turnsOf(reRead, new Set([5]))).toEqual([1, 2, 3, 4]);
  });

  test('a winner of p1 mirrors the rule', () => {
    const mirrored = (entry: TurnAnalysis): TurnAnalysis => ({
      ...entry, scoreBefore: -entry.scoreBefore, scoreAfter: entry.scoreAfter === null ? null : -entry.scoreAfter,
      swing: entry.swing === null ? null : -entry.swing, chanceDelta: entry.chanceDelta === null ? null : -entry.chanceDelta,
    });
    const analyses = pool(kind, [decision(kind, 5, 0.3), dice(kind, 6, 0.27)]).map(mirrored);
    expect(turnsOf(analyses, new Set([6]), 'p1')).toEqual([1, 2, 3, 4, 6]);
  });
});

const PHANTOM = 'stayed in (KO’d before acting)';
const WORDS = 'knocked out before it moved, so the log shows no choice';

/** The Game report: the misplay row and the seed sentence say what happened, in the same words as the card. */
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

type Forced = NonNullable<TurnAnalysis['p2']['forcedWin']>;

const mk = (turn: number, scoreBefore: number, scoreAfter: number | null, forcedWin?: Forced): TurnAnalysis => ({
  turn, scoreBefore, scoreAfter,
  swing: scoreAfter !== null ? scoreAfter - scoreBefore : null,
  playedOutcome: null, decisionDelta: null, chanceDelta: null, attribution: 'quiet',
  p1: { playedRaw: null, played: null, best: null, safe: null, regret: 0 },
  p2: { playedRaw: null, played: null, best: null, safe: null, regret: 0, ...(forcedWin ? { forcedWin } : {}) },
});

const reportSentence = (forced: Forced): string => {
  const report = buildGameReport([mk(1, 0.05, -0.9), mk(2, -0.9, -0.95, forced), mk(3, -0.95, -1)], names, 'p2');
  return report.summary;
};

const ROWS: { mass: number; caveat: Forced['caveat']; ends: string | null }[] = [
  { mass: 1, caveat: 'none', ends: 'every reply lost within 3 turns.' },
  { mass: 1, caveat: 'barring-crit', ends: 'every reply lost within 3 turns, barring a crit.' },
  { mass: 0.98, caveat: 'none', ends: 'every reply lost within 3 turns in 98% of the rolls.' },
  { mass: 0.98, caveat: 'sampled-rolls', ends: 'every reply lost within 3 turns in 98% of the sampled rolls.' },
  { mass: 0.98, caveat: 'barring-crit', ends: 'every reply lost within 3 turns in 98% of the rolls, barring a crit.' },
  { mass: 0.9, caveat: 'none', ends: 'every reply lost within 3 turns in 90% of the rolls.' },
  { mass: 0.996, caveat: 'none', ends: 'every reply lost within 3 turns in 99% of the rolls.' },
  // Under the spoken mass the report names no forced conversion at all.
  { mass: 0.67, caveat: 'none', ends: null },
];

describe('the game report names the share of a proof below mass 1', () => {
  test.each(ROWS)('mass $mass, caveat $caveat', ({ mass, caveat, ends }) => {
    const summary = reportSentence({ turns: 3, mass, caveat, announce: true });
    if (ends === null) {
      expect(summary).not.toContain('forced');
      return;
    }
    expect(summary).toContain(`From turn 2 the win was forced: ${ends}`);
  });

  test('the report and the card say the share in the same words (the one helper)', () => {
    for (const { mass, caveat } of ROWS.filter(row => row.ends !== null)) {
      const qualifier = forcedQualifier({ mass, caveat });
      expect(reportSentence({ turns: 3, mass, caveat, announce: true })).toContain(`within 3 turns${qualifier}.`);
      const choice = (label: string, worstCase: number): RankedChoice =>
        ({ choice: `move ${label}`, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });
      const result: EvalResult = {
        score: -1, interval: 0, depthCompleted: 1,
        perSide: { p1: [choice('Roost', -0.9)], p2: [choice('Fire Fang', 0.9)] },
        unanswered: { p1: [], p2: [] },
        forcedWin: { side: 'p2', turns: 3, mass, caveat, engineScore: -0.5, states: 12 },
      };
      const card = summarizeTurn(analyzeTurn({
        turn: 8, result, played: null, playedOutcome: null, scoreBefore: -1, scoreAfter: null, playedTracking: false,
      }), names);
      expect(card).toContain(`Beta wins within 3 turns against every reply${qualifier}.`);
    }
  });

  test('the helper is empty at mass 1 without a caveat and names no more than the share below it', () => {
    expect(forcedQualifier({ mass: 1, caveat: 'none' })).toBe('');
    expect(forcedQualifier({ mass: 1, caveat: 'sampled-rolls' })).toBe(' on the sampled rolls');
    expect(forcedQualifier({ mass: 0.5, caveat: 'none' })).toBe(' in 50% of the rolls');
  });
});

const choice = (choiceStr: string, label: string, ev: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase: ev, expected: ev, ev });

const side = (fields: Partial<SideAnalysis>): SideAnalysis =>
  ({ playedRaw: null, played: null, best: null, safe: null, regret: null, ...fields });

const turn = (n: number, p2: SideAnalysis, score: number): TurnAnalysis => ({
  turn: n, scoreBefore: score, scoreAfter: score, swing: 0, playedOutcome: score, decisionDelta: 0, chanceDelta: 0,
  attribution: 'p2-decision', p1: side({}), p2,
});

// 2630685175 turn 8: Taunt + Body Press (−0.767) against Astral Barrage + Body Press (+0.920), regret 1.687.
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
