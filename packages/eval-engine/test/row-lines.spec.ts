import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { mctsTreeSearch } from '../src/mcts';
import { cellKey } from '../src/rank';
import { lineFrom, principalVariation, rowLines, type Node } from '../src/search/mcts-node';
import type { EvalSettings } from '../src/types';

/**
 * Round 89 (#104), step G2: the line of a root row. Synthetic nodes by hand (only the fields the walk reads): the row's first cell is
 * the one against the opponent's top row once it has 8 visits, else the row's heaviest cell; a step under 8 visits ends the line;
 * three steps at most; a replacement step keeps the waiting label. `principalVariation` returns what it always returned (the
 * reference below is the walk as it stood before the rows had lines). Rows are keyed by label: a reordered bench moves the choice
 * strings and not the labels (singles and doubles boards).
 */

interface Cell { i: number; j: number; visits: number; child?: Node }

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
    const lines = rowLines(deep(), { p1: 'Surf', p2: 'Draining Kiss' });
    expect(lines.p1.Surf.map(step => [step.p1, step.p2, step.visits])).toEqual([
      ['Surf', 'Draining Kiss', 40], ['→ Gyarados', 'Draining Kiss', 20], ['Surf', 'Moonblast', 9],
    ]);
    expect(lines.p1['Ice Beam'].map(step => step.p2)[0]).toBe('Draining Kiss');
  });

  test('a row whose cell against the top row is thin takes its heaviest cell', () => {
    const lines = rowLines(deep(), { p1: 'Surf', p2: '→ Mew' });
    // Surf against → Mew has 12 visits (enough): the line starts there
    expect(lines.p1.Surf.map(step => step.p2)).toEqual(['→ Mew']);
    // Ice Beam against → Mew has 5 (too few): its heaviest cell, against Draining Kiss, stands in
    expect(lines.p1['Ice Beam'].map(step => step.p2)).toEqual(['Draining Kiss']);
  });

  test('the opponent\'s rows read the same cells from their side', () => {
    const lines = rowLines(deep(), { p1: 'Surf', p2: 'Draining Kiss' });
    expect(lines.p2['Draining Kiss'][0]).toEqual({ p1: 'Surf', p2: 'Draining Kiss', visits: 40 });
    expect(lines.p2['→ Mew'][0]).toEqual({ p1: 'Surf', p2: '→ Mew', visits: 12 });
  });

  test('a row under the visits a line needs holds none, and a dead root holds no rows', () => {
    const thin = node(['A', 'B'], ['C'], [{ i: 0, j: 0, visits: 30 }, { i: 1, j: 0, visits: 7 }]);
    const lines = rowLines(thin, { p1: 'A', p2: 'C' });
    expect(Object.keys(lines.p1)).toEqual(['A']);
    expect(Object.keys(lines.p2)).toEqual(['C']);
    expect(rowLines(node(['A'], ['B'], [{ i: 0, j: 0, visits: 30 }], { ended: true }), {})).toEqual({ p1: {}, p2: {} });
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
      expect(one.rowLines!.p1[label].map(step => step.p1)).toEqual(other.rowLines!.p1[label].map(step => step.p1));
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
    if (top && lines.p1[top]) expect(lines.p1[top][0].p2).toBe(stats.result.perSide.p2[0].label);
  });
});
