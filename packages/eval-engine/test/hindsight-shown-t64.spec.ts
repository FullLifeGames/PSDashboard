import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { analyzeTurn, TIER_THRESHOLDS, type SideAnalysis } from '../src/analysis';
import { mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees } from '../src/mcts-merge';
import { cellKey } from '../src/rank';
import type { EvalMatrix, EvalResult, MctsTreeStats, RankedChoice } from '../src/types';
import type { PlayedTurn } from '../src/played';

/**
 * Round 69 (T64, spec decision 23): the read against the opponent's ACTUAL
 * click. A doubles click is found per slot, the cell of the best own row
 * carries its visits and whether the verify step re-priced it
 * (EvalMatrix.cells), and the read is SHOWN only when the gain clears the
 * regret by a band and that cell is not a one-or-two-visit guess (912045 t8).
 * Display only: tier, regret and sums never move with the read.
 */

const rowOf = (choiceId: string, label: string, ev: number): RankedChoice =>
  ({ choice: choiceId, label, worstCase: ev - 0.1, expected: ev, ev, punishedBy: 'Reply' });

type Cells = EvalMatrix['cells'];
const MISS = { visits: 2, verified: false };
const SEEN = { visits: 20, verified: false };

interface Shape {
  p1Choices: string[]; p1Labels: string[]; p1Ev: number[];
  p2Choices: string[]; p2Labels: string[];
  /** p1-perspective cell values. */
  values: number[][];
  played: PlayedTurn;
}

const resultOf = (shape: Shape, cells?: Cells): EvalResult => ({
  score: 0.05, interval: 0.02, depthCompleted: 1,
  perSide: {
    // The list is ranked: best equilibrium value first, as the search hands it over.
    p1: shape.p1Choices.map((choiceId, i) => rowOf(choiceId, shape.p1Labels[i], shape.p1Ev[i])).sort((a, b) => b.ev - a.ev),
    p2: shape.p2Choices.map((choiceId, j) => rowOf(choiceId, shape.p2Labels[j], -0.05 - j * 0.01)),
  },
  matrix: {
    p1Labels: shape.p1Labels, p2Labels: shape.p2Labels,
    p1Choices: shape.p1Choices, p2Choices: shape.p2Choices,
    values: shape.values,
    mixes: { p1: shape.p1Choices.map(() => 1 / shape.p1Choices.length), p2: shape.p2Choices.map(() => 1 / shape.p2Choices.length) },
    ...(cells ? { cells } : {}),
  },
});

const analyze = (result: EvalResult, played: PlayedTurn) => analyzeTurn({
  turn: 6, result, played, playedOutcome: 0, scoreBefore: 0.05, scoreAfter: 0.0,
});

/**
 * Doubles: p1 played row 0 ("Icy Wind + Protect") into p2's pair
 * "Protect + Drain Punch" (column 0). Against that column the row
 * "Tackle + Protect" is worth 0.40 more (-0.30 against +0.10), while the
 * equilibrium prices the two rows 0.05 apart.
 */
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

/**
 * Singles: p2 played a U-turn, and the matrix lists a pivot only as pair
 * rows ("move uturn > switch 2"). p1 played Iron Head; Earth Power is worth
 * 0.35 more against the pair actually clicked.
 */
const singlesShape = (): Shape => ({
  p1Choices: ['move ironhead', 'move earthpower'],
  p1Labels: ['Iron Head', 'Earth Power'],
  p1Ev: [0.05, 0.10],
  p2Choices: ['move uturn > switch 2', 'move uturn > switch 3'],
  p2Labels: ['U-turn → Clefable', 'U-turn → Noivern'],
  values: [[-0.25, 0.20], [0.10, 0.10]],
  played: {
    p1: { kind: 'move', name: 'Iron Head', tera: false },
    p2: { kind: 'move', name: 'U-turn', tera: false, pivotTarget: 'Clefable' },
  },
});

