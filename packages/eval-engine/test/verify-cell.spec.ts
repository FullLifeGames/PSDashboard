import { describe, expect, test, afterEach } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { mergeMctsTrees } from '../src/mcts-merge';
import { cellKey } from '../src/rank';
import { planCellEvents, classifyChild } from '../src/cell-blend';
import { createMatchupCache } from '../src/eval-function';
import {
  advancePosition,
  createRootPosition,
  positionBattle,
  type SimPosition,
  advancePositionWithLog,
} from '../src/forward-model';
import { createLocalExecutor, subSearchDepth1 } from '../src/search';
import { countFainted, leafValue } from '../src/search/leaf';
import { benchOrder } from '../src/search/bench-order';
import { cellSeeds } from '../src/search/root-quantile';
import { sampleCell } from '../src/search/cell-sampler';
import {
  deeperValues,
  VERIFY_CHEAP,
  VERIFY_DEEPEN_COVER,
  VERIFY_LIGHT,
  VERIFY_PLAIN_DRAWS,
  VERIFY_STATE_RULE,
  type CheapDeepening,
  deepenVerifiedCell,
  lightOptions,
  type Outcome,
  stateKey,
  stateRuleFor,
} from '../src/search/verify-cell';
import type { EvalCellValue, EvalSettings, MctsTreeStats, EvalCellJob } from '../src/types';
import { anchorRoot, doublesRoot, pairSet, PLAYED } from './pair-battles';
import { readFileSync } from 'node:fs';
import { searchOptions } from '../src/search/options';
import { perfReset, perfSummary } from '../src/perf-trace';
import { SEARCH_SEEDS } from './seed-streams';
import { VERIFY_SAMPLES } from '../src/verify-select';

