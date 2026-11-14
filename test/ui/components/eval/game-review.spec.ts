import { describe, expect, test } from 'vitest';
import { buildGameReport, winDeltaText, winPctText, type EvalLine, type EvalResult, type SideAnalysis, type TurnAnalysis } from '@fulllifegames/eval-engine';
import { gameReview, gradedTier, reviewDiffers, reviewMarks } from '../../../../src/components/eval/game-review';
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
    expect(gradedTier(gradedP2('inaccuracy', { riskPaidOff: true, sacrifice: { name: 'Kingambit', hpFraction: 0.1, healthy: false } as SideAnalysis['sacrifice'] }))).toBe('inaccuracy');
  });

  test('a read that paid off speaks for an inaccuracy too, unless the side lost ground (round 89, G4d: the report lists the read)', () => {
    expect(gradedTier(gradedP2('inaccuracy', { riskPaidOff: true }))).toBeNull();
    expect(gradedTier(gradedP2('inaccuracy', { riskPaidOff: true }), true)).toBe('inaccuracy');
    expect(gradedTier(gradedP2('inaccuracy'), true)).toBe('inaccuracy');
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

describe('gameReview: the engine of a row is the turn card\'s engine choice, and its line is that choice\'s line (G4b)', () => {
  const rowOf = (side: SideAnalysis, lines: EvalLine[], swing = 0.05) => {
    const analyses: (TurnAnalysis | null)[] = [turnAnalysis(1, { p2: side, swing })];
    const view = gameReview({ analyses, results: [withLines(lines)], playerNames: SINGLES_NAMES, doubles: false, host });
    return view[1].rows[0];
  };

  test('an inaccuracy beside a read that paid off (player 2 lost ground, so the report lists no read) names the best row at its value, as the card\'s head row does, not the safe line', () => {
    const safe = rankedChoice('move 3', 'Surf', 0.02);
    const row = rowOf(gradedP2('inaccuracy', { riskPaidOff: true, safe }), [singlesLine, playedLine], 0.3);
    expect(row.engine).toBe(`Hydro Pump ${winPctText(0.1)}`);
    expect(row.engineWord).toBe('engine');
    expect(row.lines.map(line => line.block.line.label)).toEqual(['Hydro Pump', 'Hyper Voice']);
  });

  test('a mistake with a read that stands unpunished says "safe", as the card does, and has no line for the safe choice', () => {
    const safe = rankedChoice('move 3', 'Surf', 0.02);
    const row = rowOf(gradedP2('mistake', { riskUnpunished: true, safe }), [singlesLine, playedLine]);
    expect(row.engineWord).toBe('safe');
    expect(row.engine).toBe(`Surf ${winPctText(0.02 - 0.2)}`);
    // the engine's own line belongs to Hydro Pump, which is not the card's choice here
    expect(row.lines.map(line => line.role)).toEqual(['played']);
  });

  test('a line whose label is no longer the best row is not the engine line; one that was both reads as the played line', () => {
    const stale: EvalLine = { ...singlesLine, label: 'Surf', choice: 'move 4' };
    expect(rowOf(gradedP2('blunder'), [stale, playedLine]).lines.map(line => line.role)).toEqual(['played']);
    const both: EvalLine = { ...playedLine, label: 'Hyper Voice', for: ['engine', 'played'] };
    const [only] = rowOf(gradedP2('blunder'), [both]).lines;
    expect(only.role).toBe('played');
    expect(only.block.role).toBe('played: Hyper Voice');
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
      'pixelfrost: Fake Out → Rillaboom + Spore → Zamazenta; Mstr_Hawk: Sucker Punch → Terapagos + Protect, ' +
      'then Mstr_Hawk replaces: → Zamazenta-Crowned, ' +
      'then pixelfrost: Fake Out → Zamazenta-Crowned + Protect; Mstr_Hawk: Behemoth Bash → Rillaboom + Protect',
    );
    // the block is the section's own: doubles rows, one per player
    expect(line.block.rows.length).toBeGreaterThan(3);
  });

  test('doubles: the engine line is the line of the card\'s engine pair, and another pair\'s line is dropped', () => {
    const stale: EvalLine = { ...doublesLine, label: 'Fake Out → Rillaboom + Protect', choice: 'move 1, move 3' };
    const view = gameReview({ analyses, results: [null, null, null, { ...evalResult('doubles'), lines: [stale] }], playerNames: DOUBLES_NAMES, doubles: true, host });
    expect(view[0].rows[0].lines).toEqual([]);
    expect(view[0].rows[0].engine).toContain(doublesLine.label);
  });

  test('a replacement of both sides names both players', () => {
    const step = doublesLine.steps[1];
    const both: EvalLine = { ...doublesLine, steps: [{ ...step, replacement: 'both', p1: step.p2 }] };
    const view = gameReview({ analyses, results: [null, null, null, { ...evalResult('doubles'), lines: [both] }], playerNames: DOUBLES_NAMES, doubles: true, host });
    expect(view[0].rows[0].lines[0].text).toBe('pixelfrost replaces: → Zamazenta-Crowned and Mstr_Hawk replaces: → Zamazenta-Crowned');
  });
});

/**
 * Round 89 (#104), G4d: the report page said "read paid off +9%" and, one list below, "inaccuracy −9%" for the same click. The
 * report lists a read from `riskPaidOff` unless the side lost ground, and keeps it off its misplays; the review and the marks
 * read the same two facts through `gradedTier`. The real report is built for every combination, singles (p2) and doubles (both
 * sides graded on one turn).
 */
describe('the review and the report list one verdict per side', () => {
  const combos = [
    { tier: 'inaccuracy', paid: false }, { tier: 'inaccuracy', paid: true },
    { tier: 'mistake', paid: false }, { tier: 'mistake', paid: true },
    { tier: 'blunder', paid: true },
  ] as const;
  // the swing is player 1's view: -0.2 is player 2 gaining, 0.2 is player 2 losing ground
  const swings = [{ name: 'gained', swing: -0.2 }, { name: 'lost ground', swing: 0.2 }];

  test.each(combos.flatMap(combo => swings.map(swing => ({ ...combo, ...swing }))))('$tier, riskPaidOff $paid, p2 $name: no turn is a read and a grade at once', ({ tier, paid, swing }) => {
    const analysis = turnAnalysis(2, { swing, p2: gradedP2(tier, paid ? { riskPaidOff: true, riskPayoff: 0.09 } : {}) });
    const report = buildGameReport([analysis], SINGLES_NAMES, 'p2');
    const listedRead = report.reads.some(read => read.turn === 2 && read.side === 'p2');
    const marked = reviewMarks([analysis]).some(mark => mark.turn === 2 && mark.side === 'p2');
    const reviewed = gameReview({ analyses: [null, analysis], results: [], playerNames: SINGLES_NAMES, doubles: false, host })
      .flatMap(view => view.rows).some(row => row.turn === 2 && row.side === 'p2');
    expect(reviewed, 'rows and marks agree').toBe(marked);
    expect(listedRead && marked, 'a listed read is not graded').toBe(false);
    // a paid-off read the side did not lose ground on is listed; a graded side is a misplay or an inaccuracy the report does not list as a read
    if (paid && swing < 0) expect(listedRead).toBe(true);
  });

  test('doubles: both sides of one turn, a read on one and an inaccuracy on the other', () => {
    const analysis = turnAnalysis(4, { swing: 0, p1: gradedP2('inaccuracy', { riskPaidOff: true }), p2: gradedP2('inaccuracy') });
    expect(reviewMarks([analysis])).toEqual([{ turn: 4, side: 'p2' }]);
  });
});

/** Round 89 (#104), step G10 (ruling G5a): each review line ends with its own number; a line that differs from its row is told apart. */
describe('gameReview: the end of each line beside its row (G10)', () => {
  test('singles: each line ends at its own value and knows whether it differs from the row the head prints', () => {
    const analyses: (TurnAnalysis | null)[] = Array.from({ length: 20 }, () => null);
    analyses[19] = turnAnalysis(20, { p2: gradedP2('inaccuracy') });
    const results: (EvalResult | null)[] = analyses.map(() => null);
    results[19] = withLines([singlesLine, playedLine]);
    const view = gameReview({ analyses, results, playerNames: SINGLES_NAMES, doubles: false, host });
    const [engine, played] = view[1].rows[0].lines;
    expect(engine.end).toBe(`ends at ${winPctText(singlesLine.end, singlesLine.endFainted)}`);
    expect(played.end).toBe(`ends at ${winPctText(playedLine.end, playedLine.endFainted)}`);
    // the engine row prints 0.1 and the line ends at 0.06 (a different print), the played row 0.06 against a line at -0.24
    expect(engine.block.row).toBe(winPctText(0.1));
    expect(played.block.row).toBe(winPctText(0.06));
    expect(engine.block.differs).toBe(true);
    expect(played.block.differs).toBe(true);
    expect(reviewDiffers(view)).toBe(true);
  });

  test('singles: no line differs when every line ends where its row stands', () => {
    const share = 0.1;
    const analyses: (TurnAnalysis | null)[] = Array.from({ length: 20 }, () => null);
    const side = gradedP2('inaccuracy', { faintedFraction: share, best: rankedChoice('move 1', 'Hydro Pump', singlesLine.end), played: rankedChoice('move 2', 'Hyper Voice', playedLine.end) });
    analyses[19] = turnAnalysis(20, { p2: side });
    const results: (EvalResult | null)[] = analyses.map(() => null);
    results[19] = withLines([singlesLine, playedLine]);
    const view = gameReview({ analyses, results, playerNames: SINGLES_NAMES, doubles: false, host });
    expect(view[1].rows[0].lines.map(line => line.block.differs)).toEqual([false, false]);
    expect(reviewDiffers(view)).toBe(false);
  });

  test('doubles: the pair line ends at its value and differs from the row the head prints', () => {
    const analyses: (TurnAnalysis | null)[] = [null, null, null, turnAnalysis(4, { p1: { ...misplayedSide('mistake'), best: rankedChoice('move 1, move 2', doublesLine.label, 0.6) } })];
    const results: (EvalResult | null)[] = [null, null, null, { ...evalResult('doubles'), lines: [doublesLine] }];
    const view = gameReview({ analyses, results, playerNames: DOUBLES_NAMES, doubles: true, host });
    const [line] = view[0].rows[0].lines;
    expect(line.end).toBe(`ends at ${winPctText(doublesLine.end, doublesLine.endFainted)}`);
    expect(line.block.differs).toBe(true);
    expect(reviewDiffers(view)).toBe(true);
  });

  test('a review without lines has nothing to explain', () => {
    expect(reviewDiffers(gameReview({ analyses: [], results: [], playerNames: SINGLES_NAMES, doubles: false, host }))).toBe(false);
  });
});
