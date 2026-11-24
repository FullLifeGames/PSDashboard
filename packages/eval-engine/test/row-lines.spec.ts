import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { mctsRoot, mctsTreeSearch } from '../src/mcts';
import { cellKey } from '../src/rank';
import { LINE_MIN_VISITS, lineFrom, principalVariation, rowLines as rowLinesAt, type Node } from '../src/search/mcts-node';
import type { EvalSettings, RowLines, TreeLineStep } from '../src/types';

/**
 * The line of a root row, on synthetic nodes by hand (only the fields the walk reads): the row's first cell is the one against the
 * opponent's top row once it has 8 visits, else the row's heaviest cell; a step under 8 visits ends the line; three steps at most
 * (the fixtures' nodes carry equal means, so each later step is the pair of the most visited options; the last describe holds the
 * by-value rule); a replacement step keeps the waiting label. `principalVariation` is held to a reference copy of the plain walk
 * below. Rows are keyed by label: a reordered bench moves the choice strings and not the labels (singles and doubles boards).
 */

interface Cell { i: number; j: number; visits: number; child?: Node }

/** The tops a tree reports: each side's best rows by label, best first. */
const tops = (p1: string, p2: string, ...more: string[]): { p1: string[]; p2: string[] } => ({ p1: [p1], p2: [p2, ...more] });

/** The walk at the threshold of 8 visits, which the fixtures below were written for (the walk's own default is 4). */
const rowLines = (root: Node, tops: { p1: readonly string[]; p2: readonly string[] }): RowLines => rowLinesAt(root, tops, 8);

const options = (labels: string[]) => labels.map((label, index) => ({ choice: `move ${index + 1}`, label }));

/**
 * What a node's options carry besides the cells: the visits of an option are the visits of its cells, and its mean (p1's view for both
 * sides, as the tree stores it) is `means` by option index, 0.5 where none is given; the hint order is the list order.
 */
interface Means { p1?: Record<number, number>; p2?: Record<number, number> }

function node(p1: string[], p2: string[], cells: Cell[], extra: Partial<Node> = {}, means: Means = {}): Node {
  const children = new Map<number, Node>();
  const p1N = p1.map(() => 0);
  const p2N = p2.map(() => 0);
  for (const cell of cells) {
    const child = cell.child ?? node([], [], []);
    child.visits = cell.visits;
    children.set(cellKey(cell.i, cell.j), child);
    p1N[cell.i] += cell.visits;
    p2N[cell.j] += cell.visits;
  }
  return {
    kind: 'decision', ended: false, boundary: true, p1Options: options(p1), p2Options: options(p2), children, visits: 0,
    p1N, p2N, p1W: p1N.map((n, i) => n * (means.p1?.[i] ?? 0.5)), p2W: p2N.map((n, j) => n * (means.p2?.[j] ?? 0.5)),
    p1Order: p1.map((_, i) => i), p2Order: p2.map((_, j) => j), ...extra,
  } as unknown as Node;
}

/** A reference copy of the walk, so the shared walk is held to it. */
function referenceVariation(start: Node): { p1: string; p2: string }[] {
  const steps: { p1: string; p2: string }[] = [];
  let current = start;
  for (let step = 0; step < 3; step++) {
    if (current.ended || current.p1Options.length === 0 || current.p2Options.length === 0) break;
    let best: Node | undefined;
    let bestVisits = 0;
    let bestI = 0;
    let bestJ = 0;
    for (const [key, child] of current.children) {
      if (child.visits > bestVisits) {
        bestVisits = child.visits;
        best = child;
        bestI = Math.floor(key / 10_000);
        bestJ = key % 10_000;
      }
    }
    if (!best || bestVisits < 8) break;
    steps.push({ p1: current.p1Options[bestI].label, p2: current.p2Options[bestJ].label });
    current = best;
  }
  return steps;
}

