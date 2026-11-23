import { describe, expect, test } from 'vitest';
import type { EvalLine, EvalResult, PlayedTurn, TurnAnalysis } from '@fulllifegames/eval-engine';
import { earlyLineJobs, earlyLineProgress, earlyLineSettings, LINE_PASS } from '../../../../src/components/eval/early-lines';
import type { TurnEvalSettings } from '../../../../src/hooks/useEvaluation';
import { misplayedSide, turnAnalysis } from '../../fixtures/analysis';
import { evalResult } from '../../fixtures/eval-result';
import { singlesLine } from '../../fixtures/lines';

/**
 * Which graded singles turns the game analysis searches once more with the trees, and what that search is told. The rule is the report's
 * own graded rule (`gradedSides`). The stage covers every graded turn in Auto, singles and doubles, and asks the search for the line pass
 * (`LINE_PASS` extra iterations per tree); a result is done when it carries the pass (`linePass`), not when it holds lines, since a tree turn
 * holds lines from the sweep already.
 */
const MATRIX: TurnEvalSettings = { depth: 1, samples: 3, mode: 'matrix' };
const TREE: TurnEvalSettings = { depth: 1, samples: 1, mode: 'mcts' };
const matrixResult = (overrides: Partial<EvalResult> = {}): EvalResult => evalResult('singles', overrides);
const played: PlayedTurn = { p1: { kind: 'move', name: 'Stone Edge' }, p2: { kind: 'move', name: 'Leech Seed' } };

/** Turns 3 and 7 graded on matrix results, turn 5 not graded, turn 12 graded on a tree result. */
function game() {
  const analyses: (TurnAnalysis | null)[] = Array.from({ length: 12 }, () => null);
  analyses[2] = turnAnalysis(3, { p1: misplayedSide('mistake') });
  analyses[4] = turnAnalysis(5);
  analyses[6] = turnAnalysis(7, { p1: misplayedSide('blunder'), p2: misplayedSide('inaccuracy') });
  analyses[11] = turnAnalysis(12, { p1: misplayedSide('mistake') });
  const results: (EvalResult | null)[] = analyses.map(() => null);
  const settings: (TurnEvalSettings | null)[] = analyses.map(() => null);
  for (const turn of [3, 5, 7]) { results[turn - 1] = matrixResult(); settings[turn - 1] = MATRIX; }
  results[11] = matrixResult({ matrix: { ...matrixResult().matrix!, cells: [] } });
  settings[11] = TREE;
  const playedTurns = analyses.map(() => played);
  return { analyses, results, settings, playedTurns };
}

describe('earlyLineJobs: the graded turns whose lines have not had the pass yet', () => {
  test('every graded turn, matrix or tree, in turn order: 3, 7 and 12; 5 is not graded', () => {
    const { analyses, results, settings } = game();
    expect(earlyLineJobs({ analyses, results, settings }).map(job => job.turn)).toEqual([3, 7, 12]);
  });

  test('a result that carries the pass, even with an empty list of lines, is not searched again', () => {
    const { analyses, results, settings } = game();
    results[2] = matrixResult({ lines: [singlesLine as EvalLine], linePass: LINE_PASS });
    results[6] = matrixResult({ lines: [], linePass: LINE_PASS });
    results[11] = matrixResult({ lines: [], linePass: LINE_PASS });
    expect(earlyLineJobs({ analyses, results, settings })).toEqual([]);
  });

  test('lines the sweep or an earlier stage made, without the pass, are searched again (a tree turn holds lines from the sweep)', () => {
    const { analyses, results, settings } = game();
    results[2] = matrixResult({ lines: [singlesLine as EvalLine] });
    results[11] = matrixResult({ lines: [singlesLine as EvalLine], linePass: LINE_PASS - 1 });
    results[6] = matrixResult({ lines: [], linePass: LINE_PASS });
    expect(earlyLineJobs({ analyses, results, settings }).map(job => job.turn)).toEqual([3, 12]);
  });

  test('a doubles game: every turn is a tree turn, and the graded ones are jobs', () => {
    const { analyses, results } = game();
    const doubles = results.map(result => result && evalResult('doubles', { lines: [singlesLine as EvalLine] }));
    const settings: (TurnEvalSettings | null)[] = results.map(result => (result ? TREE : null));
    expect(earlyLineJobs({ analyses, results: doubles, settings }).map(job => job.turn)).toEqual([3, 7, 12]);
  });

  test('a turn another engine evaluated, a gap and a turn without a stored result are left out', () => {
    const { analyses, results, settings } = game();
    results[2] = matrixResult({ engine: { name: 'Foul Play' } as EvalResult['engine'] });
    results[6] = null;
    results[11] = null;
    expect(earlyLineJobs({ analyses, results, settings })).toEqual([]);
  });

  test('no report yet, no jobs', () => {
    expect(earlyLineJobs({ analyses: null, results: [], settings: [] })).toEqual([]);
  });
});

describe('earlyLineSettings: the tree search that only keeps lines', () => {
  const { analyses, results, settings, playedTurns } = game();
  const job = earlyLineJobs({ analyses, results, settings }).find(entry => entry.turn === 7)!;
  const asked = earlyLineSettings(job, { tera: false, sleepClause: true, ruleset: 'standard', keepPlayed: playedTurns[6] });

  test('a depth-1 tree search with the played pair kept and the report\'s Tera, Sleep Clause and rule set', () => {
    expect(asked).toMatchObject({ mode: 'mcts', depth: 1, samples: 1, tera: false, sleepClause: true, ruleset: 'standard', keepPlayed: played });
  });

  test('it asks for the line pass: 300 extra iterations per tree, the user\'s quota', () => {
    expect(LINE_PASS).toBe(300);
    expect(asked.linePass).toBe(300);
  });

  test('each side\'s lines come from the card\'s engine row and meet the answer the card ranks first', () => {
    // turn 7: p1 and p2 both misplayed; the fixtures' best rows are Earthquake (p1) and Earthquake again (misplayedSide)
    expect(asked.lineRows).toEqual({ p1: ['Earthquake'], p2: ['Earthquake'] });
    expect(asked.lineReplies).toEqual({ p1: ['Earthquake'], p2: ['Earthquake'] });
  });

  test('a turn without a kept played pair leaves keepPlayed out', () => {
    expect(earlyLineSettings(job, { tera: false, ruleset: 'standard' })).not.toHaveProperty('keepPlayed');
  });
});

describe('earlyLineProgress: how many of the graded turns have had the pass', () => {
  test('three of three pending, then one done', () => {
    const { analyses, results, settings } = game();
    expect(earlyLineProgress({ analyses, results, settings })).toEqual({ done: 0, total: 3 });
    results[2] = matrixResult({ lines: [singlesLine as EvalLine], linePass: LINE_PASS });
    expect(earlyLineProgress({ analyses, results, settings })).toEqual({ done: 1, total: 3 });
  });
});
