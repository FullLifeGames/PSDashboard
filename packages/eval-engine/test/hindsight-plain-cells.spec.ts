import { describe, expect, test } from 'vitest';
import { analyzeTurn, type SideAnalysis } from '../src/analysis';
import type { PlayedTurn } from '../src/played';
import type { EvalMatrix, EvalResult, RankedChoice } from '../src/types';

/**
 * Round 70 (gate of 13.10.2026 20:26, 2a, and T217): what makes a hindsight read's cell "a guess" (HINDSIGHT_MIN_VISITS visits,
 * not verified, T64), once the planner's answer rides on the cell (T178).
 *
 *  - A cell the planner calls plain ("none": no accuracy roll and no kill range in the pair) has one outcome, so the first
 *    draw that priced it is no guess however few visits the tree gave it. VGC 2630685175 turn 7: the best row (Wood Hammer into
 *    Calyrex-Shadow with Earth Power into Zamazenta) against the clicked Pollen Puff with Wide Guard is such a cell, with 4
 *    visits and a value of 1.00, and the card dropped the read for it.
 *  - The gain is the best row's cell minus the played row's cell, so the gate looks at both (T217, finding 5 of the round-69
 *    review): a played row priced by a one-visit rolled cell lets a guessed number through.
 */

const rowOf = (choice: string, label: string, ev: number): RankedChoice => ({ choice, label, worstCase: ev - 0.1, expected: ev, ev, punishedBy: 'Reply' });

type Cell = NonNullable<EvalMatrix['cells']>[number][number];
const SEEN: Cell = { visits: 20, verified: false };
const GUESS: Cell = { visits: 2, verified: false };
const PLAIN: Cell = { visits: 2, verified: false, plan: 'none' };
const ROLLED: Cell = { visits: 2, verified: false, plan: 'events', classes: [{ key: 'hit-nokill', weight: 0.6 }, { key: 'miss', weight: 0.4 }] };
const FAILED: Cell = { visits: 2, verified: false, plan: 'fail' };

interface Shape {
  p1Choices: string[]; p1Labels: string[]; p1Ev: number[];
  p2Choices: string[]; p2Labels: string[];
  values: number[][];
  played: PlayedTurn;
}

/** Doubles: p1 played row 0 against p2's pair "Protect + Drain Punch" (column 0), where row 1 is worth 0.40 more. */
const doublesShape = (): Shape => ({
  p1Choices: ['move icywind, move protect', 'move tackle 1, move protect'],
  p1Labels: ['Icy Wind + Protect', 'Tackle→Incineroar + Protect'],
  p1Ev: [0.05, 0.10],
  p2Choices: ['move protect, move drainpunch 1', 'move rockslide, move ragefist 1'],
  p2Labels: ['Protect + Drain Punch→Incineroar', 'Rock Slide + Rage Fist→Incineroar'],
  values: [[-0.30, 0.20], [0.10, 0.10]],
  played: {
    p1: null, p2: null,
    p1Slots: [{ kind: 'move', name: 'Icy Wind', targetLoc: null }, { kind: 'move', name: 'Protect', targetLoc: null }],
    p2Slots: [{ kind: 'move', name: 'Protect', targetLoc: null }, { kind: 'move', name: 'Drain Punch', targetLoc: 1 }],
  },
});

/** Singles: p1 played Iron Head against Iron Head's answer Seismic Toss (column 0), where Earth Power is worth 0.35 more. */
const singlesShape = (): Shape => ({
  p1Choices: ['move ironhead', 'move earthpower'],
  p1Labels: ['Iron Head', 'Earth Power'],
  p1Ev: [0.05, 0.10],
  p2Choices: ['move seismictoss', 'switch 2'],
  p2Labels: ['Seismic Toss', '→ Clefable'],
  values: [[-0.25, 0.20], [0.10, 0.10]],
  played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'move', name: 'Seismic Toss', tera: false } },
});

const SHAPES: [string, () => Shape][] = [['doubles', doublesShape], ['singles', singlesShape]];

