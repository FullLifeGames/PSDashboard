import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import {
  advancePositionWithLog, createRootPosition, legalChoices, positionBattle,
} from '../src/forward-model';
import { mctsRoot, mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees } from '../src/mcts-merge';
import { cellKey } from '../src/rank';
import type { Node } from '../src/search/mcts-node';

/**
 * Round 42: forced switches as decision nodes. The forward model's
 * stop-at-request mode, the doubles assignments with passes, and the
 * MCTS tree's mid-turn nodes (boundary flag, depth in turns, determinism).
 */

function makeSet(name: string, species: string, moves: string[], level = 50): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
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

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));

/** Electrode explodes into Snorlax: a certain knock-out of p1's active, bench Pichu and Blissey. */
const explosionRoot = () => createRootPosition(serialize(makeBattle('gen9customgame',
  [
    makeSet('Electrode', 'Electrode', ['Explosion']),
    makeSet('Pichu', 'Pichu', ['Protect']),
    makeSet('Blissey', 'Blissey', ['Protect']),
  ],
  [makeSet('Snorlax', 'Snorlax', ['Protect', 'Substitute'])],
)));

describe('forward model: stop at the forced-switch request (round 42)', () => {
  test('a knock-out halts at the request; the greedy default still reaches the boundary', () => {
    const root = explosionRoot();
    const stopped = advancePositionWithLog(root, 'move explosion', 'move substitute', '1,2,3,4', { stopAtForcedSwitch: true });
    expect(stopped.pendingSwitch).toBe(true);
    expect(stopped.log.some(line => line.startsWith('|faint|p1a'))).toBe(true);
    expect(legalChoices(stopped.child, 'p1').map(option => option.choice)).toEqual(['switch 2', 'switch 3']);
    expect(legalChoices(stopped.child, 'p2')).toEqual([{ choice: 'wait', label: '(waiting)' }]);

    const greedy = advancePositionWithLog(root, 'move explosion', 'move substitute', '1,2,3,4');
    expect(greedy.pendingSwitch).toBe(false);
    expect(positionBattle(greedy.child).turn).toBe(2);

    // The next step from the mid-turn child plays the replacement and reaches the boundary.
    const resumed = advancePositionWithLog(stopped.child, 'switch 3', 'wait', '1,2,3,4', { stopAtForcedSwitch: true });
    expect(resumed.pendingSwitch).toBe(false);
    const resumedBattle = positionBattle(resumed.child);
    expect(resumedBattle.turn).toBe(2);
    expect(resumedBattle.sides[0].active[0]!.name).toBe('Blissey');
    expect(resumedBattle.sides.every(side => side.requestState === 'move')).toBe(true);
  });

  test('a pivot follow-up is answered before the stop; the knocked-out target then becomes the node', () => {
    // No knock-out: the follow-up alone resolves the turn.
    const quiet = createRootPosition(serialize(makeBattle('gen9customgame',
      [makeSet('Scyther', 'Scyther', ['U-turn']), makeSet('Pichu', 'Pichu', ['Protect'])],
      [makeSet('Snorlax', 'Snorlax', ['Protect', 'Substitute'])],
    )));
    const quietStep = advancePositionWithLog(quiet, 'move uturn > switch 2', 'move substitute', '1,2,3,4', { stopAtForcedSwitch: true });
    expect(quietStep.pendingSwitch).toBe(false);
    expect(positionBattle(quietStep.child).sides[0].active[0]!.name).toBe('Pichu');
    expect(positionBattle(quietStep.child).turn).toBe(2);

    // Knock-out: the sim asks the pivot side first (answered by the follow-up),
    // then the fallen side — that request stays open as the node.
    const lethal = createRootPosition(serialize(makeBattle('gen9customgame',
      [makeSet('Scyther', 'Scyther', ['U-turn'], 100), makeSet('Pichu', 'Pichu', ['Protect'], 100)],
      [makeSet('Pikachu', 'Pikachu', ['Tackle'], 5), makeSet('Eevee', 'Eevee', ['Tackle'], 5)],
    )));
    const lethalStep = advancePositionWithLog(lethal, 'move uturn > switch 2', 'move tackle', '1,2,3,4', { stopAtForcedSwitch: true });
    expect(lethalStep.pendingSwitch).toBe(true);
    const mid = positionBattle(lethalStep.child);
    expect(mid.sides[0].active[0]!.name).toBe('Pichu');
    expect(legalChoices(lethalStep.child, 'p1')).toEqual([{ choice: 'wait', label: '(waiting)' }]);
    expect(legalChoices(lethalStep.child, 'p2').map(option => option.choice)).toEqual(['switch 2']);
    const done = advancePositionWithLog(lethalStep.child, 'wait', 'switch 2', '1,2,3,4', { stopAtForcedSwitch: true });
    expect(done.pendingSwitch).toBe(false);
    expect(positionBattle(done.child).sides[1].active[0]!.name).toBe('Eevee');
  });
});