describe('the hindsight read finds the opponent click on both game types', () => {
  test('doubles: the pair of slots the opponent clicked is a column (red before: no read at all)', () => {
    const analysis = analyze(resultOf(doublesShape()), doublesShape().played);
    expect(analysis.p1.hindsightRead).toMatchObject({
      response: 'Tackle→Incineroar + Protect', against: 'Protect + Drain Punch→Incineroar',
    });
    expect(analysis.p1.hindsightRead!.gain).toBeCloseTo(0.40, 10);
  });

  test('doubles: a hidden slot of the opponent gives no column (no charitable pick for what was clicked)', () => {
    const shape = doublesShape();
    shape.played = { ...shape.played, p2Slots: [{ kind: 'move', name: 'Protect', targetLoc: null }, null] };
    expect(analyze(resultOf(shape), shape.played).p1.hindsightRead).toBeUndefined();
  });

  test('singles pivot: the pair row of the clicked U-turn is still found', () => {
    const shape = singlesShape();
    const analysis = analyze(resultOf(shape), shape.played);
    expect(analysis.p1.hindsightRead).toMatchObject({ response: 'Earth Power', against: 'U-turn → Clefable' });
    expect(analysis.p1.hindsightRead!.gain).toBeCloseTo(0.35, 10);
  });
});

describe('the read is shown only past the regret and a cell that is not a guess', () => {
  const shapes: [string, () => Shape][] = [['doubles', doublesShape], ['singles', singlesShape]];
  // The cell of the best own row (row 1) against the clicked column (column 0).
  const cellsWith = (best: { visits: number; verified: boolean }): Cells => [
    [SEEN, SEEN],
    [best, SEEN],
  ];
  const readOf = (make: () => Shape, cells?: Cells): SideAnalysis['hindsightRead'] => {
    const shape = make();
    return analyze(resultOf(shape, cells), shape.played).p1.hindsightRead;
  };

  for (const [name, make] of shapes) {
    test(`${name}: a cell with 2 visits that nobody verified is not shown (912045 t8 shape), 8 visits is`, () => {
      expect(readOf(make, cellsWith(MISS))?.shown).toBeUndefined();
      expect(readOf(make, cellsWith({ visits: 7, verified: false }))?.shown).toBeUndefined();
      expect(readOf(make, cellsWith({ visits: 8, verified: false }))?.shown).toBe(true);
    });

    test(`${name}: a verified cell is shown whatever its visits`, () => {
      expect(readOf(make, cellsWith({ visits: 2, verified: true }))?.shown).toBe(true);
    });

    test(`${name}: a result without cells (matrix mode, old cache) counts as matrix grade`, () => {
      expect(readOf(make)?.shown).toBe(true);
    });
  }

  test('a gain under the regret plus the band is not shown, the read itself stays for the prose', () => {
    // Equilibrium regret 0.30 (best 0.35, played 0.05); gain against the click 0.40 < 0.30 + 0.10 + epsilon.
    const shape = doublesShape();
    shape.p1Ev = [0.05, 0.36];
    const read = analyze(resultOf(shape, [[SEEN, SEEN], [SEEN, SEEN]]), shape.played).p1.hindsightRead;
    expect(read).toBeDefined();
    expect(read!.shown).toBeUndefined();
    // The band is one tier step: a regret one hundredth under (gain - band) shows it.
    shape.p1Ev = [0.05, 0.05 + (0.40 - TIER_THRESHOLDS.inaccuracy - 0.01)];
    expect(analyze(resultOf(shape, [[SEEN, SEEN], [SEEN, SEEN]]), shape.played).p1.hindsightRead!.shown).toBe(true);
  });

  for (const [name, make] of shapes) {
    test(`${name}: the read never grades (tier, regret and every other field equal with or without it)`, () => {
      const shape = make();
      const shown = analyze(resultOf(shape, cellsWith(SEEN)), shape.played);
      const hidden = analyze(resultOf(shape, cellsWith(MISS)), shape.played);
      expect(shown.p1.hindsightRead?.shown).toBe(true);
      expect(hidden.p1.hindsightRead?.shown).toBeUndefined();
      const bare = (analysis: typeof shown) => ({
        ...analysis, p1: { ...analysis.p1, hindsightRead: undefined }, p2: { ...analysis.p2, hindsightRead: undefined },
      });
      expect(bare(hidden)).toEqual(bare(shown));
      expect(shown.p1.regret).toBeCloseTo(0.05, 10);
    });
  }
});

