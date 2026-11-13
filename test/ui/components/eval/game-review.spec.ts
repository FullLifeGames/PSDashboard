import { describe, expect, test } from 'vitest';
import { winDeltaText, winPctText, type EvalLine, type EvalResult, type SideAnalysis, type TurnAnalysis } from '@fulllifegames/eval-engine';
import { gameReview, gradedTier, reviewMarks } from '../../../../src/components/eval/game-review';
import type { LinesHost } from '../../../../src/lib/line-view';
import { misplayedSide, sideAnalysis, turnAnalysis } from '../../fixtures/analysis';
import { evalResult, rankedChoice } from '../../fixtures/eval-result';
import { bothRolesLine, doublesLine, DOUBLES_NAMES, playedLine, singlesLine, SINGLES_NAMES } from '../../fixtures/lines';

/** Round 89 (#104), step G4, ruling 33 (4a): the Game review lists the graded turns only, as the turn cards grade them. */
const host: LinesHost = { rules: { gen: 9, mod: undefined } };
const withLines = (lines?: EvalLine[]): EvalResult => ({ ...evalResult('singles'), ...(lines ? { lines } : {}) });

/** A side that played Hyper Voice where the engine's best was Hydro Pump (the labels of the line fixtures). */
const gradedP2 = (tier: 'inaccuracy' | 'mistake' | 'blunder', overrides: Partial<SideAnalysis> = {}): SideAnalysis => {
  const best = rankedChoice('move 1', 'Hydro Pump', 0.1);
  const played = rankedChoice('move 2', 'Hyper Voice', -0.24 + (tier === 'inaccuracy' ? 0.3 : 0));
  return { playedRaw: { kind: 'move', name: 'Hyper Voice' }, played, best, safe: best, regret: Math.round((best.ev - played.ev) * 100) / 100, tier, ...overrides };
};

describe('gradedTier: the turn card\'s own reading of "graded"', () => {
  test('inaccuracy, mistake and blunder are graded; a clean side is not', () => {
    expect(gradedTier(gradedP2('inaccuracy'))).toBe('inaccuracy');
    expect(gradedTier(gradedP2('mistake'))).toBe('mistake');
    expect(gradedTier(gradedP2('blunder'))).toBe('blunder');
    expect(gradedTier(sideAnalysis())).toBeNull();
  });

  test('a sack and a read that paid off are shown on the card in place of the regret chip, so they are not graded', () => {
    expect(gradedTier(gradedP2('mistake', { sacrifice: { name: 'Kingambit', hpFraction: 0.1, healthy: false } as SideAnalysis['sacrifice'] }))).toBeNull();
    expect(gradedTier(gradedP2('blunder', { riskPaidOff: true }))).toBeNull();
    // an inaccuracy keeps its chip beside the sack, as the card shows it
    expect(gradedTier(gradedP2('inaccuracy', { riskPaidOff: true }))).toBe('inaccuracy');
  });

  test('a side without a played or an engine row has nothing to compare', () => {
    expect(gradedTier(gradedP2('mistake', { played: null }))).toBeNull();
    expect(gradedTier(gradedP2('mistake', { best: null as unknown as SideAnalysis['best'] }))).toBeNull();
  });
});

describe('reviewMarks: the graph marks follow the list', () => {
  test('one mark per graded side and turn: P1 first, a turn graded on both sides gets both', () => {
    const analyses: (TurnAnalysis | null)[] = [
      turnAnalysis(1), null,
      turnAnalysis(3, { p1: misplayedSide('mistake') }),
      turnAnalysis(4, { p1: misplayedSide('blunder'), p2: gradedP2('inaccuracy') }),
      turnAnalysis(5, { p2: gradedP2('mistake') }),
      turnAnalysis(6, { p2: gradedP2('mistake'), playedTracking: false }),
    ];
    expect(reviewMarks(analyses)).toEqual([
      { turn: 3, side: 'p1' }, { turn: 4, side: 'p1' }, { turn: 4, side: 'p2' }, { turn: 5, side: 'p2' },
    ]);
  });

  test('no analyses, no marks', () => {
    expect(reviewMarks(null)).toEqual([]);
    expect(reviewMarks([])).toEqual([]);
  });
});