/** Doubles: Machamp and Snorlax knock out both p2 actives; the bench holds `benchNames`. */
const doubleKoRoot = (benchNames: string[]) => createRootPosition(serialize(makeBattle('gen9doublescustomgame',
  [
    makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100),
    makeSet('Snorlax', 'Snorlax', ['Seismic Toss', 'Protect'], 100),
  ],
  [
    makeSet('Pikachu', 'Pikachu', ['Tackle'], 30),
    makeSet('Vulpix', 'Vulpix', ['Tackle'], 30),
    ...benchNames.map(name => makeSet(name, name, ['Tackle'], 30)),
  ],
)));
const DOUBLE_KO = 'move seismictoss 1, move seismictoss 2';
const TACKLES = 'move tackle 1, move tackle 1';

describe('doubles forced switches in the option lists (round 42)', () => {
  test('two forced slots with one replacement offer both pass assignments', () => {
    const stopped = advancePositionWithLog(doubleKoRoot(['Eevee']), DOUBLE_KO, TACKLES, '1,2,3,4', { stopAtForcedSwitch: true });
    expect(stopped.pendingSwitch).toBe(true);
    expect(legalChoices(stopped.child, 'p1')).toEqual([{ choice: 'wait', label: '(waiting)' }]);
    expect(legalChoices(stopped.child, 'p2')).toEqual([
      { choice: 'switch 3, pass', label: '→ Eevee + pass' },
      { choice: 'pass, switch 3', label: 'pass + → Eevee' },
    ]);
    for (const option of legalChoices(stopped.child, 'p2')) {
      const next = advancePositionWithLog(stopped.child, 'wait', option.choice, '1,2,3,4', { stopAtForcedSwitch: true });
      expect(next.pendingSwitch).toBe(false);
      expect(positionBattle(next.child).turn).toBe(2);
    }
  });

  test('two forced slots with two replacements keep the ordered pairs', () => {
    const stopped = advancePositionWithLog(doubleKoRoot(['Eevee', 'Growlithe']), DOUBLE_KO, TACKLES, '1,2,3,4', { stopAtForcedSwitch: true });
    expect(legalChoices(stopped.child, 'p2').map(option => option.choice)).toEqual(['switch 3, switch 4', 'switch 4, switch 3']);
  });

  test('one forced slot beside a living partner still offers the bare switch', () => {
    const root = createRootPosition(serialize(makeBattle('gen9doublescustomgame',
      [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100), makeSet('Snorlax', 'Snorlax', ['Protect'], 100)],
      [makeSet('Pikachu', 'Pikachu', ['Tackle'], 30), makeSet('Eevee', 'Eevee', ['Tackle'], 30), makeSet('Vulpix', 'Vulpix', ['Tackle'], 30)],
    )));
    const stopped = advancePositionWithLog(root, 'move seismictoss 1, move protect', TACKLES, '1,2,3,4', { stopAtForcedSwitch: true });
    expect(stopped.pendingSwitch).toBe(true);
    expect(legalChoices(stopped.child, 'p2').map(option => option.choice)).toEqual(['switch 3']);
  });
});

