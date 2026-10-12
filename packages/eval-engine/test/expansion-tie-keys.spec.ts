import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { advancePositionWithLog, createRootPosition, positionBattle, type SimPosition } from '../src/forward-model';
import { createMatchupCache } from '../src/eval-function';
import { mctsTreeSearch } from '../src/mcts';
import { cellKey } from '../src/rank';
import { cellContribution } from '../src/search/merge-pool';
import { sampleCell } from '../src/search/cell-sampler';
import { SEARCH_SEEDS, treeSeed } from '../src/search/leaf';
import { classifyChild, planCellEvents } from '../src/cell-blend';
import { doublesRoot, pairSet } from './pair-battles';

/**
 * Round 69 (T146 part c5): the tree records the class of a root cell it drew so that the merge pools only the trees
 * that drew the same class. A tied singles cell's sampler classes carry the order prefix (`p1:hit-kill|none`, part c4),
 * so a tree that drew the cell in non-chance mode has to name the order it saw, or its pool matches no class and the
 * merge takes the sampler's class mean. The reference is the simulator's own log for the seed the tree used.
 */

const cache = createMatchupCache();
const SETTINGS = { depth: 1 as const, samples: 1 as const, tera: false as const, mode: 'mcts' as const, prove: false };

const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
});

/** Two Jolteon at 1 HP and equal speed with a bench each, so no class ends the game. */
function thunderTie(setup: (battle: Battle) => void = () => {}): SimPosition {
  const battle = new Battle({
    formatid: toID('gen9customgame'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack([set('Jolteon', ['Thunder']), set('Snorlax', ['Body Slam'])]) },
    p2: { name: 'Beta', team: Teams.pack([set('Jolteon', ['Thunder']), set('Chansey', ['Soft-Boiled'])]) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 12');
    battle.choose('p2', 'team 12');
  }
  for (const side of battle.sides) side.active[0]!.sethp(1);
  setup(battle);
  return createRootPosition(JSON.stringify(State.serializeBattle(battle)));
}

/**
 * The keys the simulator gives the cell over the seeds a tree of this offset can draw it with (the iteration that
 * first reaches the cell is not fixed): the first mover's side and the class of the log, as the sampler writes them.
 */
function drawnKeys(root: SimPosition, p1: string, p2: string, offset: number): Set<string> {
  const plan = planCellEvents(positionBattle(root), p1, p2);
  if (plan.kind !== 'events') throw new Error('the cell has no class plan');
  const keys = new Set<string>();
  for (let iteration = 0; iteration < SEARCH_SEEDS.length; iteration++) {
    const { log } = advancePositionWithLog(root, p1, p2, treeSeed(iteration, offset));
    const first = log.find(line => line.startsWith('|move|'))!.startsWith('|move|p1a:') ? 'p1' : 'p2';
    keys.add(`${first}:${classifyChild(log, plan.events)}`);
  }
  return keys;
}

describe('tree class keys of a tied cell (T146 c5)', () => {
  test('singles: a tree names the order it drew, and the key is one of the sampler classes', () => {
    const root = thunderTie();
    const [p1, p2] = ['move thunder', 'move thunder'];
    const sampled = sampleCell(root, 0, p1, p2, 3, cache, true).blend!.classes.map(cls => cls.key);
    const orders = new Set<string>();
    for (let offset = 0; offset < 12; offset++) {
      const stats = mctsTreeSearch(root.serialized, SETTINGS, offset);
      const i = stats.p1Options.findIndex(option => option.choice === p1);
      const j = stats.p2Options.findIndex(option => option.choice === p2);
      const cell = stats.cells.find(entry => entry.key === cellKey(i, j))!;
      expect(cell.classKey).toBeDefined();
      expect(drawnKeys(root, p1, p2, offset)).toContain(cell.classKey);
      expect(sampled).toContain(cell.classKey);
      // The merge's pool for the sampler class of that key joins this tree.
      expect(cellContribution(cell, cell.classKey, false)).not.toBeNull();
      orders.add(cell.classKey!.slice(0, 2));
    }
    expect(orders).toEqual(new Set(['p1', 'p2']));
  });

  test('singles: a pair without a tie keeps its bare class key', () => {
    const root = thunderTie(battle => { battle.sides[0].active[0]!.boosts.spe = 1; });
    const [p1, p2] = ['move thunder', 'move thunder'];
    const sampled = sampleCell(root, 0, p1, p2, 3, cache, true).blend!.classes.map(cls => cls.key);
    const stats = mctsTreeSearch(root.serialized, SETTINGS, 0);
    const i = stats.p1Options.findIndex(option => option.choice === p1);
    const j = stats.p2Options.findIndex(option => option.choice === p2);
    const cell = stats.cells.find(entry => entry.key === cellKey(i, j))!;
    expect(cell.classKey).toBeDefined();
    expect(cell.classKey).not.toMatch(/^p[12]:/);
    expect(sampled).toContain(cell.classKey);
  });

  test('doubles: a tied pair has no analytic plan, so the tree records no class key', () => {
    const mon = () => pairSet('Jolt', 'Jolteon', ['Thunder'], { level: 100 });
    const root = doublesRoot([mon(), pairSet('Lax', 'Snorlax', ['Body Slam'])], [mon(), pairSet('Egg', 'Chansey', ['Soft-Boiled'])]);
    const stats = mctsTreeSearch(root.serialized, SETTINGS, 0);
    expect(stats.cells.length).toBeGreaterThan(0);
    expect(stats.cells.every(cell => cell.classKey === undefined)).toBe(true);
  });
});