describe('the line of a root row', () => {
  const deep = (): Node => node(['Surf', 'Ice Beam'], ['Draining Kiss', '→ Mew'], [
    { i: 0, j: 0, visits: 40, child: node(['Surf', '→ Gyarados'], ['Moonblast', 'Draining Kiss'], [
      { i: 1, j: 1, visits: 20, child: node(['Surf'], ['Moonblast'], [{ i: 0, j: 0, visits: 9, child: node(['x'], ['y'], [{ i: 0, j: 0, visits: 9 }]) }]) },
      { i: 0, j: 0, visits: 3 },
    ]) },
    { i: 0, j: 1, visits: 12 },
    { i: 1, j: 0, visits: 25 },
    { i: 1, j: 1, visits: 5 },
  ]);

  test('the first cell is the one against the opponent\'s top row, then the best-mean pair of each node, three steps at most', () => {
    const lines = rowLines(deep(), tops('Surf', 'Draining Kiss'));
    expect(lines.p1.Surf[0].map(step => [step.p1, step.p2, step.visits])).toEqual([
      ['Surf', 'Draining Kiss', 40], ['→ Gyarados', 'Draining Kiss', 20], ['Surf', 'Moonblast', 9],
    ]);
    expect(lines.p1['Ice Beam'][0].map(step => step.p2)[0]).toBe('Draining Kiss');
  });

  test('a row whose cell against the top row is thin takes its heaviest cell', () => {
    const lines = rowLines(deep(), tops('Surf', '→ Mew'));
    // Surf against → Mew has 12 visits (enough): the line starts there
    expect(lines.p1.Surf[0].map(step => step.p2)).toEqual(['→ Mew']);
    // Ice Beam against → Mew has 5 (too few): its heaviest cell, against Draining Kiss, stands in
    expect(lines.p1['Ice Beam'][0].map(step => step.p2)).toEqual(['Draining Kiss']);
  });

  test('the opponent\'s rows read the same cells from their side', () => {
    const lines = rowLines(deep(), tops('Surf', 'Draining Kiss'));
    expect(lines.p2['Draining Kiss'][0][0]).toEqual({ p1: 'Surf', p2: 'Draining Kiss', visits: 40 });
    expect(lines.p2['→ Mew'][0][0]).toEqual({ p1: 'Surf', p2: '→ Mew', visits: 12 });
  });

  test('a row under the visits a line needs holds none, and a dead root holds no rows', () => {
    const thin = node(['A', 'B'], ['C'], [{ i: 0, j: 0, visits: 30 }, { i: 1, j: 0, visits: 7 }]);
    const lines = rowLines(thin, tops('A', 'C'));
    expect(Object.keys(lines.p1)).toEqual(['A']);
    expect(Object.keys(lines.p2)).toEqual(['C']);
    expect(rowLines(node(['A'], ['B'], [{ i: 0, j: 0, visits: 30 }], { ended: true }), { p1: [], p2: [] })).toEqual({ p1: {}, p2: {} });
  });

  test('a replacement step keeps the waiting label of the side that does not pick', () => {
    const root = node(['Surf'], ['Moonblast'], [{
      i: 0, j: 0, visits: 30,
      child: Object.assign(node(['(waiting)'], ['→ Mew', '→ Gyarados'], [{ i: 0, j: 1, visits: 14 }]), { boundary: false }),
    }]);
    expect(lineFrom(root, 0, 8).map(step => [step.p1, step.p2])).toEqual([['Surf', 'Moonblast'], ['(waiting)', '→ Gyarados']]);
  });

  test('principalVariation is the walk it was: the same steps on the same nodes', () => {
    for (const root of [deep(), node(['A'], ['B'], [{ i: 0, j: 0, visits: 7 }]), node(['A', 'B'], ['C', 'D'], [
      { i: 0, j: 1, visits: 11, child: node(['E'], ['F'], [{ i: 0, j: 0, visits: 8 }]) }, { i: 1, j: 0, visits: 11 },
    ])]) {
      expect(principalVariation(root)).toEqual(referenceVariation(root));
    }
  });
});

const sets = (names: [string, string[]][]): PokemonSet[] => names.map(([species, moves]) => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
}));

