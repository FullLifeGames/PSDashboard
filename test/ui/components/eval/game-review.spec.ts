import { describe, expect, test } from 'vitest';
import {
  buildGameReport,
  winPctText,
  winPercent,
  type EvalLine,
  type EvalResult,
  type SideAnalysis,
  type TurnAnalysis,
  lostGround,
} from '@fulllifegames/eval-engine';
import { gameReview, gradedTier, reviewCountText, reviewDiffers, reviewMarks, gradedSides } from '../../../../src/components/eval/game-review';
import type { LinesHost } from '../../../../src/lib/line-view';
import { misplayedSide, sideAnalysis, turnAnalysis } from '../../fixtures/analysis';
import { evalResult, rankedChoice } from '../../fixtures/eval-result';
import { bothRolesLine, doublesLine, DOUBLES_NAMES, playedLine, singlesLine, SINGLES_NAMES } from '../../fixtures/lines';

const host: LinesHost = { rules: { gen: 9, mod: undefined } };
const topped = (labels: string[]) => labels.map((label, index) => rankedChoice(`move ${index + 1}`, label, 0.2 - index * 0.05));
const withLines = (lines?: EvalLine[]): EvalResult => ({
  ...evalResult('singles'), ...(lines ? { lines } : {}), perSide: { p1: topped(['Draining Kiss', 'Surf']), p2: topped(['Hydro Pump', 'Hyper Voice']) },
});

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
    expect(gradedTier(gradedP2('inaccuracy', { riskPaidOff: true, sacrifice: { name: 'Kingambit', hpFraction: 0.1, healthy: false } as SideAnalysis['sacrifice'] }))).toBe('inaccuracy');
  });

  test('a read that paid off speaks for an inaccuracy too, unless the side lost ground (the report lists the read)', () => {
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

  test('the closed fold counts the marks: none, one, and a doubles turn graded on both sides twice', () => {
    const both = turnAnalysis(4, { p1: misplayedSide('blunder'), p2: gradedP2('inaccuracy') });
    expect(reviewCountText(reviewMarks([turnAnalysis(1)]).length)).toBe('no graded turn');
    expect(reviewCountText(reviewMarks([turnAnalysis(3, { p1: misplayedSide('mistake') })]).length)).toBe('1 graded turn');
    expect(reviewCountText(reviewMarks([both, turnAnalysis(5, { p2: gradedP2('mistake') })]).length)).toBe('3 graded turns');
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
    expect(row.loss).toBe('−2%');
    expect(row.lossTitle).toContain('regret of 0.04 on the score scale');
    expect(view[0].rows[0].grade).toBe('mistake');
    expect(view[1].rows[1].grade).toBe('blunder');
  });

  test('a row reads "played" for a choice and says no choice was shown for a body knocked out before it moved', () => {
    expect(view[1].rows[0].playedText).toBe(`played Hyper Voice ${winPctText(0.06)}`);
    const standIn = rankedChoice('move 2', 'stayed in (KO’d before acting)', -0.24);
    const knockedOut = gameReview({
      analyses: [turnAnalysis(1, { p2: gradedP2('blunder', { played: standIn, playedRaw: null, neverActed: true, prevented: 'faint' }) })], results: [null], playerNames: SINGLES_NAMES, doubles: false, host,
    });
    const row = knockedOut[1].rows[0];
    expect(row.playedText).toBe(`knocked out before it moved, so the log shows no choice · staying in ${winPctText(-0.24)}`);
    expect(row.playedText).not.toMatch(/stayed in|played/);
    expect(row.engine).toBe(`Hydro Pump ${winPctText(0.1)}`);
  });

  test.each([
    ['Doubles OU 2663093831 t7', 'fell', 'Orthworm', 'Protect', 'Iron Defense + Protect', 'Orthworm was knocked out before it moved, so the log shows no choice'],
    ['Champions VGC 2682637901 t6', 'ended', 'Volcarona', 'Aqua Jet', 'Quiver Dance + Aqua Jet', 'Volcarona was cut off by the end of the game, so the log shows no choice'],
  ] as const)('%s: a doubles row names the move that was played and why the other slot shows none (%s)', (_scene, reason, name, moved, filled, words) => {
    const pair = rankedChoice('move 1, move 2', filled, -0.24);
    const best = rankedChoice('move 3, move 4', 'Fake Out → Rillaboom + Spore → Tornadus', 0.1);
    const side: SideAnalysis = {
      playedRaw: null, playedSlots: [null, { kind: 'move', name: moved }], played: pair, best, safe: best, regret: 0.34, tier: 'mistake',
      playedPartial: true, noChoiceSlots: [{ slot: 0, reason }],
    };
    const slotted = { rules: host.rules, snapshot: { p1: { pokemon: [{ name, isActive: true, slot: 0 }, { name: 'Partner', isActive: true, slot: 1 }] }, p2: { pokemon: [] } } } as unknown as LinesHost;
    const rows = (target: LinesHost) => gameReview({ analyses: [turnAnalysis(7, { p1: side })], results: [null], playerNames: DOUBLES_NAMES, doubles: true, host: target })[0].rows;
    expect(rows(slotted)[0].playedText).toBe(`played ${moved} ${winPctText(-0.24)} · ${words}`);
    expect(rows(host)[0].playedText).toBe(`played ${moved} ${winPctText(-0.24)} · ${words.replace(name, 'Slot A')}`);
    expect(rows(slotted)[0].playedText).not.toContain(filled);
    expect(rows(slotted)[0].engine).toBe(`Fake Out → Rillaboom + Spore → Tornadus ${winPctText(0.1)}`);
  });

  test('the lines of the row: the engine\'s line and the played line, each with its own text and block', () => {
    const lines = view[1].rows[0].lines;
    expect(lines.map(line => line.role)).toEqual(['engine', 'played']);
    expect(lines[0].text).toBe("Hydro Pump vs Draining Kiss (Tzon's top choice), then Moonblast vs → Corviknight, then Moonblast vs Brave Bird");
    expect(lines[1].text).toBe("Hyper Voice vs Draining Kiss (Tzon's top choice)");
    expect(lines[0].block.line).toBe(singlesLine);
    expect(lines[0].block.tooltip).toContain('Hydro Pump: no crit (96%)');
  });

  test('a graded turn whose result holds no line has a row and no lines; so has a turn without a result', () => {
    expect(view[1].rows[1].lines).toEqual([]);
    const bare = gameReview({ analyses, results: [], playerNames: SINGLES_NAMES, doubles: false, host });
    expect(bare[1].rows.map(row => row.lines)).toEqual([[], []]);
  });
});