function readOf(make: () => Shape, cells?: Cell[][]): NonNullable<SideAnalysis['hindsightRead']> {
  const shape = make();
  const result: EvalResult = {
    score: 0.05, interval: 0.02, depthCompleted: 1,
    perSide: {
      p1: shape.p1Choices.map((choiceId, i) => rowOf(choiceId, shape.p1Labels[i], shape.p1Ev[i])).sort((a, b) => b.ev - a.ev),
      p2: shape.p2Choices.map((choiceId, j) => rowOf(choiceId, shape.p2Labels[j], -0.05 - j * 0.01)),
    },
    matrix: {
      p1Labels: shape.p1Labels, p2Labels: shape.p2Labels, p1Choices: shape.p1Choices, p2Choices: shape.p2Choices,
      values: shape.values,
      mixes: { p1: shape.p1Choices.map(() => 0.5), p2: shape.p2Choices.map(() => 0.5) },
      ...(cells ? { cells } : {}),
    },
  };
  const read = analyzeTurn({ turn: 6, result, played: shape.played, playedOutcome: 0, scoreBefore: 0.05, scoreAfter: 0.0 }).p1.hindsightRead;
  if (!read) throw new Error('the shape holds a read');
  return read;
}

/** The cells of the shape: [played row 0, best row 1] x [clicked column 0, other column 1]. */
const cellsOf = (bestAgainstClick: Cell, playedAgainstClick: Cell = SEEN): Cell[][] => [[playedAgainstClick, SEEN], [bestAgainstClick, SEEN]];

describe.each(SHAPES)('%s: a plain cell is no guess', (_name, make) => {
  test('the best row\'s cell the planner calls plain stands with 2 visits (red before: thin)', () => {
    const read = readOf(make, cellsOf(PLAIN));
    expect(read.thin).toBeUndefined();
    expect(read.shown).toBe(true);
    expect(read.line).toBeDefined();
  });

  test('a cell with a priced roll, a failed plan, or no plan answer is still a guess at 2 visits', () => {
    for (const guess of [ROLLED, FAILED, GUESS]) expect(readOf(make, cellsOf(guess)).thin).toBe(true);
  });

  test('a cell with visits or verified stands as before', () => {
    expect(readOf(make, cellsOf({ visits: 8, verified: false })).thin).toBeUndefined();
    expect(readOf(make, cellsOf({ visits: 2, verified: true })).thin).toBeUndefined();
    expect(readOf(make, cellsOf({ ...PLAIN, visits: 1 })).thin).toBeUndefined();
  });

  test('a plain cell no tree expanded is still a guess: it reads the root static, whatever the planner says', () => {
    expect(readOf(make, cellsOf({ ...PLAIN, visits: 0 })).thin).toBe(true);
  });
});

describe.each(SHAPES)('%s: the played row\'s cell gates the read too (T217)', (_name, make) => {
  test('a solid best cell with a guessed played cell leaves the read thin (red before: the read stood)', () => {
    const read = readOf(make, cellsOf(SEEN, GUESS));
    expect(read.thin).toBe(true);
    expect(read.shown).toBeUndefined();
    // The read itself stays on the analysis (display only): the same pair of rows.
    expect(read.response).toBe(make().p1Labels[1]);
  });

  test('a plain, a visited or a verified played cell stands', () => {
    for (const solid of [PLAIN, SEEN, { visits: 1, verified: true }]) {
      const read = readOf(make, cellsOf(SEEN, solid));
      expect(read.thin).toBeUndefined();
      expect(read.shown).toBe(true);
    }
  });

  test('a guess in either cell is a guess: the gate needs both', () => {
    expect(readOf(make, cellsOf(GUESS, GUESS)).thin).toBe(true);
    expect(readOf(make, cellsOf(PLAIN, ROLLED)).thin).toBe(true);
    expect(readOf(make, cellsOf(ROLLED, PLAIN)).thin).toBe(true);
    expect(readOf(make, cellsOf(PLAIN, PLAIN)).thin).toBeUndefined();
  });

  test('a result without cells (matrix mode, old cache) still passes', () => {
    expect(readOf(make).thin).toBeUndefined();
    expect(readOf(make).shown).toBe(true);
  });
});