const SETTINGS = { depth: 1 as const, samples: 1 as const, tera: false as const };

/** Depth in turns: boundary nodes on the deepest root-to-leaf path (the root counts as one). */
function boundaryDepth(node: Node): number {
  let deepest = 0;
  for (const child of node.children.values()) deepest = Math.max(deepest, boundaryDepth(child));
  return (node.boundary ? 1 : 0) + deepest;
}

function cellChild(root: Node, p1Choice: string, p2Choice: string): Node | undefined {
  const i = root.p1Options.findIndex(option => option.choice === p1Choice);
  const j = root.p2Options.findIndex(option => option.choice === p2Choice);
  expect(i).toBeGreaterThanOrEqual(0);
  expect(j).toBeGreaterThanOrEqual(0);
  return root.children.get(cellKey(i, j));
}

describe('MCTS: forced switches are decision nodes (round 42)', () => {
  test('singles: the knock-out cell is a mid-turn node with the bench against wait; its children are boundaries', () => {
    const root = mctsRoot(explosionRoot().serialized, SETTINGS);
    expect(root.boundary).toBe(true);
    const mid = cellChild(root, 'move explosion', 'move substitute');
    expect(mid).toBeDefined();
    expect(mid!.boundary).toBe(false);
    expect(mid!.p1Options.map(option => option.choice)).toEqual(['switch 2', 'switch 3']);
    expect(mid!.p2Options).toEqual([{ choice: 'wait', label: '(waiting)' }]);
    expect(mid!.children.size).toBeGreaterThan(0);
    for (const child of mid!.children.values()) expect(child.boundary).toBe(true);
  });

  test('depth counts turns, not plies, and the search is deterministic', () => {
    const serialized = explosionRoot().serialized;
    const stats = mctsTreeSearch(serialized, { ...SETTINGS, mode: 'mcts' }, 0);
    const root = mctsRoot(serialized, { ...SETTINGS, mode: 'mcts' }, 0);
    expect(stats.depth).toBe(boundaryDepth(root));
    const again = mctsRoot(serialized, { ...SETTINGS, mode: 'mcts' }, 0);
    expect({ n: again.p1N, w: again.p1W, n2: again.p2N, w2: again.p2W, visits: again.visits })
      .toEqual({ n: root.p1N, w: root.p1W, n2: root.p2N, w2: root.p2W, visits: root.visits });
  });

  test('doubles: the double knock-out cell is a mid-turn node over the pass assignments', () => {
    const root = mctsRoot(doubleKoRoot(['Eevee']).serialized, SETTINGS);
    const mid = cellChild(root, DOUBLE_KO, TACKLES);
    expect(mid).toBeDefined();
    expect(mid!.boundary).toBe(false);
    expect(mid!.p1Options).toEqual([{ choice: 'wait', label: '(waiting)' }]);
    expect(mid!.p2Options.map(option => option.choice)).toEqual(['switch 3, pass', 'pass, switch 3']);
    for (const child of mid!.children.values()) expect(child.boundary).toBe(true);
  });

  test('root-parallel trees over mid-turn children still merge and rank every root row', () => {
    const serialized = explosionRoot().serialized;
    const trees = [0, 1, 2, 3].map(offset => mctsTreeSearch(serialized, { ...SETTINGS, mode: 'mcts' }, offset));
    const explosionRow = trees[0].p1Options.findIndex(option => option.choice === 'move explosion');
    const explosionCells = trees[0].cells.filter(cell => Math.floor(cell.key / 10_000) === explosionRow);
    expect(explosionCells.length).toBeGreaterThan(0);
    expect(explosionCells.every(cell => cell.ended === false)).toBe(true);
    const merged = mergeMctsTrees(trees);
    expect(merged.perSide.p1.map(row => row.choice).sort()).toEqual(trees[0].p1Options.map(option => option.choice).sort());
    expect(merged.perSide.p2.map(row => row.choice).sort()).toEqual(trees[0].p2Options.map(option => option.choice).sort());
  });
});