describe('gameReview: the engine of a row is the turn card\'s engine choice, and its line is that choice\'s line', () => {
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
    expect(row.engine).toBe(`Surf, at worst ${winPctText(0.02 - 0.2)}`);
    expect(row.loss).toBe(`−${winPercent(0.1) - winPercent(-0.24)}%`);
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
  const results: (EvalResult | null)[] = [null, null, null, { ...evalResult('doubles'), lines: [doublesLine], perSide: { p1: topped([doublesLine.label]), p2: topped(['Sucker Punch → Terapagos + Protect']) } }];

  test('a row keeps the pair\'s combined labels and its line text names the replacement', () => {
    const view = gameReview({ analyses, results, playerNames: DOUBLES_NAMES, doubles: true, host });
    expect(view[0].rows).toHaveLength(1);
    expect(view[1].rows).toHaveLength(0);
    const [line] = view[0].rows[0].lines;
    expect(line.role).toBe('engine');
    expect(line.text).toBe(
      'pixelfrost: Fake Out → Rillaboom + Spore → Zamazenta; Mstr_Hawk: Sucker Punch → Terapagos + Protect (Mstr_Hawk\'s top choice), ' +
      'then Mstr_Hawk replaces: → Zamazenta-Crowned, ' +
      'then pixelfrost: Fake Out → Zamazenta-Crowned + Protect; Mstr_Hawk: Behemoth Bash → Rillaboom + Protect',
    );
    expect(line.block.rows.length).toBeGreaterThan(3);
    // the engine's label of a replacement with a slot that passes ends in "+ pass"; the line's words leave it out
    const passing = { ...doublesLine, steps: doublesLine.steps.map(step => (step.replacement ? { ...step, p2: { ...step.p2, label: '→ Zamazenta-Crowned + pass' } } : step)) };
    const again = gameReview({ analyses, results: [null, null, null, { ...results[3]!, lines: [passing] }], playerNames: DOUBLES_NAMES, doubles: true, host });
    expect(again[0].rows[0].lines[0].text).toContain('then Mstr_Hawk replaces: → Zamazenta-Crowned, then pixelfrost');
  });

  test('a blunder beside an unpunished read names the best pair\'s size and the safe line as a floor', () => {
    const best = rankedChoice('move 1, move 2', 'Weather Ball → Incineroar + → Basculegion', 0.15, { worstCase: -0.28 });
    const played = rankedChoice('move 3, move 4', 'Heat Wave + Sucker Punch → Incineroar', -0.3);
    const side = { ...misplayedSide('blunder'), best, played, safe: best, riskUnpunished: true, regret: 0.45 };
    const view = gameReview({ analyses: [turnAnalysis(6, { p1: side })], results: [null], playerNames: DOUBLES_NAMES, doubles: true, host });
    const [row] = view[0].rows;
    expect(row.loss).toBe(`−${winPercent(0.15) - winPercent(-0.3)}%`);
    expect(row.engine).toBe(`Weather Ball → Incineroar + → Basculegion, at worst ${winPctText(-0.28)}`);
    expect(row.engineWord).toBe('safe');
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
    // a paid-off read without lost ground is listed; a graded side is a misplay or inaccuracy, not a read
    if (paid && swing < 0) expect(listedRead).toBe(true);
  });

  test('doubles: both sides of one turn, a read on one and an inaccuracy on the other', () => {
    const analysis = turnAnalysis(4, { swing: 0, p1: gradedP2('inaccuracy', { riskPaidOff: true }), p2: gradedP2('inaccuracy') });
    expect(reviewMarks([analysis])).toEqual([{ turn: 4, side: 'p2' }]);
  });
});

