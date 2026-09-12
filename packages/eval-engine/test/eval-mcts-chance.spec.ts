import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createRootPosition } from '../src/forward-model';
import { mctsRoot, mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees } from '../src/mcts-merge';
import { cellKey } from '../src/rank';
import { chanceValue, isChanceNode, type ChanceNode, type TreeChild } from '../src/search/chance-node';
import { treeMatrix, type Node } from '../src/search/mcts-node';

/**
 * Round 43: chance nodes in the first two plies. A boundary cell with a
 * class plan expands into one child per outcome class, the descent
 * follows the largest deficit, the cell reads as the weighted blend, and
 * doubles pairs group empirically by who fell.
 */

function makeSet(name: string, species: string, moves: string[], level = 100): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(formatid: string, p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

function serializeAt(battle: Battle, hp: [number | null, number | null]): string {
  hp.forEach((value, index) => { if (value !== null) battle.sides[index].active[0]!.sethp(value); });
  return JSON.stringify(State.serializeBattle(battle));
}

const SETTINGS = { depth: 1 as const, samples: 1 as const, tera: false as const, mode: 'mcts' as const, prove: false };

/**
 * Jolteon's 70 % Thunder against a one-HP Machamp whose Seismic Toss cannot
 * knock Jolteon out (fixed 100 damage): the hit class opens p2's switch
 * request, the miss class reaches the turn boundary. Both sides keep a
 * bench so no class ends the game.
 */
const thunderRoot = () => createRootPosition(serializeAt(makeBattle('gen9customgame',
  [makeSet('Jolt', 'Jolteon', ['Thunder', 'Thunderbolt']), makeSet('Lax', 'Snorlax', ['Body Slam'])],
  [makeSet('Champ', 'Machamp', ['Seismic Toss']), makeSet('Egg', 'Chansey', ['Soft-Boiled'])]), [null, 1]));
const THUNDER = 'move thunder';
const TOSS = 'move seismictoss';

function cellOf(root: Node, p1Choice: string, p2Choice: string): { key: number; child: TreeChild | undefined } {
  const i = root.p1Options.findIndex(option => option.choice === p1Choice);
  const j = root.p2Options.findIndex(option => option.choice === p2Choice);
  expect(i).toBeGreaterThanOrEqual(0);
  expect(j).toBeGreaterThanOrEqual(0);
  return { key: cellKey(i, j), child: root.children.get(cellKey(i, j)) };
}

/** Every chance node with the boundary depth of the decision node that owns it (root = 1). */
function chanceNodes(node: Node, depth = 1, found: { depth: number; node: ChanceNode }[] = []): { depth: number; node: ChanceNode }[] {
  for (const child of node.children.values()) {
    if (isChanceNode(child)) {
      found.push({ depth, node: child });
      for (const cls of child.classes) chanceNodes(cls.child, depth + (cls.child.boundary ? 1 : 0), found);
    } else {
      chanceNodes(child, depth + (child.boundary ? 1 : 0), found);
    }
  }
  return found;
}

describe('MCTS chance nodes (round 43)', () => {
  test('the Thunder cell is a chance node with the hit-kill and miss classes; the kill is a mid-turn child', () => {
    const root = mctsRoot(thunderRoot().serialized, SETTINGS);
    const { child } = cellOf(root, THUNDER, TOSS);
    expect(child).toBeDefined();
    expect(isChanceNode(child!)).toBe(true);
    const chance = child as ChanceNode;
    expect(chance.classes.map(cls => cls.key)).toEqual(['hit-kill', 'miss']);
    expect(chance.classes.map(cls => Number(cls.weight.toFixed(6)))).toEqual([0.7, 0.3]);
    expect(chance.classes[0].child.boundary).toBe(false); // the knock-out waits for p2's replacement
    expect(chance.classes[1].child.boundary).toBe(true);
  });

  test('class visits follow the weights within one visit and the cell reads as the blend', () => {
    const root = mctsRoot(thunderRoot().serialized, SETTINGS);
    const { key, child } = cellOf(root, THUNDER, TOSS);
    const chance = child as ChanceNode;
    const descents = chance.visits - 1;
    expect(descents).toBeGreaterThan(10);
    for (const cls of chance.classes) expect(Math.abs(cls.visits - cls.weight * descents)).toBeLessThanOrEqual(1);
    const i = Math.floor(key / 10_000);
    const j = key % 10_000;
    expect(treeMatrix(root).values[i][j]).toBeCloseTo(chanceValue(chance), 12);
  });

  test('chance nodes stop after the second ply; the miss child carries its own', () => {
    const root = mctsRoot(thunderRoot().serialized, SETTINGS);
    const found = chanceNodes(root);
    expect(found.length).toBeGreaterThan(1);
    expect(found.every(entry => entry.depth <= 2)).toBe(true);
    const { child } = cellOf(root, THUNDER, TOSS);
    const miss = (child as ChanceNode).classes.find(cls => cls.key === 'miss')!.child;
    expect([...miss.children.values()].some(isChanceNode)).toBe(true);
  });

  test('the tree stats ship the classes of a root chance cell with bare keys', () => {
    const stats = mctsTreeSearch(thunderRoot().serialized, SETTINGS, 0);
    const i = stats.p1Options.findIndex(option => option.choice === THUNDER);
    const j = stats.p2Options.findIndex(option => option.choice === TOSS);
    const cell = stats.cells.find(entry => entry.key === cellKey(i, j))!;
    expect(cell.classes?.map(cls => cls.key)).toEqual(['hit-kill', 'miss']);
    expect(cell.classes!.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(1, 9);
    expect(cell.classKey).toBeUndefined();
    expect(cell.visits).toBe(cell.classes!.reduce((sum, cls) => sum + cls.visits, 0) + 1);
    // Cell-level total and value keep the visit-mean shape for the merge's old readers.
    expect(Number.isFinite((cell.total + cell.value) / (cell.visits + 1))).toBe(true);
  });

  test('two trees with the same offset are identical; different offsets still merge and rank every row', () => {
    const serialized = thunderRoot().serialized;
    const a = mctsTreeSearch(serialized, SETTINGS, 0);
    const b = mctsTreeSearch(serialized, SETTINGS, 0);
    expect(b.cells).toEqual(a.cells);
    expect({ n: b.p1N, w: b.p1W }).toEqual({ n: a.p1N, w: a.p1W });
    const trees = [0, 1, 2, 3].map(offset => mctsTreeSearch(serialized, SETTINGS, offset));
    const merged = mergeMctsTrees(trees);
    expect(merged.perSide.p1.map(row => row.choice).sort()).toEqual(trees[0].p1Options.map(option => option.choice).sort());
    expect(merged.perSide.p2.map(row => row.choice).sort()).toEqual(trees[0].p2Options.map(option => option.choice).sort());
  });

  test('doubles: root cells with a knock-out range group empirically by who fell', () => {
    const root = createRootPosition(serializeAt(makeBattle('gen9doublescustomgame',
      [makeSet('Jolt', 'Jolteon', ['Thunder']), makeSet('Lax', 'Snorlax', ['Protect'])],
      [makeSet('Champ', 'Machamp', ['Seismic Toss']), makeSet('Egg', 'Chansey', ['Soft-Boiled']), makeSet('Bliss', 'Blissey', ['Soft-Boiled'])]), [null, 1]));
    const node = mctsRoot(root.serialized, SETTINGS);
    const chance = [...node.children.values()].filter(isChanceNode);
    // Thunder (70 %) into a one-HP Machamp: at least one root cell splits its three seeds by the faint signature.
    expect(chance.length).toBeGreaterThan(0);
    for (const child of chance) {
      expect(child.classes.every(cls => Number.isInteger(Math.round(cls.weight * 3 * 1e6) / 1e6))).toBe(true);
      expect(child.classes.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(1, 9);
      expect(child.classes.every(cls => cls.key === '' || cls.key.includes('p2a: Champ') || cls.key.endsWith('|end'))).toBe(true);
    }
    const stats = mctsTreeSearch(root.serialized, SETTINGS, 0);
    expect(stats.depth).toBeGreaterThanOrEqual(2);
    expect(stats.cells.some(cell => cell.classes && cell.classes.length > 1)).toBe(true);
  });
});