/**
 * The verify step prices a cell at one depth. A blend cell deepens one child per open class and mixes the classes with the plan weights; a cell without a plan draws
 * VERIFY_PLAIN_DRAWS natural seeds, groups them by outcome and deepens one child per group (a single deepened first draw would decide the note: the second fixed seed
 * misses in 21 of 22 cells with a miss chance).
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

/** The light price the executor gives an outcome beyond the cover, as the game type's VERIFY_CHEAP rule sets it. */
const cheapFor = (root: ReturnType<typeof createRootPosition>): CheapDeepening | undefined => {
  const mode = VERIFY_CHEAP[positionBattle(root).gameType === 'doubles' ? 'doubles' : 'singles'];
  return mode === 'off' ? undefined : {
    price: child => (positionBattle(child).ended ? leafValue(positionBattle(child), createMatchupCache()) : subSearchDepth1(child.serialized, SUB, createMatchupCache(), true).score),
    statesOnly: mode === 'states',
    minWeight: VERIFY_LIGHT.minWeight,
  };
};

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

  test('in an endgame a rich, agreeing pool keeps its depth below the floor (round 77, T267)', () => {
    // Draft 2058494320, variation turn 63, Mienshao (Scarf, locked into Close Combat) and Kyurem
    // against Dragapult and Muk-Alola. The trees played Kyurem's switch into a Specs attack out to about −0.7 over 400
    // to 650 visits; the one-ply sampler read +0.75, the 0.9 floor gave the sampler the cells, and the ranking advised
    // U-turn beside a score that saw the other side winning. With at most two Pokémon left on each side the trees reach
    // the end of the game; their verdict stands below the floor, because chance (Rest, Sleep Talk) keeps it off ±1.
    const pooled = (visits: number, mean: number, classKey: string) => ({
      key: cellKey(0, 0), visits, total: mean * (visits + 1) - (-0.1), value: -0.1, ended: false, classKey,
    });
    const cells = [pooled(160, -0.7, 'hit-kill'), pooled(150, -0.72, 'hit-kill'), pooled(170, -0.69, 'hit-kill'), pooled(20, 0.3, 'miss')];
    const value: EvalCellValue = {
      i: 0, j: 0, value: 0.7, ended: false,
      blend: { firstLeaf: 0.75, classes: [
        { key: 'hit-kill', weight: 0.9, leafSum: 2.2, count: 3, hasFirst: true, ended: false, deepened: 0.75 },
        { key: 'miss', weight: 0.1, leafSum: 1.5, count: 3, hasFirst: false, ended: false, deepened: 0.5 },
      ] },
    };
    const atLiving = (p1: number, p2: number) => mergeMctsTrees(
      cells.map(cell => ({ ...mk(), cells: [cell], living: { p1, p2 } })), new Map([[cellKey(0, 0), value]]),
    ).matrix!.values[0][0];
    // Two against two: the hit class keeps the trees' −0.70; the thin miss class takes its deepened 0.5.
    expect(atLiving(2, 2)).toBeCloseTo(0.9 * -0.703 + 0.1 * 0.5, 2);
    // A side with three left is no endgame: the sampler keeps the cell.
    expect(atLiving(3, 2)).toBeCloseTo(0.9 * 0.75 + 0.1 * 0.5, 12);
    // Without the count (a cached tree without the field), nothing changes either.
    expect(mergeMctsTrees(cells.map(cell => ({ ...mk(), cells: [cell] })), new Map([[cellKey(0, 0), value]])).matrix!.values[0][0])
      .toBeCloseTo(0.9 * 0.75 + 0.1 * 0.5, 12);
  });

  test('in an endgame a rich, agreeing plain cell keeps its depth below the floor too (round 77, T267)', () => {
    const plain = (visits: number, mean: number) => ({ key: cellKey(0, 0), visits, total: mean * (visits + 1) - 0.4, value: 0.4, ended: false });
    const value: EvalCellValue = { i: 0, j: 0, value: 0.6, ended: false, deepened: 0.62 };
    const atLiving = (p1: number, p2: number) => mergeMctsTrees(
      [plain(200, -0.6), plain(210, -0.62), plain(190, -0.61)].map(cell => ({ ...mk(), cells: [cell], living: { p1, p2 } })),
      new Map([[cellKey(0, 0), value]]),
    ).matrix!.values[0][0];
    expect(atLiving(1, 2)).toBeCloseTo(-0.61, 1);
    expect(atLiving(2, 4)).toBeCloseTo(0.62, 12);
  });

  test('in an endgame a thin pool below the floor leaves the cell to the sampler (round 77, T267)', () => {
    // Champions VGC 2628166702 turn 7, the last pair: the trees visited Dark Pulse into Protect 24 times (8, 6, 5, 5)
    // and read about 0.1, the sampler one ply deeper read the win the prover proves. A value short of a decided game
    // needs a pool that played the cell out (400 to 650 visits); 24 visits stay with the sampler.
    const plain = (visits: number, mean: number) => ({ key: cellKey(0, 0), visits, total: mean * (visits + 1) - 0.4, value: 0.4, ended: false });
    const value: EvalCellValue = { i: 0, j: 0, value: 0.9, ended: false, deepened: 1 };
    const merged = mergeMctsTrees(
      [plain(8, 0.19), plain(6, -0.02), plain(5, 0.1), plain(5, 0.1)].map(cell => ({ ...mk(), cells: [cell], living: { p1: 1, p2: 1 } })),
      new Map([[cellKey(0, 0), value]]),
    );
    expect(merged.matrix!.values[0][0]).toBe(1);
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
  test('a singles boundary cell: every open class carries its states one ply deeper, its first draw for its own state', { timeout: 60_000 }, async () => {
    const root = focusBlastRoot();
    const plan = planCellEvents(positionBattle(root), ...FOCUS);
    expect(plan.kind).toBe('events');
    if (plan.kind !== 'events') return;
    const [value] = await createLocalExecutor(root.serialized).evalCells([{ i: 0, j: 0, p1Choice: FOCUS[0], p2Choice: FOCUS[1], samples: 3, deepen: SUB }]);
    const classes = value.blend!.classes;
    // Focus Blast's 10 % Special Defense drop is an outcome class of its own, `hit-nokill+boosts:spd`: the sampler forces it by script when the base draws miss it,
    // and each class holds one state.
    expect(classes.map(cls => cls.key).sort()).toEqual(['hit-nokill', 'hit-nokill+boosts:spd', 'miss']);
    // The class's representative is its first draw in the sampler's seed order; 0.63 and 0.3 both go deeper. The class of the drop
    // (weight 0.07) lies beyond the cover: it takes its leaf shifted by their step, as every class beyond the cover does.
    const sample = sampleCell(root, countFainted(positionBattle(root)), ...FOCUS, 3, createMatchupCache(), true, VERIFY_PLAIN_DRAWS);
    const shifted = classes.find(cls => cls.key === 'hit-nokill+boosts:spd')!;
    const covered = classes.filter(cls => cls !== shifted);
    const step = covered.reduce((sum, cls) => sum + cls.weight * (cls.deepened! - cls.leafSum / cls.count), 0) / covered.reduce((sum, cls) => sum + cls.weight, 0);
    expect(shifted.deepened).toBeCloseTo(shifted.leafSum / shifted.count + step, 12);
    for (const cls of covered) {
      const first = deepened(root, sample.classChildren!.get(cls.key)!);
      const states = sample.classGroups?.get(cls.key);
      if (!states) {
        expect(cls.deepened, cls.key).toBe(first);
        continue;
      }
      expect(states.map(state => deepened(root, state.child)), cls.key).toContain(first);
      const values = deeperValues(states.map(state => ({ weight: state.share, child: state.child, leaf: state.leaf, ended: state.ended })),
        position => deepened(root, position), VERIFY_STATE_RULE.singles.cover, VERIFY_STATE_RULE.singles.cap);
      expect(cls.deepened, cls.key).toBeCloseTo(states.reduce((sum, state, index) => sum + state.share * values[index], 0), 12);
    }
    // no class of this cell leaves several states
    expect(sample.classGroups?.size ?? 0).toBe(0);
    const plain = sampleCell(root, countFainted(positionBattle(root)), ...FOCUS, 3, createMatchupCache(), true);
    expect(value.value).toBe(plain.value);
    expect(value.deepened).toBeUndefined();
  });

  test('a doubles pair-plan cell: the heaviest open class goes one ply deeper through its states, the rest take the light price', { timeout: 120_000 }, async () => {
    // The executor reads the root through `benchOrder`, and a cell's seeds key the saved position, so the spec reads it the same way (the raw anchor and its canonical
    // bench are two keys, two sets of draws). One base draw: the played cell with three base draws of its own seeds covers under 0.8 of its classes in eight draws and
    // falls back (low-cover).
    const order = benchOrder(anchorRoot().serialized);
    const root = createRootPosition(order ? order.serialized : anchorRoot().serialized);
    const [value] = await createLocalExecutor(root.serialized).evalCells([{ i: 0, j: 0, p1Choice: PLAYED[0], p2Choice: PLAYED[1], samples: 1, deepen: SUB }]);
    const open = value.blend!.classes.filter(cls => !cls.ended);
    expect(open.length).toBeGreaterThan(1);
    const sample = sampleCell(root, countFainted(positionBattle(root)), ...PLAYED, 1, createMatchupCache(), true, VERIFY_PLAIN_DRAWS);
    // A class whose draws leave several states goes deeper through each of them.
    const expected = deeperValues(open.map(cls => ({
      weight: cls.weight, child: sample.classChildren!.get(cls.key)!, leaf: cls.leafSum / cls.count, ended: false,
      ...(sample.classGroups?.get(cls.key) ? { groups: sample.classGroups.get(cls.key) } : {}),
    })), position => deepened(root, position), VERIFY_DEEPEN_COVER.doubles, Number.POSITIVE_INFINITY, VERIFY_STATE_RULE.doubles, cheapFor(root));
    open.forEach((cls, index) => expect(cls.deepened, cls.key).toBeCloseTo(expected[index], 12));
    const first = open.find(cls => cls.hasFirst)!;
    expect(sample.classChildren!.get(first.key)!.serialized).toBe(advancePosition(root, ...PLAYED, cellSeeds(root, ...PLAYED)[0]).serialized);
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
    const rule = VERIFY_STATE_RULE[positionBattle(root).gameType === 'doubles' ? 'doubles' : 'singles'];
    const values = deeperValues(groups.map(group => ({ ...group, weight: group.share })), position => deepened(root, position), cover, Number.POSITIVE_INFINITY, rule, cheapFor(root));
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
    // A matrix cell reports the base draws the trend probe replays; it still carries no depth.
    expect(value).toEqual({ i: 0, j: 0, value: plain.value, ended: plain.ended, baseDraws: plain.baseDraws });
  });
});