describe('gameReview: the end of each line beside its row', () => {
  test('singles: each line ends at its own value and knows whether it differs from the row the head prints', () => {
    const analyses: (TurnAnalysis | null)[] = Array.from({ length: 20 }, () => null);
    analyses[19] = turnAnalysis(20, { p2: gradedP2('inaccuracy') });
    const results: (EvalResult | null)[] = analyses.map(() => null);
    results[19] = withLines([singlesLine, playedLine]);
    const view = gameReview({ analyses, results, playerNames: SINGLES_NAMES, doubles: false, host });
    const [engine, played] = view[1].rows[0].lines;
    expect(engine.end).toBe(`ends at ${winPctText(singlesLine.end, singlesLine.endFainted)}`);
    expect(played.end).toBe(`ends at ${winPctText(playedLine.end, playedLine.endFainted)}`);
    // the engine row prints 0.1 and its line ends at 0.06; the played row 0.06 against a line at -0.24
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

describe('gameReview: the answer of each line', () => {
  const ranking = (labels: string[]) => labels.map((label, index) => rankedChoice(`move ${index}`, label, 0.2 - index * 0.05));

  test('singles: the first answer carries its rank in the result\'s ranking, a later answer does not', () => {
    const analyses: (TurnAnalysis | null)[] = Array.from({ length: 20 }, () => null);
    analyses[19] = turnAnalysis(20, { p2: gradedP2('inaccuracy') });
    const results: (EvalResult | null)[] = analyses.map(() => null);
    results[19] = { ...withLines([singlesLine, playedLine]), perSide: { p1: ranking(['Surf', 'Draining Kiss']), p2: ranking(['Hydro Pump']) } };
    const view = gameReview({ analyses, results, playerNames: SINGLES_NAMES, doubles: false, host });
    const [engine, played] = view[1].rows[0].lines;
    expect(engine.text).toBe("Hydro Pump vs Draining Kiss (Tzon's second choice in this search), then Moonblast vs → Corviknight, then Moonblast vs Brave Bird");
    expect(played.text).toBe("Hyper Voice vs Draining Kiss (Tzon's second choice in this search)");
    results[19] = { ...withLines([singlesLine]), perSide: { p1: [], p2: [] } };
    const bare = gameReview({ analyses, results, playerNames: SINGLES_NAMES, doubles: false, host });
    expect(bare[1].rows[0].lines[0].text).toBe("Hydro Pump vs Draining Kiss (not among Tzon's ranked choices), then Moonblast vs → Corviknight, then Moonblast vs Brave Bird");
  });

  test('doubles: the pair of the other player carries its rank, and a replacement carries none', () => {
    const analyses: (TurnAnalysis | null)[] = [null, null, null, turnAnalysis(4, { p1: { ...misplayedSide('mistake'), best: rankedChoice('move 1, move 2', doublesLine.label, 0.6) } })];
    const results: (EvalResult | null)[] = [null, null, null, { ...evalResult('doubles'), lines: [doublesLine], perSide: { p1: ranking([doublesLine.label]), p2: ranking(['Other', 'Sucker Punch → Terapagos + Protect']) } }];
    const view = gameReview({ analyses, results, playerNames: DOUBLES_NAMES, doubles: true, host });
    const [line] = view[0].rows[0].lines;
    expect(line.text).toBe(
      "pixelfrost: Fake Out → Rillaboom + Spore → Zamazenta; Mstr_Hawk: Sucker Punch → Terapagos + Protect (Mstr_Hawk's second choice in this search), " +
      'then Mstr_Hawk replaces: → Zamazenta-Crowned, ' +
      'then pixelfrost: Fake Out → Zamazenta-Crowned + Protect; Mstr_Hawk: Behemoth Bash → Rillaboom + Protect',
    );
  });
});

describe('gameReview: the opponent-reads setting', () => {
  const ranking = (labels: string[]) => labels.map((label, index) => rankedChoice(`move ${index}`, label, 0.2 - index * 0.05));
  const hard: LinesHost = { ...host, hardMode: true };
  const meetsSurf: EvalLine = { ...singlesLine, versus: 'worst', steps: [{ ...singlesLine.steps[0], p1: { choice: 'move 1', label: 'Surf', slots: [] } }, ...singlesLine.steps.slice(1)] };
  // Surf is the reply the search rates lowest for Hydro Pump: p1's highest cell of its column, 0.4 (p2's row: -0.4).
  const withMatrix = (lines: EvalLine[]): EvalResult => ({
    ...withLines(lines), perSide: { p1: ranking(['Draining Kiss', 'Surf']), p2: ranking(['Hydro Pump', 'Hyper Voice']) },
    matrix: { p1Labels: ['Draining Kiss', 'Surf'], p2Labels: ['Hydro Pump', 'Hyper Voice'], p1Choices: ['move 0', 'move 1'], p2Choices: ['move 0', 'move 1'], values: [[0.1, 0], [0.4, -0.1]], mixes: { p1: [1, 0], p2: [1, 0] } },
  });
  const review = (lines: EvalLine[], on: LinesHost, share?: number) => {
    const analyses: (TurnAnalysis | null)[] = Array.from({ length: 20 }, () => null);
    analyses[19] = turnAnalysis(20, { p2: gradedP2('inaccuracy', share === undefined ? {} : { faintedFraction: share }) });
    const results: (EvalResult | null)[] = analyses.map(() => null);
    results[19] = withMatrix(lines);
    return gameReview({ analyses, results, playerNames: SINGLES_NAMES, doubles: false, host: on })[1].rows[0].lines;
  };

  test('singles, on or off: the engine line is the usual line, whatever the result holds', () => {
    const usual = "Hydro Pump vs Draining Kiss (Tzon's top choice), then Moonblast vs → Corviknight, then Moonblast vs Brave Bird";
    expect(review([singlesLine, meetsSurf], hard)[0].text).toBe(usual);
    expect(review([singlesLine, meetsSurf], host)[0].text).toBe(usual);
  });

  test('singles, on, with a worst line for one pair row only: both rows keep their usual line and no sentence', () => {
    const lines = review([singlesLine, meetsSurf], hard);
    expect(lines).toHaveLength(1);
    expect(lines[0].block.worstNote).toBeFalsy();
    expect(lines[0].text).not.toMatch(/rates lowest|No line against/);
  });

  test('doubles, on: the pair keeps its usual line, as with the setting off', () => {
    const analyses: (TurnAnalysis | null)[] = [null, null, null, turnAnalysis(4, { p1: { ...misplayedSide('mistake'), best: rankedChoice('move 1, move 2', doublesLine.label, 0.6) } })];
    const worst: EvalLine = { ...doublesLine, versus: 'worst', steps: [doublesLine.steps[0], ...doublesLine.steps.slice(2)] };
    const results: (EvalResult | null)[] = [null, null, null, { ...evalResult('doubles'), lines: [doublesLine, worst] }];
    const textOf = (on: LinesHost) => gameReview({ analyses, results, playerNames: DOUBLES_NAMES, doubles: true, host: on })[0].rows[0].lines.map(line => line.text);
    expect(textOf(hard)).toEqual(textOf(host));
    expect(textOf(hard)).toHaveLength(1);
  });
});

const best = rankedChoice('move 1', 'Hydro Pump', 0.1);
const played = rankedChoice('move 2', 'Hyper Voice', -0.05);
const risk = (tier: 'inaccuracy' | 'mistake', overrides: Partial<SideAnalysis> = {}): SideAnalysis => ({
  ...sideAnalysis(), played, best, safe: best, regret: 0.15, tier,
  safeAgainstClick: { against: 'Protect', playedValue: 0.325, safeValue: 0.454 }, ...overrides,
});

describe('a risk that the safe line matched against the click is graded', () => {
  test.each(['inaccuracy', 'mistake'] as const)('%s: graded without the read credit', tier => {
    expect(gradedTier(risk(tier))).toBe(tier);
  });

  test.each(['inaccuracy', 'mistake'] as const)('%s: with the credit it is no grade', tier => {
    expect(gradedTier(risk(tier, { riskPaidOff: true }))).toBeNull();
  });

  test('the review lists the graded side of a turn', () => {
    const analysis = turnAnalysis(8, { p1: risk('inaccuracy'), p2: sideAnalysis() });
    expect(gradedSides([analysis]).map(entry => [entry.side, entry.grade])).toEqual([['p1', 'inaccuracy']]);
    expect(lostGround(analysis, 'p1')).toBe(false);
  });
});