describe('gameReview, singles', () => {
  const analyses: (TurnAnalysis | null)[] = Array.from({ length: 22 }, () => null);
  analyses[19] = turnAnalysis(20, { p2: gradedP2('inaccuracy') });
  analyses[20] = turnAnalysis(21, { p1: misplayedSide('mistake'), p2: gradedP2('blunder') });
  analyses[21] = turnAnalysis(22);
  const results: (EvalResult | null)[] = analyses.map(() => null);
  results[19] = withLines([bothRolesLine, singlesLine, playedLine]);
  results[20] = withLines();

  const view = gameReview({ analyses, results, playerNames: SINGLES_NAMES, doubles: false, host });

  test('one list per player, player 1 first, the graded turns in turn order', () => {
    expect(view.map(side => side.side)).toEqual(['p1', 'p2']);
    expect(view.map(side => side.player)).toEqual(['Tzon', 'Pepitopalotin']);
    expect(view[0].rows.map(row => row.turn)).toEqual([21]);
    expect(view[1].rows.map(row => row.turn)).toEqual([20, 21]);
  });

  test('a row reads as the turn card does: played and engine value, the grade, the loss', () => {
    const row = view[1].rows[0];
    expect(row.grade).toBe('inaccuracy');
    expect(row.played).toBe(`Hyper Voice ${winPctText(0.06)}`);
    expect(row.engine).toBe(`Hydro Pump ${winPctText(0.1)}`);
    expect(row.loss).toBe(winDeltaText(-0.04));
    expect(view[0].rows[0].grade).toBe('mistake');
    expect(view[1].rows[1].grade).toBe('blunder');
  });

  test('the lines of the row: the engine\'s line and the played line, each with its own text and block', () => {
    const lines = view[1].rows[0].lines;
    expect(lines.map(line => line.role)).toEqual(['engine', 'played']);
    expect(lines[0].text).toBe('Hydro Pump vs Draining Kiss, then Moonblast vs → Corviknight, then Moonblast vs Brave Bird');
    expect(lines[1].text).toBe('Hyper Voice vs Draining Kiss');
    expect(lines[0].block.line).toBe(singlesLine);
    expect(lines[0].block.tooltip).toContain('Hydro Pump: no crit (96%)');
  });

  test('a graded turn whose result holds no line has a row and no lines; so has a turn without a result', () => {
    expect(view[1].rows[1].lines).toEqual([]);
    const bare = gameReview({ analyses, results: [], playerNames: SINGLES_NAMES, doubles: false, host });
    expect(bare[1].rows.map(row => row.lines)).toEqual([[], []]);
  });
});

describe('gameReview, doubles', () => {
  const analyses: (TurnAnalysis | null)[] = [null, null, null, turnAnalysis(4, { p1: { ...misplayedSide('mistake'), best: rankedChoice('move 1, move 2', doublesLine.label, 0.37) } })];
  const results: (EvalResult | null)[] = [null, null, null, { ...evalResult('doubles'), lines: [doublesLine] }];

  test('a row keeps the pair\'s combined labels and its line text names the replacement', () => {
    const view = gameReview({ analyses, results, playerNames: DOUBLES_NAMES, doubles: true, host });
    expect(view[0].rows).toHaveLength(1);
    expect(view[1].rows).toHaveLength(0);
    const [line] = view[0].rows[0].lines;
    expect(line.role).toBe('engine');
    expect(line.text).toBe(
      'Fake Out → Rillaboom + Spore → Zamazenta vs Sucker Punch → Terapagos + Protect, ' +
      'then Mstr_Hawk replaces: → Zamazenta-Crowned, ' +
      'then Fake Out → Zamazenta-Crowned + Protect vs Behemoth Bash → Rillaboom + Protect',
    );
    // the block is the section's own: doubles rows, one per player
    expect(line.block.rows.length).toBeGreaterThan(3);
  });

  test('a replacement of both sides names both players', () => {
    const step = doublesLine.steps[1];
    const both: EvalLine = { ...doublesLine, steps: [{ ...step, replacement: 'both', p1: step.p2 }] };
    const view = gameReview({ analyses, results: [null, null, null, { ...evalResult('doubles'), lines: [both] }], playerNames: DOUBLES_NAMES, doubles: true, host });
    expect(view[0].rows[0].lines[0].text).toBe('pixelfrost replaces: → Zamazenta-Crowned and Mstr_Hawk replaces: → Zamazenta-Crowned');
  });
});
