import { describe, expect, test } from 'vitest';
import { createMatchupCache } from '../src/eval-function';
import { advancePositionWithLog, positionBattle, serializeBattleStable, type SimPosition } from '../src/forward-model';
import { simFastCounters } from '../src/forward/sim-fast/state';
import { loadSimMods } from '../src/forward/sim-mods';
import { configureSearchBudget, SEARCH_BUDGET_DEFAULT } from '../src/search/budget';
import { mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees } from '../src/mcts-merge';
import * as draws from '../src/pair/draw';
import { pairCellSample } from '../src/pair/sampler';
import { cellKey } from '../src/rank';
import { SEARCH_SEEDS, treeSeed } from '../src/search/leaf';
import type { CellBlend, MctsTreeStats } from '../src/types';
import { anchorRoot, doublesRoot, pairSet, PLAYED, QUIET, SPREAD } from './pair-battles';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { rootOf } from './secondary-classes-support';

/**
 * Round 86 (A9b): the doubles trees key their root draws. A tree draws a root cell once at its first visit; the draw runs under the
 * pair recorder (`drawKeyed`), `readPattern` names its class the way the sampler names its own, and the key goes into the tree's
 * root book (`keyedAdvance`, `pair/tree-key.ts`). Rows: (a) identity with the plain advance, (b) the key equals the sampler's class
 * key, (c) a guarded cell and a cell without an uncertain event book no key and the singles keys stay, (d) the merge prices each
 * class by the trees that drew it, (e) the clones of a keyed draw equal the plain draw's.
 */
await loadSimMods('gen9championsou');

const cache = createMatchupCache();
const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20'];
const stampless = (log: readonly string[]): string[] => log.filter(line => !line.startsWith('|t:|'));
const SPEED = { nature: 'Jolly', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 } } as const;
// Two targets whose speeds stay apart after a paralysis: Snorlax at half speed would tie with a Munchlax in the residual order, and so would a Dragonite at 50.
const slow = () => [pairSet('Slow1', 'Snorlax', ['Rest', 'Protect']), pairSet('Slow2', 'Chansey', ['Rest', 'Protect'])];

/** The keyed draw's module: a function of A9b's first commit, or a failure that says it is not there. */
async function keyedModule(): Promise<typeof import('../src/pair/tree-key')> {
  return import('../src/pair/tree-key');
}

/** The sampler's blend of a cell (the plan's classes), for the keys a tree draw may name. */
function blendOf(root: SimPosition, p1: string, p2: string): CellBlend {
  const cell = pairCellSample(root, p1, p2, 3, cache);
  if (cell.kind !== 'sample' || !cell.sample.blend) throw new Error(`no class plan for ${p1} / ${p2}: ${cell.kind}`);
  return cell.sample.blend;
}

// Extrasensory (a flinch of one in ten), Thunderbolt (a paralysis of one in ten) and a plain 80 percent move (a miss class).
const BOARDS = {
  flinch: {
    root: () => doublesRoot([pairSet('Fast', 'Aerodactyl', ['Extrasensory', 'Protect'], SPEED), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])], slow()),
    choices: ['move extrasensory 1, move softboiled', 'move rest, move rest'] as const,
    token: '+flinch',
  },
  paralysis: {
    root: () => doublesRoot([pairSet('Bolt', 'Aerodactyl', ['Thunderbolt', 'Protect'], SPEED), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])], slow()),
    choices: ['move thunderbolt 1, move softboiled', 'move rest, move rest'] as const,
    token: '+par',
  },
  miss: {
    root: () => doublesRoot([pairSet('Fast', 'Aerodactyl', ['Stone Edge', 'Protect'], SPEED), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])], slow()),
    choices: ['move stoneedge 1, move softboiled', 'move rest, move rest'] as const,
    token: 'miss',
  },
};

describe('(a) the keyed draw is the plain advance with its dice written down', () => {
  test.each([true, false])('a doubles board with a forced switch, five seeds, stopAtForcedSwitch %s', stop => {
    const root = anchorRoot();
    let pending = 0;
    for (const seed of SEEDS) {
      for (const choices of [PLAYED, SPREAD]) {
        const plain = advancePositionWithLog(root, ...choices, seed as never, { stopAtForcedSwitch: stop });
        const keyed = draws.drawKeyed(root, ...choices, seed as never, stop);
        expect(stampless(keyed.log), `${seed} ${choices[0]}`).toEqual(stampless(plain.log));
        expect(keyed.pendingSwitch).toBe(plain.pendingSwitch);
        expect(serializeBattleStable(positionBattle(keyed.child))).toBe(serializeBattleStable(positionBattle(plain.child)));
        if (plain.pendingSwitch) pending++;
      }
    }
    // the board does reach the forced switch under the tree's rule, or the row proves nothing about it
    if (stop) expect(pending).toBeGreaterThan(0);
  });
});