describe('verify-cover-doubles', () => {
  const child = (name: string) => ({ serialized: name } as unknown as SimPosition);
  const outcome = (name: string, weight: number, leaf: number, ended = false): Outcome => ({ weight, child: child(name), leaf, ended });

  describe('deeperValues with a cheap deepening for the outcomes beyond the cover', () => {
    const outcomes = [outcome('heavy', 0.6, 0.1), outcome('mid', 0.25, 0.3), outcome('small', 0.1, -0.2), outcome('done', 0.05, 1, true)];
    const full = (position: SimPosition) => ({ heavy: 0.5 }[position.serialized as 'heavy'] ?? Number.NaN);
    const light = (position: SimPosition) => ({ mid: 0.45, small: -0.1 }[position.serialized as 'mid'] ?? Number.NaN);

    test('every open outcome beyond the cover is priced by the cheap callback, the heaviest by the full one', () => {
      const fullCalls: string[] = [];
      const cheapCalls: string[] = [];
      const values = deeperValues(outcomes, position => { fullCalls.push(position.serialized); return full(position); }, 0,
        Number.POSITIVE_INFINITY, undefined, { price: position => { cheapCalls.push(position.serialized); return light(position); }, statesOnly: false, minWeight: 0 });
      expect(fullCalls).toEqual(['heavy']);
      expect(cheapCalls).toEqual(['mid', 'small']);
      expect(values).toEqual([0.5, 0.45, -0.1, 1]);
    });

    test('without it the beyond-cover outcomes take the mean step, as before', () => {
      const values = deeperValues(outcomes, full, 0);
      const step = 0.5 - 0.1;
      expect(values).toEqual([0.5, 0.3 + step, -0.2 + step, 1]);
    });

    test('statesOnly keeps the shift for an outcome with one state and prices an outcome with states through the cheap callback', () => {
      const states = [{ share: 0.5, child: child('mid-a'), leaf: 0.2, ended: false }, { share: 0.5, child: child('mid-b'), leaf: 0.4, ended: false }];
      const withStates = [outcome('heavy', 0.6, 0.1), { ...outcome('mid', 0.25, 0.3), groups: states }, outcome('small', 0.15, -0.2)];
      const cheapCalls: string[] = [];
      const values = deeperValues(withStates, full, 0, Number.POSITIVE_INFINITY, undefined,
        { price: position => { cheapCalls.push(position.serialized); return position.serialized === 'mid-a' ? 0.3 : 0.5; }, statesOnly: true, minWeight: 0 });
      expect(cheapCalls).toEqual(['mid-a', 'mid-b']);
      expect(values[1]).toBeCloseTo(0.4, 12);
      expect(values[2]).toBeCloseTo(-0.2 + (0.5 - 0.1), 12); // one state: the shift
    });

    test('an outcome lighter than minWeight keeps the shift, the heavier one takes the cheap price', () => {
      const cheapCalls: string[] = [];
      const values = deeperValues(outcomes, full, 0, Number.POSITIVE_INFINITY, undefined,
        { price: position => { cheapCalls.push(position.serialized); return light(position); }, statesOnly: false, minWeight: 0.2 });
      expect(cheapCalls).toEqual(['mid']);
      expect(values).toEqual([0.5, 0.45, -0.2 + (0.5 - 0.1), 1]);
    });

    test('a cover that reaches every outcome calls the cheap callback never', () => {
      let calls = 0;
      const deep = (position: SimPosition) => (position.serialized === 'heavy' ? 0.5 : 0.4);
      deeperValues(outcomes, deep, 1, Number.POSITIVE_INFINITY, undefined, { price: () => { calls += 1; return 0; }, statesOnly: false, minWeight: 0 });
      expect(calls).toBe(0);
    });
  });

  const fixture = JSON.parse(readFileSync(new URL('./fixtures/positions/smogtours-gen9doublesou-912045-t6.json', import.meta.url), 'utf-8')) as
    { serialized: string; tera: boolean; sleepClause: boolean };

  function singlesRoot(): SimPosition {
    const battle = new Battle({
      formatid: toID('gen9customgame'), seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack([pairSet('Caster', 'Alakazam', ['Focus Blast', 'Recover', 'Psychic'], { level: 100 }), pairSet('Back', 'Blissey', ['Soft-Boiled'])]) },
      p2: { name: 'Beta', team: Teams.pack([pairSet('Wall', 'Snorlax', ['Curse', 'Rest', 'Body Slam'], { level: 100 }), pairSet('Back', 'Chansey', ['Soft-Boiled'])]) },
    });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', 'team 1');
      battle.choose('p2', 'team 1');
    }
    return createRootPosition(JSON.stringify(State.serializeBattle(battle)));
  }

  describe('light option lists', () => {
    const root = createRootPosition(fixture.serialized);

    test('912045 t6: at most six options a side, a quarter of the cells or less', () => {
      const sides = ['p1', 'p2'] as const;
      const fullLists = sides.map(side => searchOptions(root, side, { tera: false }));
      const lightLists = sides.map((side, index) => lightOptions(root, side, fullLists[index]));
      const cells = (lists: unknown[][]) => lists[0].length * lists[1].length;
      expect(cells(fullLists)).toBeGreaterThan(36);
      expect(lightLists.every((list, index) => list.length <= 6 && list.every(option => fullLists[index].includes(option)))).toBe(true);
      expect(cells(lightLists)).toBeLessThanOrEqual(cells(fullLists) / 4);
    });

    test('a singles list is returned as it is', () => {
      const singles = singlesRoot();
      const options = searchOptions(singles, 'p1', { tera: false });
      expect(lightOptions(singles, 'p1', options)).toBe(options);
    });
  });

  describe('the verify round of a cell counts its sub-searches', () => {
    const saved = VERIFY_CHEAP.doubles;
    afterEach(() => { VERIFY_CHEAP.doubles = saved; });

    async function verifyRound(serialized: string, cells: [number, number][], deepen: EvalSettings) {
      const executor = createLocalExecutor(serialized);
      const { p1, p2 } = await executor.choices(deepen.tera, undefined, deepen.sleepClause);
      const jobs: EvalCellJob[] = cells.map(([i, j]) => ({ i, j, p1Choice: p1[i].choice, p2Choice: p2[j].choice, samples: 1, deepen }));
      perfReset();
      const values = await executor.evalCells(jobs);
      return { jobs, values, counters: perfSummary('t148').counters };
    }

    test('912045 t6: the cheap deepening adds light sub-searches and leaves the full ones where they were', async () => {
      const settings: EvalSettings = { depth: 1, samples: 1, tera: fixture.tera, sleepClause: fixture.sleepClause };
      const cells: [number, number][] = [[0, 0], [1, 2], [3, 1], [5, 5]];
      VERIFY_CHEAP.doubles = 'off';
      const off = await verifyRound(fixture.serialized, cells, settings);
      VERIFY_CHEAP.doubles = saved;
      const on = await verifyRound(fixture.serialized, cells, settings);
      expect(off.counters['verify-sub-light'] ?? 0).toBe(0);
      expect(off.counters['verify-sub-full']).toBeGreaterThan(0);
      expect(on.counters['verify-sub-light']).toBeGreaterThan(0);
      expect(on.counters['verify-sub-full']).toBe(off.counters['verify-sub-full']);
      // The sampler's own values do not move, only the deepened ones.
      expect(on.values.map(value => value.value)).toEqual(off.values.map(value => value.value));
    }, 120_000);

    test('singles: the verify round deepens as deepenVerifiedCell does without a cheap callback, and no light search runs', async () => {
      const root = singlesRoot();
      const deepen: EvalSettings = { depth: 1, samples: 1, tera: false };
      const round = await verifyRound(root.serialized, [[0, 0], [0, 1], [1, 0], [2, 1]], deepen);
      expect(round.counters['verify-sub-light'] ?? 0).toBe(0);
      expect(round.counters['verify-sub-full']).toBeGreaterThan(0);
      const cache = createMatchupCache();
      const rootFainted = countFainted(positionBattle(root));
      for (const [index, job] of round.jobs.entries()) {
        const cell = sampleCell(root, rootFainted, job.p1Choice, job.p2Choice, 1, cache, true, VERIFY_PLAIN_DRAWS);
        const expected = { i: job.i, j: job.j, value: cell.value, ended: cell.ended, ...(cell.blend ? { blend: cell.blend } : {}) };
        deepenVerifiedCell(expected, cell, position => subSearchDepth1(position.serialized, deepen, cache).score, VERIFY_DEEPEN_COVER.singles);
        expect(round.values[index].deepened).toBe((expected as { deepened?: number }).deepened);
        expect(round.values[index].blend?.classes.map(cls => cls.deepened)).toEqual(expected.blend?.classes.map(cls => cls.deepened));
      }
    }, 120_000);
  });
});

