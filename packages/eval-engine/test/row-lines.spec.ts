import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { mctsTreeSearch } from '../src/mcts';
import { cellKey } from '../src/rank';
import { lineFrom, principalVariation, rowLines, type Node } from '../src/search/mcts-node';
import type { EvalSettings, RowLines, TreeLineStep } from '../src/types';

/**
 * Round 89 (#104), step G2: the line of a root row. Synthetic nodes by hand (only the fields the walk reads): the row's first cell is
 * the one against the opponent's top row once it has 8 visits, else the row's heaviest cell; a step under 8 visits ends the line;
 * three steps at most; a replacement step keeps the waiting label. `principalVariation` returns what it always returned (the
 * reference below is the walk as it stood before the rows had lines). Rows are keyed by label: a reordered bench moves the choice
 * strings and not the labels (singles and doubles boards).
 */

interface Cell { i: number; j: number; visits: number; child?: Node }

/** The tops a tree reports: each side's best rows by label, best first (one name each in the older fixtures). */
const tops = (p1: string, p2: string, ...more: string[]): { p1: string[]; p2: string[] } => ({ p1: [p1], p2: [p2, ...more] });

const options = (labels: string[]) => labels.map((label, index) => ({ choice: `move ${index + 1}`, label }));

function node(p1: string[], p2: string[], cells: Cell[], extra: Partial<Node> = {}): Node {
  const children = new Map<number, Node>();
  for (const cell of cells) {
    const child = cell.child ?? node([], [], []);
    child.visits = cell.visits;
    children.set(cellKey(cell.i, cell.j), child);
  }
  return {
    kind: 'decision', ended: false, boundary: true, p1Options: options(p1), p2Options: options(p2), children, visits: 0, ...extra,
  } as unknown as Node;
}

/** The walk as it stood before round 89: kept here so the shared walk is held to it. */
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

  test('the first cell is the one against the opponent\'s top row, then the heaviest cell of each node, three steps at most', () => {
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
    expect(lineFrom(root, 0).map(step => [step.p1, step.p2])).toEqual([['Surf', 'Moonblast'], ['(waiting)', '→ Gyarados']]);
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
    // a row keeps at most three lines, each against another answer
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
 * Round 89 (#104), step G12 (ruling G8a): a row keeps up to three lines, one against each of the tree's top three answers that holds
 * the visits a line needs. The first is the line the tree always kept; the others are new. The reference below is `rowLines` as it
 * stood before the step (one line per row, against the tree's top row only): the first entry of every row is held to it.
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
      const line = lineFrom(root, key);
      if (line.length > 0 && !(options[row].label in out[side])) out[side][options[row].label] = line;
    }
  }
  return out;
}

/** The first entry of every row of a result of the new walk, as the old walk returns it. */
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
    // the first entry reads as before: the cell against the top row, then the heaviest cell of each node
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
