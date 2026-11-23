import { describe, expect, test } from 'vitest';
import { analyzeTurn, type SideAnalysis, type AnalyzeTurnParams } from '../src/analysis';
import type { PlayedTurn } from '../src/played';
import type { EvalMatrix, EvalResult, RankedChoice } from '../src/types';
import type { TurnRolls } from '../src/dice-events';

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

const ranked = (choice: string, label: string, worstCase: number, expected: number, ev: number): RankedChoice =>
  ({ choice, label, worstCase, expected, ev, punishedBy: null });

const quiet: TurnRolls = { favored: { p1: false, p2: false }, hits: [] };
const rolled = (side: 'p1' | 'p2'): TurnRolls => ({ favored: { p1: side === 'p1', p2: side === 'p2' }, hits: [] });

/** The lane D numbers of 653785 t19 (p1 view): best -0.1, played -0.1155 (regret 0.0155), safe floor -0.1307, window peak 0.2136. */
function t19(side: 'p1' | 'p2', over: Partial<AnalyzeTurnParams> = {}, doubles = false) {
  const sign = side === 'p1' ? 1 : -1;
  const own = (value: number) => sign * value;
  const playedRow = doubles
    ? ranked('switch 3, move protect', '→ Weavile + Protect', -0.2, -0.12, -0.1155)
    : ranked('switch 3', '→ Weavile', -0.2, -0.12, -0.1155);
  const bestRow = ranked('move 1', 'Roost', -0.1307, -0.11, -0.1);
  const mine = [bestRow, playedRow];
  const foe = [ranked('move 1', 'Flare Blitz', 0.1, 0.1, 0.1)];
  const result: EvalResult = {
    score: own(-0.1753), interval: 0, depthCompleted: 2,
    perSide: side === 'p1' ? { p1: mine, p2: foe } : { p1: foe, p2: mine },
  };
  const weavile = { kind: 'switch' as const, name: 'Weavile', species: 'Weavile' };
  const protect = { kind: 'move' as const, name: 'Protect' };
  const flare = { kind: 'move' as const, name: 'Flare Blitz' };
  const mineAction = doubles ? { slots: [weavile, protect], raw: null } : { slots: undefined, raw: weavile };
  const played = side === 'p1'
    ? { p1: mineAction.raw, p2: flare, ...(mineAction.slots ? { p1Slots: mineAction.slots } : {}) }
    : { p1: flare, p2: mineAction.raw, ...(mineAction.slots ? { p2Slots: mineAction.slots } : {}) };
  return analyzeTurn({
    turn: 19, result, played,
    playedOutcome: own(-0.0927), futureOutcomes: [own(0.1764), own(0.2136)],
    scoreBefore: own(-0.1753), scoreAfter: own(0.0451),
    sacks: { [side]: { name: 'Weavile', species: 'Weavile', hpFraction: 63 / 281, healthy: true, hazard: true } },
    rolls: quiet,
    ...over,
  });
}

describe('the hazard sack reads the dice, not the gap between two searches (T287 follow-up)', () => {
  for (const side of ['p1', 'p2'] as const) {
    for (const doubles of [false, true]) {
      const kind = doubles ? 'doubles' : 'singles';
      test(`${kind}, ${side}: no roll on the turn and a later root 0.138 better is still the hazard sack`, () => {
        const analysis = t19(side, {}, doubles);
        expect(analysis[side].regret).toBeCloseTo(0.0155, 4);
        expect(analysis[side].tier).toBeUndefined();
        expect(analysis[side].sacrifice).toMatchObject({ name: 'Weavile', hazard: true, verified: true });
      });

      test(`${kind}, ${side}: a roll in the side's favour on the turn earns no stamp`, () => {
        const analysis = t19(side, { rolls: rolled(side) }, doubles);
        expect(analysis[side].sacrifice).toBeUndefined();
      });

      test(`${kind}, ${side}: a roll for the opponent does not cost the stamp`, () => {
        const analysis = t19(side, { rolls: rolled(side === 'p1' ? 'p2' : 'p1') }, doubles);
        expect(analysis[side].sacrifice).toMatchObject({ hazard: true, verified: true });
      });
    }
  }

  test('without the turn\'s rolls the score test stays: a later root 0.138 above the pair earns no stamp', () => {
    expect(t19('p1', { rolls: undefined }).p1.sacrifice).toBeUndefined();
    // The pair's own value reached by the after score (own luck 0): the stamp stands.
    expect(t19('p1', { rolls: undefined, scoreAfter: -0.0927 }).p1.sacrifice).toMatchObject({ hazard: true, verified: true });
  });
});

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

test("the null guard reads the defender's Tera type from the other side", () => {
  const board: EvalResult = {
    score: 0.1, interval: 0, depthCompleted: 1,
    perSide: {
      p1: [choice('move shadowball', 'Shadow Ball', 0.2)],
      p2: [choice('move earthquake', 'Earthquake', -0.1)],
    },
  };
  const analysis = analyzeTurn({
    turn: 12,
    result: board,
    played: { p1: { kind: 'move', name: 'Shadow Ball', tera: false }, p2: { kind: 'move', name: 'Earthquake', tera: false } },
    playedOutcome: 0.0,
    scoreBefore: 0.1,
    scoreAfter: 0.1,
    actives: { p1: 'Gholdengo', p2: 'Snorlax', gen: 9, p1Tera: 'Flying', p2Tera: null },
  });
  expect(analysis.p2.bestNull?.reason).toBe('Gholdengo (Tera Flying) is immune to Ground-type moves');
  expect(analysis.p1.bestNull?.reason).toBe('Snorlax is immune to Ghost-type moves');
});
