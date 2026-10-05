import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { mergeMctsTrees } from '../src/mcts-merge';
import { cellKey } from '../src/rank';
import { classifyChild, planCellEvents, PROBE_SEEDS } from '../src/cell-blend';
import { createMatchupCache } from '../src/eval-function';
import { advancePosition, advancePositionWithLog, createRootPosition, positionBattle, type SimPosition } from '../src/forward-model';
import { createLocalExecutor, subSearchDepth1 } from '../src/search';
import { countFainted, leafValue, SEARCH_SEEDS } from '../src/search/leaf';
import { sampleCell } from '../src/search/cell-sampler';
import { deeperValues, VERIFY_DEEPEN_COVER, VERIFY_PLAIN_DRAWS } from '../src/search/verify-cell';
import type { EvalCellValue, EvalSettings, MctsTreeStats } from '../src/types';
import { anchorRoot, doublesRoot, pairSet, PLAYED } from './pair-battles';

/**
 * Round 63 (T16): the verify step prices a cell at one depth. A blend cell
 * deepens one child per open class and mixes the classes with the plan
 * weights; a cell without a plan draws VERIFY_PLAIN_DRAWS natural seeds,
 * groups them by outcome and deepens one child per group. Before, only the
 * first draw went one ply deeper (the second fixed seed misses in 21 of 22
 * cells with a miss chance, round 62), so the first draw decided the note.
 */

const SUB: EvalSettings = { depth: 1, samples: 1, tera: false };