describe('verify-spread', () => {
  const SUB: EvalSettings = { depth: 1, samples: 1, tera: false };

  function singlesRoot(p1: PokemonSet[], p2: PokemonSet[]): SimPosition {
    const battle = new Battle({
      formatid: toID('gen9customgame'), seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
    });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', 'team 1');
      battle.choose('p2', 'team 1');
    }
    return createRootPosition(JSON.stringify(State.serializeBattle(battle)));
  }

  const L100 = { level: 100 };
  const WALL = () => pairSet('Wall', 'Snorlax', ['Curse', 'Rest'], L100);
  const BACK = () => pairSet('Back', 'Chansey', ['Soft-Boiled'], L100);
  /** Hypnosis (60 %) from the faster side: the slept Snorlax cannot act this turn, its counter reads 1, 2 or 3. */
  const hypnosisRoot = () => singlesRoot([pairSet('Caster', 'Gengar', ['Hypnosis', 'Shadow Ball'], L100), BACK()], [WALL(), BACK()]);
  /** Spore (sure hit): a cell the sampler draws once, its counter decided by the first seed. */
  const sporeRoot = () => singlesRoot([pairSet('Caster', 'Breloom', ['Spore', 'Mach Punch'], L100), BACK()], [WALL(), BACK()]);
  /** Steam Eruption (95 %, 30 % burn) into Snorlax: a miss class and a hit class whose draws burn or not. */
  const steamRoot = () => singlesRoot([pairSet('Caster', 'Volcanion', ['Steam Eruption', 'Flamethrower'], L100), BACK()], [WALL(), BACK()]);

  /** Two slow walls at different speeds (a speed tie sends a doubles cell to the plain fallback). */
  const DOUBLES_P2 = () => [
    pairSet('A', 'Snorlax', ['Curse', 'Rest']),
    pairSet('B', 'Snorlax', ['Curse', 'Rest'], { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 4, spe: 252 } }),
  ];
  const doublesSleepRoot = (move: 'Sleep Powder' | 'Spore') => doublesRoot(
    [pairSet('Caster', move === 'Spore' ? 'Breloom' : 'Venusaur', [move, 'Protect']), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
    DOUBLES_P2(),
  );
  const doublesSteamRoot = () => doublesRoot(
    [pairSet('Caster', 'Volcanion', ['Steam Eruption', 'Protect']), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
    DOUBLES_P2(),
  );

  const target = (child: SimPosition) => positionBattle(child).sides[1].active[0]!;
  const wakesNextTurn = (child: SimPosition) => (target(child).status === 'slp' && target(child).statusState.time === 1 ? 1 : 0);
  const burned = (child: SimPosition) => (target(child).status === 'brn' ? 1 : 0);

  function deepenWith(root: SimPosition, p1: string, p2: string, deeper: (child: SimPosition) => number): EvalCellValue {
    const sample = sampleCell(root, countFainted(positionBattle(root)), p1, p2, VERIFY_SAMPLES, createMatchupCache(), true, VERIFY_PLAIN_DRAWS);
    const value: EvalCellValue = { i: 0, j: 0, value: sample.value, ended: sample.ended, ...(sample.blend ? { blend: structuredClone(sample.blend) } : {}) };
    const cover = VERIFY_DEEPEN_COVER[positionBattle(root).gameType === 'doubles' ? 'doubles' : 'singles'];
    deepenVerifiedCell(value, sample, deeper, cover);
    return value;
  }

  /** The natural verify draws of the game type's pool (singles sixteen fixed seeds, doubles eight) that pass `keep`. */
  const naturalDraws = (root: SimPosition, p1: string, p2: string, keep: (log: string[]) => boolean = () => true) =>
    cellSeeds(root, p1, p2).slice(0, stateRuleFor(root).pool).map(seed => advancePositionWithLog(root, p1, p2, seed)).filter(draw => keep(draw.log));
  const shareOf = (children: SimPosition[], f: (child: SimPosition) => number) =>
    children.reduce((sum, child) => sum + f(child), 0) / children.length;

  describe('the state a draw leaves (round 64, T119)', () => {
    test('the sleep counter, the burn and the stat stages tell draws apart; HP does not', () => {
      const slept = naturalDraws(hypnosisRoot(), 'move hypnosis', 'move curse', log => !log.some(line => line.startsWith('|-miss|')));
      const counters = new Set(slept.map(draw => target(draw.child).statusState.time));
      expect(counters.size).toBeGreaterThan(1);
      const keys = new Map(slept.map(draw => [target(draw.child).statusState.time, stateKey(draw.child)]));
      expect(new Set(keys.values()).size).toBe(counters.size);
      const missed = naturalDraws(hypnosisRoot(), 'move hypnosis', 'move curse', log => log.some(line => line.startsWith('|-miss|')));
      expect(missed.length).toBeGreaterThan(0);
      expect([...keys.values()]).not.toContain(stateKey(missed[0].child)); // Curse's stages
      const hits = naturalDraws(steamRoot(), 'move steameruption', 'move curse', log => !log.some(line => line.startsWith('|-miss|')));
      const clean = hits.filter(draw => !burned(draw.child));
      const hp = new Set(clean.map(draw => target(draw.child).hp));
      expect(hp.size).toBeGreaterThan(1);
      expect(new Set(clean.map(draw => stateKey(draw.child))).size).toBe(1);
      const scorched = hits.find(draw => burned(draw.child))!;
      expect(stateKey(scorched.child)).not.toBe(stateKey(clean[0].child));
    });
  });

  describe('hidden lengths go one ply deeper one by one (round 64, T119)', () => {
    test('singles: the hit class of Hypnosis goes deeper through every sleep counter, mixed by its share', () => {
      const root = hypnosisRoot();
      const plan = planCellEvents(positionBattle(root), 'move hypnosis', 'move curse');
      expect(plan.kind).toBe('events');
      if (plan.kind !== 'events') return;
      const value = deepenWith(root, 'move hypnosis', 'move curse', wakesNextTurn);
      const hit = value.blend!.classes.find(cls => cls.key.startsWith('hit'))!;
      // The stand-in reads 1 only where the counter says "wakes next turn": the class's depth is that share of its draws.
      const inClass = naturalDraws(root, 'move hypnosis', 'move curse', log => classifyChild(log, plan.events) === hit.key);
      const expected = shareOf(inClass.map(draw => draw.child), wakesNextTurn);
      expect(expected).toBeGreaterThan(0);
      expect(expected).toBeLessThan(1);
      expect(hit.deepened).toBeCloseTo(expected, 12);
    });

    test('doubles: the heaviest class (Sleep Powder hits) goes deeper through every sleep counter it drew', () => {
      const root = doublesSleepRoot('Sleep Powder');
      const [p1, p2] = ['move sleeppowder 1, move softboiled', 'move curse, move curse'];
      const value = deepenWith(root, p1, p2, wakesNextTurn);
      const hit = value.blend!.classes.find(cls => cls.key.endsWith('=hit'))!;
      const hits = naturalDraws(root, p1, p2, log => !log.some(line => line.startsWith('|-miss|')));
      const expected = shareOf(hits.map(draw => draw.child), wakesNextTurn);
      expect(expected).toBeGreaterThan(0);
      expect(expected).toBeLessThan(1);
      expect(hit.deepened).toBeCloseTo(expected, 12);
    });

    test('singles and doubles: a sure-hit Spore (one draw before) draws the pool and goes deeper per counter', () => {
      for (const [root, p1, p2] of [
        [sporeRoot(), 'move spore', 'move curse'],
        [doublesSleepRoot('Spore'), 'move spore 1, move softboiled', 'move curse, move curse'],
      ] as const) {
        const value = deepenWith(root, p1, p2, wakesNextTurn);
        const expected = shareOf(naturalDraws(root, p1, p2).map(draw => draw.child), wakesNextTurn);
        expect(expected, p1).toBeGreaterThan(0);
        expect(expected, p1).toBeLessThan(1);
        expect(value.deepened, p1).toBeCloseTo(expected, 12);
      }
    });
  });

  describe('secondary effects inside a class (round 64, T119)', () => {
    // The 30 percent burn of Steam Eruption is an outcome class of its own (`hit-nokill+brn`): the class of the unburned hit goes deeper unburned and the burned hit burned.
    test('singles: the burn of Steam Eruption is a class of its own, so the unburned hit goes deeper unburned and the burned hit burned', () => {
      const root = steamRoot();
      const plan = planCellEvents(positionBattle(root), 'move steameruption', 'move curse');
      expect(plan.kind).toBe('events');
      if (plan.kind !== 'events') return;
      const value = deepenWith(root, 'move steameruption', 'move curse', burned);
      const classes = new Map(value.blend!.classes.map(cls => [cls.key, cls]));
      expect(classes.get('hit-nokill')!.deepened).toBe(0);
      expect(classes.get('hit-nokill+brn')!.deepened).toBe(1);
      expect(classes.get('hit-nokill+brn')!.weight).toBeCloseTo(0.95 * 0.3, 9);
    });

    test("doubles reads only the counts: a burn inside the heaviest class keeps the class's first draw", () => {
      // Doubles splits only the counts the simulator keeps (the +10 % tree-time bound); a burn the leaf reads
      // goes deeper through the class's own first draw.
      const root = doublesSteamRoot();
      const [p1, p2] = ['move steameruption 1, move softboiled', 'move curse, move curse'];
      const value = deepenWith(root, p1, p2, burned);
      const heaviest = [...value.blend!.classes].sort((a, b) => b.weight - a.weight)[0];
      expect(heaviest.key).toContain('hit');
      const hits = naturalDraws(root, p1, p2, log => !log.some(line => line.startsWith('|-miss|')));
      expect(shareOf(hits.map(draw => draw.child), burned)).toBeGreaterThan(0);
      const sample = sampleCell(root, countFainted(positionBattle(root)), p1, p2, VERIFY_SAMPLES, createMatchupCache(), true, VERIFY_PLAIN_DRAWS);
      expect(sample.classGroups?.has(heaviest.key) ?? false).toBe(false);
      expect(heaviest.deepened).toBe(burned(sample.classChildren!.get(heaviest.key)!));
    });
  });

  describe('a cell whose draws leave one state prices as before (round 64, T119)', () => {
    test('singles and doubles: Curse against Curse, value and depth from the first draw', async () => {
      for (const [root, p1, p2] of [
        [singlesRoot([WALL(), BACK()], [WALL(), BACK()]), 'move curse', 'move curse'],
        [doublesRoot([pairSet('A', 'Snorlax', ['Curse', 'Rest']), pairSet('B', 'Blissey', ['Soft-Boiled', 'Protect'])], DOUBLES_P2()), 'move curse, move softboiled', 'move curse, move curse'],
      ] as const) {
        const [value] = await createLocalExecutor(root.serialized).evalCells([{ i: 0, j: 0, p1Choice: p1, p2Choice: p2, samples: VERIFY_SAMPLES, deepen: SUB }]);
        const first = advancePosition(root, p1, p2, SEARCH_SEEDS[0]);
        expect(value.value, p1).toBeCloseTo(leafValue(positionBattle(first), createMatchupCache()), 12);
        expect(value.deepened, p1).toBeCloseTo(subSearchDepth1(first.serialized, SUB, createMatchupCache()).score, 12);
      }
    });
  });
});