function board(format: string, p1: [string, string[]][], p2: [string, string[]][]): string {
  const battle = new Battle({ formatid: toID(format), seed: '1,2,3,4', p1: { name: 'Alpha', team: Teams.pack(sets(p1)) }, p2: { name: 'Beta', team: Teams.pack(sets(p2)) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 123456');
    battle.choose('p2', 'team 123456');
  }
  return JSON.stringify(State.serializeBattle(battle));
}

const SETTINGS: EvalSettings = { depth: 1, samples: 1, mode: 'mcts', tera: false };

describe('a tree ships its rows\' lines by label', () => {
  const singles = (order: number[]): string => {
    const bench: [string, string[]][] = [['Gyarados', ['Waterfall', 'Earthquake']], ['Mew', ['Psychic', 'Ice Beam']], ['Tyranitar', ['Crunch', 'Rock Slide']]];
    return board('gen9customgame', [['Machamp', ['Seismic Toss', 'Bulk Up']], ...order.map(index => bench[index])], [['Pikachu', ['Thunderbolt', 'Surf']], ['Eevee', ['Tackle', 'Quick Attack']]]);
  };

  test('singles: the labels of a reordered bench match, the line of a row keeps its labels', () => {
    const one = mctsTreeSearch(singles([0, 1, 2]), SETTINGS, 0);
    const other = mctsTreeSearch(singles([2, 0, 1]), SETTINGS, 0);
    expect(one.rowLines).toBeDefined();
    const labelsOf = (stats: typeof one): string[] => Object.keys(stats.rowLines!.p1).sort();
    expect(labelsOf(one)).toEqual(labelsOf(other));
    expect(labelsOf(one).length).toBeGreaterThan(0);
    for (const label of labelsOf(one)) {
      expect(one.rowLines!.p1[label][0].map(step => step.p1)).toEqual(other.rowLines!.p1[label][0].map(step => step.p1));
    }
  });

  test('doubles: every row of a line is a combined label of the tree\'s own options', () => {
    const team: [string, string[]][] = [['Incineroar', ['Fake Out', 'Flare Blitz']], ['Rillaboom', ['Grassy Glide', 'Wood Hammer']], ['Amoonguss', ['Spore', 'Rage Powder']], ['Urshifu', ['Close Combat', 'Sucker Punch']]];
    const stats = mctsTreeSearch(board('gen9doublescustomgame', team, team.slice().reverse()), { ...SETTINGS }, 0);
    const own = (side: 'p1' | 'p2') => new Set((side === 'p1' ? stats.p1Options : stats.p2Options).map(option => option.label));
    const lines = stats.rowLines!;
    expect(Object.keys(lines.p1).length).toBeGreaterThan(0);
    for (const side of ['p1', 'p2'] as const) {
      for (const label of Object.keys(lines[side])) expect(own(side).has(label), `${side} row ${label}`).toBe(true);
    }
    const top = stats.result.perSide.p1[0]?.label;
    if (top && lines.p1[top]) expect(lines.p1[top][0][0].p2).toBe(stats.result.perSide.p2[0].label);
    for (const side of ['p1', 'p2'] as const) {
      for (const [label, list] of Object.entries(lines[side])) {
        expect(list.length, `${side} ${label}`).toBeLessThanOrEqual(3);
        const answers = list.map(line => (side === 'p1' ? line[0].p2 : line[0].p1));
        expect(new Set(answers).size, `${side} ${label}: distinct answers`).toBe(answers.length);
      }
    }
  });
});

/**
 * A row keeps up to three lines, one against each of the tree's top three answers that holds the visits a line needs. The first is
 * the plain line. The reference below is `rowLines` with one line per row (against the tree's top row only): the first entry of
 * every row is held to it.
 */
function referenceRowLines(root: Node, tops: { p1?: string; p2?: string }): Record<'p1' | 'p2', Record<string, TreeLineStep[]>> {
  const out: Record<'p1' | 'p2', Record<string, TreeLineStep[]>> = { p1: {}, p2: {} };
  if (root.ended || root.p1Options.length === 0 || root.p2Options.length === 0) return out;
  const against = { p1: root.p2Options.findIndex(option => option.label === tops.p2), p2: root.p1Options.findIndex(option => option.label === tops.p1) };
  interface Held { key: number; visits: number; top: boolean }
  const held = { p1: new Map<number, Held>(), p2: new Map<number, Held>() };
  for (const [key, child] of root.children) {
    const i = Math.floor(key / 10_000);
    const j = key % 10_000;
    for (const [side, row, column] of [['p1', i, j], ['p2', j, i]] as const) {
      const cell: Held = { key, visits: child.visits, top: column === against[side] && child.visits >= 8 };
      const was = held[side].get(row);
      if (!was || (cell.top && !was.top) || (cell.top === was.top && cell.visits > was.visits)) held[side].set(row, cell);
    }
  }
  for (const side of ['p1', 'p2'] as const) {
    const options = side === 'p1' ? root.p1Options : root.p2Options;
    for (const [row, { key }] of held[side]) {
      const line = lineFrom(root, key, 8);
      if (line.length > 0 && !(options[row].label in out[side])) out[side][options[row].label] = line;
    }
  }
  return out;
}

const firsts = (lines: RowLines): Record<'p1' | 'p2', Record<string, TreeLineStep[]>> => ({
  p1: Object.fromEntries(Object.entries(lines.p1).map(([label, list]) => [label, list[0]])),
  p2: Object.fromEntries(Object.entries(lines.p2).map(([label, list]) => [label, list[0]])),
});

describe('lines against the tree\'s top three answers', () => {
  const wide = (): Node => node(['A', 'B'], ['X', 'Y', 'Z', 'W'], [
    { i: 0, j: 0, visits: 20, child: node(['A'], ['Y'], [{ i: 0, j: 0, visits: 9 }]) },
    { i: 0, j: 1, visits: 9 },
    { i: 0, j: 2, visits: 3 },
    { i: 0, j: 3, visits: 11 },
    { i: 1, j: 0, visits: 4 },
    { i: 1, j: 1, visits: 5 },
    { i: 1, j: 2, visits: 30 },
  ]);

  test('a row with cells at 20, 9 and 3 visits against the top three answers keeps two lines, today\'s first', () => {
    const lines = rowLines(wide(), { p1: ['A', 'B'], p2: ['X', 'Y', 'Z'] });
    expect(lines.p1.A).toHaveLength(2);
    expect(lines.p1.A.map(line => [line[0].p2, line[0].visits])).toEqual([['X', 20], ['Y', 9]]);
    // the first entry reads as before: the cell against the top row, then each node's pair (equal means here: the most visited options)
    expect(lines.p1.A[0].map(step => step.p2)).toEqual(['X', 'Y']);
    // the answer outside the top three (W, 11 visits) and the thin one (Z, 3 visits) hold no line
    expect(lines.p1.A.some(line => line[0].p2 === 'W' || line[0].p2 === 'Z')).toBe(false);
  });

  test('a row\'s answers are distinct: a heaviest-cell fallback that is also the second answer is kept once', () => {
    // B against the top answer X has 4 visits (too few), so its heaviest cell (against Z) stands in; Z is the third answer
    const lines = rowLines(wide(), { p1: ['A', 'B'], p2: ['X', 'Y', 'Z'] });
    expect(lines.p1.B.map(line => line[0].p2)).toEqual(['Z']);
    expect(lines.p1.B[0][0].visits).toBe(30);
  });

  test('the opponent\'s rows read the same cells against the answers of the first side\'s top three', () => {
    const lines = rowLines(wide(), { p1: ['A', 'B'], p2: ['X', 'Y', 'Z'] });
    // X meets A (20, the top answer) and B (4, too few for a second line)
    expect(lines.p2.X.map(line => line[0].p1)).toEqual(['A']);
    // Y meets A (9) as the first line, since its cell against the top row A has the visits
    expect(lines.p2.Y.map(line => [line[0].p1, line[0].visits])).toEqual([['A', 9]]);
  });

  test('at most three lines a row, and none against an answer that is not among the tops', () => {
    const lines = rowLines(wide(), { p1: ['A'], p2: ['X'] });
    expect(lines.p1.A).toHaveLength(1);
    const many = rowLines(wide(), { p1: ['A', 'B'], p2: ['X', 'Y', 'Z', 'W'] });
    expect(many.p1.A.length).toBeLessThanOrEqual(3);
  });

  test('the first entry of every row equals what the walk returned before the step, on every fixture', () => {
    const fixtures: [Node, { p1: string[]; p2: string[] }][] = [
      [wide(), { p1: ['A', 'B'], p2: ['X', 'Y', 'Z'] }],
      [wide(), { p1: ['B'], p2: ['Y'] }],
      [wide(), { p1: [], p2: [] }],
      [node(['Surf', 'Ice Beam'], ['Draining Kiss', '→ Mew'], [
        { i: 0, j: 0, visits: 40, child: node(['Surf'], ['Moonblast'], [{ i: 0, j: 0, visits: 9 }]) }, { i: 0, j: 1, visits: 12 }, { i: 1, j: 0, visits: 25 }, { i: 1, j: 1, visits: 5 },
      ]), { p1: ['Surf', 'Ice Beam'], p2: ['→ Mew', 'Draining Kiss'] }],
      [node(['A', 'B'], ['C'], [{ i: 0, j: 0, visits: 30 }, { i: 1, j: 0, visits: 7 }]), { p1: ['A'], p2: ['C'] }],
    ];
    for (const [root, top] of fixtures) {
      expect(firsts(rowLines(root, top))).toEqual(referenceRowLines(root, { p1: top.p1[0], p2: top.p2[0] }));
    }
  });

  test('the walk reads the tree and changes nothing in it', () => {
    const root = wide();
    const before = JSON.stringify([...root.children].map(([key, child]) => [key, child.visits]));
    rowLines(root, { p1: ['A', 'B'], p2: ['X', 'Y', 'Z'] });
    expect(JSON.stringify([...root.children].map(([key, child]) => [key, child.visits]))).toBe(before);
  });
});

/**
 * A line may stand on a cell with 4 visits, on every turn. The walk of the rows asks `LINE_MIN_VISITS` (4); the principal variation,
 * which the summary's ", then ..." prose reads, keeps its 8.
 */
describe('the line threshold of the rows is 4 visits, the principal variation keeps 8', () => {
  const thin = (): Node => node(['Surf', 'Ice Beam'], ['Draining Kiss', '→ Mew'], [
    { i: 0, j: 0, visits: 30, child: node(['Surf'], ['Moonblast'], [
      { i: 0, j: 0, visits: 5, child: node(['x'], ['y'], [{ i: 0, j: 0, visits: 4 }, { i: 0, j: 1, visits: 3 }]) },
    ]) },
    { i: 1, j: 0, visits: 4 },
    { i: 1, j: 1, visits: 3 },
  ]);

  test('the constant is 4 and the default of rowLines reads it', () => {
    expect(LINE_MIN_VISITS).toBe(4);
    const lines = rowLinesAt(thin(), tops('Surf', 'Draining Kiss'));
    expect(lines.p1.Surf[0].map(step => [step.p1, step.p2, step.visits])).toEqual([
      ['Surf', 'Draining Kiss', 30], ['Surf', 'Moonblast', 5], ['x', 'y', 4],
    ]);
  });

  test('a row\'s only cell with 4 visits is a line, one with 3 is none', () => {
    const lines = rowLinesAt(thin(), tops('Surf', 'Draining Kiss'));
    expect(lines.p1['Ice Beam'][0].map(step => step.visits)).toEqual([4]);
    // the only cell of the opponent's row → Mew has 3 visits: no line
    expect(Object.keys(lines.p2)).toEqual(['Draining Kiss']);
  });

  test('the same fixture at the old threshold holds a shorter line, and the walk of the rows is the principal variation\'s at 8', () => {
    const old = rowLinesAt(thin(), tops('Surf', 'Draining Kiss'), 8);
    expect(old.p1.Surf[0].map(step => step.visits)).toEqual([30]);
    expect(old.p1['Ice Beam']).toBeUndefined();
    expect(principalVariation(thin())).toEqual(referenceVariation(thin()));
    expect(principalVariation(thin())).toHaveLength(1);
  });
});

/**
 * Beside the lines against its top three answers a row keeps the line through the cell of the answer the caller names as the row's
 * floor (`floors`, by row label), when that cell holds the visits a line needs. The rows' own lists stay what they were: the donors
 * of the plain request read them, and the setting's lines must not move them.
 */
describe('the line through a row\'s floor cell', () => {
  const deep = (): Node => node(['Surf', 'Ice Beam'], ['Draining Kiss', '→ Mew'], [
    { i: 0, j: 0, visits: 40 }, { i: 0, j: 1, visits: 12 }, { i: 1, j: 0, visits: 25 }, { i: 1, j: 1, visits: 5 },
  ]);

  test('a floor cell with the visits is kept as the row\'s floor line, on both sides, the rows\' own lists unchanged', () => {
    const plain = rowLinesAt(deep(), tops('Surf', 'Draining Kiss'), 8);
    const lines = rowLinesAt(deep(), tops('Surf', 'Draining Kiss'), 8, { p1: { Surf: '→ Mew' }, p2: { 'Draining Kiss': 'Ice Beam' } });
    expect(lines.floor?.p1.Surf.map(step => [step.p1, step.p2, step.visits])).toEqual([['Surf', '→ Mew', 12]]);
    expect(lines.floor?.p2['Draining Kiss'].map(step => [step.p1, step.p2, step.visits])).toEqual([['Ice Beam', 'Draining Kiss', 25]]);
    expect({ p1: lines.p1, p2: lines.p2 }).toEqual(plain);
  });

  test('a floor cell under the visits, an unknown answer and no floors keep nothing: the result has no floor key', () => {
    const thinFloor = rowLinesAt(deep(), tops('Surf', 'Draining Kiss'), 8, { p1: { 'Ice Beam': '→ Mew' } });
    expect(thinFloor.floor).toBeUndefined();
    expect(rowLinesAt(deep(), tops('Surf', 'Draining Kiss'), 8, { p1: { Surf: 'Moonblast' } }).floor).toBeUndefined();
    expect(Object.keys(rowLinesAt(deep(), tops('Surf', 'Draining Kiss'), 8))).toEqual(['p1', 'p2']);
  });
});

/**
 * The later steps of a row's line read each node by value. Each side takes its best mean (p1 the highest, p2 the lowest, both in
 * p1's view) among its options with `min` visits and a quarter of the node's most visited option; the step is that pair's cell
 * when it holds `min` visits, else the node's heaviest cell. The first step stays the row's cell. The principal variation keeps the
 * heaviest cell. Scene (655336 turn 25): Roost draws most of the visits at a lower mean than Dragon Claw.
 */
describe('the later steps of a row\'s line read each node by value', () => {
  /** Charizard (p1) below Dragon Dance/High Jump Kick: Roost is the heaviest option and the heaviest cell, Dragon Claw the better mean. */
  const turn25 = (): Node => node(['Dragon Claw', 'Roost'], ['Encore', 'Return 102'], [
    { i: 0, j: 0, visits: 31 }, { i: 0, j: 1, visits: 10 }, { i: 1, j: 0, visits: 22 }, { i: 1, j: 1, visits: 40 },
  ], {}, { p1: { 0: 0.55, 1: 0.43 }, p2: { 0: 0.42, 1: 0.5 } });
  const rootOf = (child: Node): Node => node(['Dragon Dance'], ['High Jump Kick'], [{ i: 0, j: 0, visits: 90, child }]);
  const second = (root: Node, min = 4): string[] => {
    const line = rowLinesAt(root, tops('Dragon Dance', 'High Jump Kick'), min).p1['Dragon Dance'][0];
    return [line[1].p1, line[1].p2];
  };

  test('singles: the step is the best-mean pair, not the heaviest cell', () => {
    expect(second(rootOf(turn25()))).toEqual(['Dragon Claw', 'Encore']);
    // the heaviest cell of the node is Roost against Return 102, and the principal variation still walks it
    expect(principalVariation(rootOf(turn25())).map(step => [step.p1, step.p2])).toEqual([['Dragon Dance', 'High Jump Kick'], ['Roost', 'Return 102']]);
  });

  test('doubles: the same rule on combined labels', () => {
    const own = ['Fake Out + Flare Blitz', 'Protect + Wood Hammer', 'Fake Out + Wood Hammer'];
    const other = ['Spore + Rage Powder', 'Close Combat + Sucker Punch'];
    const below = node(own, other, [
      { i: 0, j: 0, visits: 12 }, { i: 0, j: 1, visits: 9 }, { i: 1, j: 0, visits: 6 }, { i: 1, j: 1, visits: 30 }, { i: 2, j: 0, visits: 5 },
    ], {}, { p1: { 0: 0.6, 1: 0.4, 2: 0.7 }, p2: { 0: 0.45, 1: 0.5 } });
    // Fake Out + Wood Hammer has the best mean (0.7) but 5 of 56 visits is under a quarter of the heaviest option's 39 visits (10)
    const line = rowLinesAt(rootOf(below), tops('Dragon Dance', 'High Jump Kick'), 4).p1['Dragon Dance'][0];
    expect([line[1].p1, line[1].p2]).toEqual(['Fake Out + Flare Blitz', 'Spore + Rage Powder']);
  });

  test('p2 takes its lowest mean, ties go to the more visited option, then to the hint order', () => {
    const tied = node(['A', 'B'], ['X', 'Y', 'Z'], [
      { i: 0, j: 0, visits: 10 }, { i: 0, j: 1, visits: 12 }, { i: 0, j: 2, visits: 12 }, { i: 1, j: 0, visits: 10 }, { i: 1, j: 1, visits: 12 }, { i: 1, j: 2, visits: 12 },
    ], {}, { p1: { 0: 0.5, 1: 0.5 }, p2: { 0: 0.3, 1: 0.3, 2: 0.3 } });
    // p1 ties on mean and on visits (44 each): the first in hint order; p2 ties on mean: Y and Z hold 24 visits against X's 20
    expect(second(rootOf(tied))).toEqual(['A', 'Y']);
    tied.p2Order = [2, 1, 0];
    expect(second(rootOf(tied))).toEqual(['A', 'Z']);
  });

  test('an option under the visits a line needs, or under a quarter of the heaviest option, is not read', () => {
    const thinBest = node(['A', 'B', 'C'], ['X'], [{ i: 0, j: 0, visits: 3 }, { i: 1, j: 0, visits: 40 }, { i: 2, j: 0, visits: 12 }], {}, { p1: { 0: 0.9, 1: 0.5, 2: 0.6 } });
    expect(second(rootOf(thinBest))).toEqual(['C', 'X']);
    const light = node(['A', 'B'], ['X'], [{ i: 0, j: 0, visits: 9 }, { i: 1, j: 0, visits: 40 }], {}, { p1: { 0: 0.9, 1: 0.5 } });
    expect(second(rootOf(light))).toEqual(['B', 'X']);
  });

  test('a pair whose cell is thin or absent falls back to the node\'s heaviest cell', () => {
    // A and X are the best means with the visits, but their cell holds 3 visits; B against Y is the heaviest cell
    const thinCell = node(['A', 'B'], ['X', 'Y'], [
      { i: 0, j: 0, visits: 3 }, { i: 0, j: 1, visits: 10 }, { i: 1, j: 0, visits: 10 }, { i: 1, j: 1, visits: 20 },
    ], {}, { p1: { 0: 0.6, 1: 0.4 }, p2: { 0: 0.3, 1: 0.5 } });
    expect(second(rootOf(thinCell))).toEqual(['B', 'Y']);
  });

  test('the first step stays the row\'s cell, the floor lines read the same rule, and the tree is left as it was', () => {
    const root = rootOf(turn25());
    const lines = rowLinesAt(root, tops('Dragon Dance', 'High Jump Kick'), 4, { p1: { 'Dragon Dance': 'High Jump Kick' } });
    expect(lines.floor?.p1['Dragon Dance'].map(step => [step.p1, step.p2])).toEqual([['Dragon Dance', 'High Jump Kick'], ['Dragon Claw', 'Encore']]);
    const before = JSON.stringify([...root.children].map(([key, child]) => [key, child.visits, child.p1N, child.p1W]));
    rowLinesAt(root, tops('Dragon Dance', 'High Jump Kick'));
    expect(JSON.stringify([...root.children].map(([key, child]) => [key, child.visits, child.p1N, child.p1W]))).toBe(before);
  });

  test('lineFrom without the flag is the walk of visits: the line pass and the principal variation read it', () => {
    const line = lineFrom(rootOf(turn25()), 0, 4);
    expect(line.map(step => [step.p1, step.p2])).toEqual([['Dragon Dance', 'High Jump Kick'], ['Roost', 'Return 102']]);
  });
});

describe('real trees: the later steps follow the rule, the principal variation stays the walk of visits', () => {
  /** The rule written again from the node's own tallies, independent of the walk's code. */
  function expectedStep(node: Node, min: number): [string, string] | null {
    const eligible = (n: number[]): number[] => n.map((visits, index) => (visits >= min && visits * 4 >= Math.max(...n) ? index : -1)).filter(index => index >= 0);
    const best = (n: number[], w: number[], order: number[], sign: 1 | -1): number => eligible(n).sort((a, b) =>
      sign * (w[b] / n[b] - w[a] / n[a]) || n[b] - n[a] || order.indexOf(a) - order.indexOf(b))[0];
    const i = best(node.p1N, node.p1W, node.p1Order, 1);
    const j = best(node.p2N, node.p2W, node.p2Order, -1);
    const cell = i === undefined || j === undefined ? undefined : node.children.get(cellKey(i, j));
    if (cell && cell.visits >= min) return [node.p1Options[i].label, node.p2Options[j].label];
    let heavy: [number, number] | null = null;
    let most = 0;
    for (const [key, child] of node.children) if (child.visits > most) { most = child.visits; heavy = [Math.floor(key / 10_000), key % 10_000]; }
    return heavy && most >= min ? [node.p1Options[heavy[0]].label, node.p2Options[heavy[1]].label] : null;
  }

  const SINGLES: [string, string[]][] = [['Machamp', ['Seismic Toss', 'Bulk Up']], ['Gyarados', ['Waterfall', 'Earthquake']], ['Mew', ['Psychic', 'Ice Beam']]];
  const FOES: [string, string[]][] = [['Pikachu', ['Thunderbolt', 'Surf']], ['Eevee', ['Tackle', 'Quick Attack']]];
  const DOUBLES: [string, string[]][] = [['Incineroar', ['Fake Out', 'Flare Blitz']], ['Rillaboom', ['Grassy Glide', 'Wood Hammer']], ['Amoonguss', ['Spore', 'Rage Powder']], ['Urshifu', ['Close Combat', 'Sucker Punch']]];
  const cases: [string, string, [string, string[]][], [string, string[]][]][] = [
    ['singles', 'gen9customgame', SINGLES, FOES], ['doubles', 'gen9doublescustomgame', DOUBLES, DOUBLES.slice().reverse()],
  ];

  for (const [name, format, p1, p2] of cases) {
    test(`${name}: every second step of every row's line is the rule's pair, and principalVariation equals the walk of visits`, () => {
      const root = mctsRoot(board(format, p1, p2), { ...SETTINGS }, 0);
      expect(principalVariation(root)).toEqual(referenceVariation(root));
      const tops3 = { p1: [root.p1Options[0].label], p2: [root.p2Options[0].label] };
      let checked = 0;
      for (const side of ['p1', 'p2'] as const) {
        for (const lines of Object.values(rowLinesAt(root, tops3)[side])) {
          for (const line of lines) {
            const first = [...root.children].find(([key]) => root.p1Options[Math.floor(key / 10_000)].label === line[0].p1 && root.p2Options[key % 10_000].label === line[0].p2);
            const below = first?.[1];
            if (!below || line.length < 2) continue;
            expect([line[1].p1, line[1].p2], `${side} ${line[0].p1} / ${line[0].p2}`).toEqual(expectedStep(below, LINE_MIN_VISITS));
            checked += 1;
          }
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});