describe('the merge writes the visits and the verified flag of every cell', () => {
  const options = (labels: string[]) => labels.map(label => ({ choice: label, label }));
  const emptyResult = { score: 0, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } };
  const mk = (p1: string[], p2: string[], cells: MctsTreeStats['cells']): MctsTreeStats => ({
    p1Options: options(p1), p2Options: options(p2),
    p1N: p1.map(() => 5), p1W: p1.map(() => 1), p2N: p2.map(() => 5), p2W: p2.map(() => 1),
    visits: 10, depth: 2, rootValue: 0.1, cells, result: emptyResult,
  });
  const cell = (i: number, j: number, visits: number) => ({ key: cellKey(i, j), visits, total: 0.1 * visits, value: 0.1, ended: false });

  test.each([
    ['singles', ['A', 'B'], ['X', 'Y']],
    ['doubles', ['move a 1, move b', 'switch 3, move b'], ['move x, move y 2', 'move x, switch 3']],
  ])('%s: visits are the pooled visits, verified marks the re-priced keys, unvisited cells read 0', (_name, p1, p2) => {
    const t1 = mk(p1, p2, [cell(0, 0, 8), cell(0, 1, 2), cell(1, 0, 3)]);
    const t2 = mk(p1, p2, [cell(0, 0, 4), cell(1, 0, 1)]);
    const verified = new Map([[cellKey(1, 0), { i: 1, j: 0, value: 0.05, ended: false }]]);
    const merged = mergeMctsTrees([t1, t2], verified);
    expect(merged.matrix!.cells).toEqual([
      [{ visits: 12, verified: false }, { visits: 2, verified: false }],
      [{ visits: 4, verified: true }, { visits: 0, verified: false }],
    ]);
    // Index-aligned with the values the equilibrium was solved over.
    expect(merged.matrix!.cells!.length).toBe(merged.matrix!.values.length);
    expect(merged.matrix!.cells![0].length).toBe(merged.matrix!.values[0].length);
    // Without verification nothing is verified.
    expect(mergeMctsTrees([t1, t2]).matrix!.cells!.flat().some(entry => entry.verified)).toBe(false);
  });
});

describe('a single tree writes its own cells (no merge happens for one tree)', () => {
  const set = (name: string, species: string, moves: string[], level: number): PokemonSet => ({
    name, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level, gender: '',
  });
  const battle = (): string => {
    const sim = new Battle({
      formatid: toID('gen9customgame'), seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack([set('Jolt', 'Jolteon', ['Thunder', 'Thunderbolt'], 100), set('Lax', 'Snorlax', ['Body Slam'], 100)]) },
      p2: { name: 'Beta', team: Teams.pack([set('Champ', 'Machamp', ['Seismic Toss'], 100), set('Egg', 'Chansey', ['Soft-Boiled'], 100)]) },
    });
    if (sim.sides.some(side => side.requestState === 'teampreview')) { sim.choose('p1', 'team 12'); sim.choose('p2', 'team 12'); }
    return JSON.stringify(State.serializeBattle(sim));
  };

  test('singles: the matrix of the tree result carries the visits of the tree cells and nothing verified', () => {
    const stats = mctsTreeSearch(battle(), { depth: 1, samples: 1, tera: false, mode: 'mcts', prove: false }, 0);
    expect(mergeMctsTrees([stats])).toBe(stats.result);
    const matrix = stats.result.matrix!;
    const cells = matrix.cells!;
    expect(cells.length).toBe(stats.p1Options.length);
    for (let i = 0; i < cells.length; i++) {
      expect(cells[i].length).toBe(stats.p2Options.length);
      for (let j = 0; j < cells[i].length; j++) {
        const own = stats.cells.find(entry => entry.key === cellKey(i, j));
        expect(cells[i][j]).toEqual({ visits: own?.visits ?? 0, verified: false });
      }
    }
    expect(cells.flat().some(entry => entry.visits > 0)).toBe(true);
  });
});