describe('(b) the key of a keyed draw is the sampler\'s class key', () => {
  for (const [name, board] of Object.entries(BOARDS)) {
    test(`${name} board: every keyed draw names a class of the sampler's blend, and the first seed names its first class`, async () => {
      const { keyedAdvance } = await keyedModule();
      const root = board.root();
      const [p1, p2] = board.choices;
      const blend = blendOf(root, p1, p2);
      const owner = {};
      const seen = new Set<string>();
      const first = keyedAdvance(owner, root, cellKey(0, 0), p1, p2, SEARCH_SEEDS[0], false);
      expect(first?.classKey).toBe(blend.classes.find(cls => cls.hasFirst)?.key);
      for (let iteration = 0; iteration < 40; iteration++) {
        const drawn = keyedAdvance(owner, root, cellKey(0, 0), p1, p2, treeSeed(iteration, 1), false);
        expect(drawn).not.toBeNull();
        expect(drawn!.classKey).not.toBeNull();
        seen.add(drawn!.classKey!);
      }
      expect(blend.classes.map(cls => cls.key)).toEqual(expect.arrayContaining([...seen]));
      // the die that names the board shows: some seed of the forty draws the effect (or the miss)
      expect([...seen].some(key => key.includes(board.token)), `${[...seen]}`).toBe(true);
      expect(seen.size).toBeGreaterThan(1);
    });
  }

  test('the tree books the class of every keyed root cell, and the class belongs to the sampler\'s blend', () => {
    configureSearchBudget({ ...SEARCH_BUDGET_DEFAULT, iterations: 200 });
    try {
      const board = BOARDS.paralysis;
      const root = board.root();
      const settings = { depth: 1 as const, samples: 1 as const, tera: false as const, mode: 'mcts' as const, prove: false };
      const stats = mctsTreeSearch(root.serialized, settings, 0);
      const keyed = stats.cells.filter(cell => cell.classKey !== undefined);
      expect(keyed.length).toBeGreaterThan(0);
      for (const cell of keyed) {
        const [i, j] = [Math.floor(cell.key / 10_000), cell.key % 10_000];
        const blend = blendOf(root, stats.p1Options[i].choice, stats.p2Options[j].choice);
        expect(blend.classes.map(cls => cls.key), `${stats.p1Options[i].choice} / ${stats.p2Options[j].choice}`).toContain(cell.classKey);
      }
    } finally {
      configureSearchBudget(null);
    }
  });
});