function singlesRoot(p1: PokemonSet[], p2: PokemonSet[], setup?: (battle: Battle) => void) {
  const battle = new Battle({
    formatid: toID('gen9customgame'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  setup?.(battle);
  return createRootPosition(JSON.stringify(State.serializeBattle(battle)));
}

/** Focus Blast (70 %) into a full Snorlax that curses: one event, a miss class and a hit class, both open. */
const focusBlastRoot = (paralyzed = false) => singlesRoot(
  [pairSet('Caster', 'Alakazam', ['Focus Blast', 'Recover'], { level: 100 }), pairSet('Back', 'Blissey', ['Soft-Boiled'])],
  [pairSet('Wall', 'Snorlax', ['Curse', 'Rest'], { level: 100 }), pairSet('Back', 'Chansey', ['Soft-Boiled'])],
  paralyzed ? battle => { battle.sides[0].active[0]!.setStatus('par'); } : undefined,
);
const FOCUS = ['move focusblast', 'move curse'] as const;

const deepened = (root: ReturnType<typeof createRootPosition>, child: ReturnType<typeof advancePosition>) =>
  (positionBattle(child).ended ? leafValue(positionBattle(child), createMatchupCache()) : subSearchDepth1(child.serialized, SUB, createMatchupCache()).score);

describe('the merge mixes per-class depth (round 63, T16)', () => {
  const options = (labels: string[]) => labels.map(label => ({ choice: label, label }));
  const emptyResult = { score: 0, interval: 0, depthCompleted: 2, perSide: { p1: [], p2: [] } };
  // (0,1) is starved in every tree: no pool, the verified value stands alone.
  const cell = (i: number, j: number, visits: number, mean: number) =>
    ({ key: cellKey(i, j), visits, total: mean * (visits + 1) - mean, value: mean, ended: false });
  const mk = (): MctsTreeStats => ({
    p1Options: options(['A', 'B']), p2Options: options(['X', 'Y']),
    p1N: [26, 60], p1W: [-5, -12], p2N: [40, 21], p2W: [-8, -4],
    visits: 86, depth: 2, rootValue: 0.1, result: emptyResult,
    cells: [cell(0, 0, 20, -0.2), cell(0, 1, 1, 0.4), cell(1, 0, 20, -0.2), cell(1, 1, 20, -0.2)],
  });
  const trees = [mk(), mk(), mk()];

  for (const [shape, keys] of [
    ['singles keys', ['hit-nokill', 'miss', 'hit-kill']],
    ['doubles pair-plan keys', ['p1a:flareblitz>p2b=hit-nokill', 'p1a:flareblitz>p2b=miss', 'p1a:flareblitz>p2b=hit-kill']],
  ] as const) {
    test(`a verified blend cell mixes every open class one ply deeper with the plan weights (${shape})`, () => {
      const value: EvalCellValue = {
        i: 0, j: 1, value: 0.13, ended: false,
        blend: { firstLeaf: -0.1, classes: [
          { key: keys[0], weight: 0.6, leafSum: -0.3, count: 3, hasFirst: true, ended: false, deepened: 0.2 },
          { key: keys[1], weight: 0.3, leafSum: 0.6, count: 2, hasFirst: false, ended: false, deepened: 0.4 },
          { key: keys[2], weight: 0.1, leafSum: 3, count: 3, hasFirst: false, ended: true },
        ] },
      };
      const merged = mergeMctsTrees(trees, new Map([[cellKey(0, 1), value]]));
      // Ended class keeps its exact leaves (1); the open classes take their deepened values.
      expect(merged.matrix!.values[0][1]).toBeCloseTo(0.6 * 0.2 + 0.3 * 0.4 + 0.1 * 1, 12);
    });
  }

  test('a deep class pool still outranks the class one ply deeper (round 33)', () => {
    const pooled = (visits: number, mean: number, classKey: string) => ({
      key: cellKey(0, 0), visits, total: mean * (visits + 1) - (-0.1), value: -0.1, ended: false, classKey,
    });
    const deep = (cells: MctsTreeStats['cells']): MctsTreeStats => ({ ...mk(), cells });
    const deepTrees = [
      deep([pooled(120, -0.96, 'hit-nokill')]), deep([pooled(110, -0.95, 'hit-nokill')]),
      deep([pooled(130, -0.97, 'hit-nokill')]), deep([pooled(40, 0.2, 'miss')]),
    ];
    const value: EvalCellValue = {
      i: 0, j: 0, value: -0.04, ended: false,
      blend: { firstLeaf: -0.1, classes: [
        { key: 'hit-nokill', weight: 0.8, leafSum: -0.3, count: 3, hasFirst: true, ended: false, deepened: -0.5 },
        { key: 'miss', weight: 0.2, leafSum: 0.6, count: 3, hasFirst: false, ended: false, deepened: 0.3 },
      ] },
    };
    const merged = mergeMctsTrees(deepTrees, new Map([[cellKey(0, 0), value]]));
    // The hit class keeps the trees' −0.96; the thin miss class takes its deepened 0.3.
    expect(merged.matrix!.values[0][0]).toBeCloseTo(0.8 * -0.96 + 0.2 * 0.3, 1);
  });
});

describe('the deepening rule (round 63, T16)', () => {
  const child = (name: string) => ({ serialized: name }) as unknown as SimPosition;
  const step: Record<string, number> = { a: 0.2, b: -0.1, c: 0.4, d: 1 };

  test('outcomes go deeper by weight until 90 % of the open weight; the rarer rest shifts by the mean step; ended ones keep their leaf', () => {
    const outcomes = [
      { weight: 0.05, child: child('d'), leaf: 0, ended: false },
      { weight: 0.5, child: child('a'), leaf: 0.1, ended: false },
      { weight: 0.15, child: child('c'), leaf: -0.2, ended: false },
      { weight: 0.3, child: child('b'), leaf: 0.3, ended: false },
      { weight: 0.2, child: child('e'), leaf: 1, ended: true },
    ];
    const asked: string[] = [];
    const deeper = (position: SimPosition) => {
      asked.push(position.serialized);
      return outcomes.find(outcome => outcome.child === position)!.leaf + step[position.serialized];
    };
    const values = deeperValues(outcomes, deeper, VERIFY_DEEPEN_COVER.singles);
    // a (0.5), b (0.8 < 0.9), c (0.95): three deepened, d (0.05) shifted, e ended.
    expect(asked).toEqual(['a', 'b', 'c']);
    const meanStep = (0.5 * 0.2 + 0.3 * -0.1 + 0.15 * 0.4) / 0.95;
    expect(values[0]).toBeCloseTo(0 + meanStep, 12);
    expect(values[1]).toBeCloseTo(0.3, 12);
    expect(values[2]).toBeCloseTo(0.2, 12);
    expect(values[3]).toBeCloseTo(0.2, 12);
    expect(values[4]).toBe(1);
  });

  test('doubles goes deeper through the heaviest outcome only; the rest shifts by its step', () => {
    const outcomes = [
      { weight: 0.3, child: child('b'), leaf: 0.3, ended: false },
      { weight: 0.5, child: child('a'), leaf: 0.1, ended: false },
      { weight: 0.2, child: child('e'), leaf: -1, ended: true },
    ];
    const asked: string[] = [];
    const values = deeperValues(outcomes, position => {
      asked.push(position.serialized);
      return outcomes.find(outcome => outcome.child === position)!.leaf + step[position.serialized];
    }, VERIFY_DEEPEN_COVER.doubles);
    expect(asked).toEqual(['a']);
    expect(values).toEqual([0.3 + 0.2, 0.1 + 0.2, -1].map(v => expect.closeTo(v, 12)));
  });
});

describe('the verify executor deepens per class (round 63, T16)', () => {
  test('a singles boundary cell: every open class carries its first draw one ply deeper', { timeout: 60_000 }, async () => {
    const root = focusBlastRoot();
    const plan = planCellEvents(positionBattle(root), ...FOCUS);
    expect(plan.kind).toBe('events');
    if (plan.kind !== 'events') return;
    const [value] = await createLocalExecutor(root.serialized).evalCells([{ i: 0, j: 0, p1Choice: FOCUS[0], p2Choice: FOCUS[1], samples: 3, deepen: SUB }]);
    const classes = value.blend!.classes;
    expect(classes.map(cls => cls.key).sort()).toEqual(['hit-nokill', 'miss']);
    // The class's representative is its first draw in the sampler's seed order; 0.7 and 0.3 both go deeper.
    const order = [...SEARCH_SEEDS.slice(0, 3), ...PROBE_SEEDS];
    for (const cls of classes) {
      const seed = order.find(s => classifyChild(advancePositionWithLog(root, ...FOCUS, s).log, plan.events) === cls.key)!;
      expect(cls.deepened, cls.key).toBe(deepened(root, advancePosition(root, ...FOCUS, seed)));
    }
    // The one-ply blend itself is today's.
    const plain = sampleCell(root, countFainted(positionBattle(root)), ...FOCUS, 3, createMatchupCache(), true);
    expect(value.value).toBe(plain.value);
    expect(value.deepened).toBeUndefined();
  });

  test('a doubles pair-plan cell: the heaviest open class goes one ply deeper through its own draw, the rest shift by its step', { timeout: 120_000 }, async () => {
    const root = anchorRoot();
    const [value] = await createLocalExecutor(root.serialized).evalCells([{ i: 0, j: 0, p1Choice: PLAYED[0], p2Choice: PLAYED[1], samples: 3, deepen: SUB }]);
    const open = value.blend!.classes.filter(cls => !cls.ended);
    expect(open.length).toBeGreaterThan(1);
    const sample = sampleCell(root, countFainted(positionBattle(root)), ...PLAYED, 3, createMatchupCache(), true, VERIFY_PLAIN_DRAWS);
    const expected = deeperValues(open.map(cls => ({
      weight: cls.weight, child: sample.classChildren!.get(cls.key)!, leaf: cls.leafSum / cls.count, ended: false,
    })), position => deepened(root, position), VERIFY_DEEPEN_COVER.doubles);
    open.forEach((cls, index) => expect(cls.deepened, cls.key).toBeCloseTo(expected[index], 12));
    // The first natural draw's class deepens the same child the old verify step deepened.
    const first = open.find(cls => cls.hasFirst)!;
    expect(sample.classChildren!.get(first.key)!.serialized).toBe(advancePosition(root, ...PLAYED, SEARCH_SEEDS[0]).serialized);
  });
});

describe('a cell without a plan draws more and deepens each outcome (round 63, T16)', () => {
  const checkPlain = async (root: ReturnType<typeof createRootPosition>, p1: string, p2: string, cover: number) => {
    const sample = sampleCell(root, countFainted(positionBattle(root)), p1, p2, 3, createMatchupCache(), true, VERIFY_PLAIN_DRAWS);
    const groups = sample.outcomes!;
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.reduce((sum, group) => sum + group.share, 0)).toBeCloseTo(1, 12);
    for (const group of groups) expect(Number.isInteger(Math.round(group.share * VERIFY_PLAIN_DRAWS * 1e9) / 1e9)).toBe(true);
    const [value] = await createLocalExecutor(root.serialized).evalCells([{ i: 0, j: 0, p1Choice: p1, p2Choice: p2, samples: 3, deepen: SUB }]);
    expect(value.blend).toBeUndefined();
    const values = deeperValues(groups.map(group => ({ ...group, weight: group.share })), position => deepened(root, position), cover);
    const expected = groups.reduce((sum, group, index) => sum + group.share * values[index], 0);
    expect(value.deepened).toBeCloseTo(expected, 12);
    expect(value.value).toBeCloseTo(sample.value, 12);
  };

  test('singles: a paralyzed Focus Blast (the plan refuses it) mixes full paralysis, miss and hit by their draw shares', { timeout: 60_000 }, async () => {
    const root = focusBlastRoot(true);
    expect(planCellEvents(positionBattle(root), ...FOCUS).kind).toBe('fail');
    await checkPlain(root, ...FOCUS, VERIFY_DEEPEN_COVER.singles);
  });

  test('doubles: a rule-F fallback cell (paralyzed attacker) mixes its outcome groups', { timeout: 60_000 }, async () => {
    const root = doublesRoot(
      [pairSet('Act', 'Garchomp', ['Dragon Claw', 'Protect']), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
      [pairSet('A', 'Snorlax', ['Rest', 'Protect']), pairSet('B', 'Snorlax', ['Rest', 'Protect'])],
      battle => { battle.sides[0].active[0]!.setStatus('par'); },
    );
    await checkPlain(root, 'move dragonclaw 1, move softboiled', 'move rest, move rest', VERIFY_DEEPEN_COVER.doubles);
  });

  test('cells without deepen carry no depth (the matrix mode and the played-pair check stay as they were)', async () => {
    const root = focusBlastRoot(true);
    const [value] = await createLocalExecutor(root.serialized).evalCells([{ i: 0, j: 0, p1Choice: FOCUS[0], p2Choice: FOCUS[1], samples: 3 }]);
    const plain = sampleCell(root, countFainted(positionBattle(root)), ...FOCUS, 3, createMatchupCache(), true);
    expect(value).toEqual({ i: 0, j: 0, value: plain.value, ended: plain.ended });
  });
});