describe('(c) a guarded cell and a cell without an uncertain event book no key; singles keep theirs', () => {
  test('a paralysed attacker sends the cell to the plain draws before any die: no keyed draw', async () => {
    const { keyedAdvance } = await keyedModule();
    const root = doublesRoot(
      [pairSet('Act', 'Garchomp', ['Dragon Claw', 'Protect']), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
      [pairSet('A', 'Snorlax', ['Rest', 'Protect']), pairSet('B', 'Snorlax', ['Rest', 'Protect'])],
      battle => { battle.sides[0].active[0]!.setStatus('par'); },
    );
    expect(keyedAdvance({}, root, cellKey(0, 0), 'move dragonclaw 1, move softboiled', 'move rest, move rest', SEARCH_SEEDS[0], false)).toBeNull();
  });

  test('a choice the pair plan does not parse is no keyed draw', async () => {
    const { keyedAdvance } = await keyedModule();
    expect(keyedAdvance({}, anchorRoot(), cellKey(0, 0), 'team 12', 'team 12', SEARCH_SEEDS[0], false)).toBeNull();
  });

  test('a cell with no uncertain event draws and books no key', async () => {
    const { keyedAdvance } = await keyedModule();
    const root = anchorRoot();
    const drawn = keyedAdvance({}, root, cellKey(0, 0), ...QUIET, SEARCH_SEEDS[0], false);
    expect(drawn).not.toBeNull();
    expect(drawn!.classKey).toBeNull();
  });

  test('a singles tree books the keys it booked before: the class path of the root cell, no pair read', () => {
    const settings = { depth: 1 as const, samples: 1 as const, tera: false as const, mode: 'mcts' as const, prove: false };
    configureSearchBudget({ ...SEARCH_BUDGET_DEFAULT, iterations: 200 });
    try {
      const board = rootOf(battleOf('gen9customgame', [set('Blissey', ['waterfall'])], [set('Snorlax', ['thunder'])]));
      const stats = mctsTreeSearch(board.serialized, settings, 0);
      const keys = new Set(stats.cells.map(cell => cell.classKey).filter(Boolean));
      // the planner's keys: the two sides' outcomes joined with `|`, as before this round (no pair-plan key has that shape)
      expect(keys.size).toBeGreaterThan(0);
      for (const key of keys) expect(String(key)).toMatch(/^(hit-nokill|hit-kill|miss|none)[^=]*\|(hit-nokill|hit-kill|miss|none)/);
    } finally {
      configureSearchBudget(null);
    }
  });
});

describe('(d) the merge prices each class of four keyed doubles trees by its own pool', () => {
  const options = (labels: string[]) => labels.map(label => ({ choice: label, label }));
  const emptyResult = { score: 0, interval: 0, depthCompleted: 2, perSide: { p1: [], p2: [] } };
  const mk = (cells: MctsTreeStats['cells']): MctsTreeStats => ({
    p1Options: options(['Bolt', 'Protect']), p2Options: options(['X', 'Y']),
    p1N: [40, 2], p1W: [-30, 1], p2N: [40, 2], p2W: [-30, 1],
    visits: 42, depth: 2, rootValue: 0.5, cells, result: emptyResult,
  });
  const cell = (visits: number, mean: number, classKey: string) => ({ key: cellKey(0, 0), visits, total: mean * (visits + 1) - (-0.1), value: -0.1, ended: false, classKey });
  // Thunderbolt in miniature: the plain hit (0.9) and the paralysis (0.1), both open. The keys are the pair plan's.
  const blend = { firstLeaf: -0.1, classes: [
    { key: 'p1a:thunderbolt>p2a=hit-nokill', weight: 0.9, leafSum: 0.6, count: 3, hasFirst: true, ended: false },
    { key: 'p1a:thunderbolt>p2a=hit-nokill+par', weight: 0.1, leafSum: -3, count: 3, hasFirst: false, ended: false },
  ] };
  const verified = new Map([[cellKey(0, 0), { i: 0, j: 0, value: 0.44, ended: false, blend }]]);
  const HIT = 'p1a:thunderbolt>p2a=hit-nokill';
  const PAR = 'p1a:thunderbolt>p2a=hit-nokill+par';

  test('two trees per class: each class takes its own deep pool, the sampler\'s mean is not read', () => {
    const trees = [mk([cell(120, -0.96, HIT)]), mk([cell(110, -0.95, HIT)]), mk([cell(60, -0.99, PAR)]), mk([cell(50, -1.0, PAR)])];
    const merged = mergeMctsTrees(trees, verified);
    expect(merged.matrix!.values[0][0]).toBeCloseTo(0.9 * -0.955 + 0.1 * -0.995, 1);
    expect(merged.matrix!.values[0][0]).toBeLessThan(-0.8);
  });

  test('one tree of the 0.1 class: that class takes the sampler\'s mean, the hit class its pool', () => {
    const trees = [mk([cell(120, -0.96, HIT)]), mk([cell(110, -0.95, HIT)]), mk([cell(130, -0.97, HIT)]), mk([cell(40, -1.0, PAR)])];
    const merged = mergeMctsTrees(trees, verified);
    expect(merged.matrix!.values[0][0]).toBeCloseTo(0.9 * -0.96 + 0.1 * (-3 / 3), 1);
  });
});

describe('(e) the clones of a keyed draw equal the plain draw\'s', () => {
  const clones = (run: () => unknown): number => {
    const before = simFastCounters.clones;
    run();
    return simFastCounters.clones - before;
  };

  test.each(Object.entries(BOARDS))('%s board: a keyed draw takes the copies of one plain draw', async (_name, board) => {
    const { keyedAdvance } = await keyedModule();
    const root = board.root();
    const [p1, p2] = board.choices;
    const owner = {};
    // the first call builds the pair state (the battle's copy for the reader's own questions): a cost of the cell, not of a draw
    keyedAdvance(owner, root, cellKey(0, 0), p1, p2, SEARCH_SEEDS[0], false);
    for (const seed of SEEDS) {
      const plain = clones(() => advancePositionWithLog(root, p1, p2, seed as never, { stopAtForcedSwitch: false }));
      const keyed = clones(() => keyedAdvance(owner, root, cellKey(0, 0), p1, p2, seed as never, false));
      expect(keyed, seed).toBe(plain);
    }
  });
});
