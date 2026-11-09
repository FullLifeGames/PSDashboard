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
import { sampleCell } from '../src/search/cell-sampler';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import { createRootPosition } from '../src/forward-model';

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
        // Round 86 (T323): the hashed seeds reach a paralysed target that cannot move on the same turn (a read the pair plan
        // falls back on, `cant:par`), which the five lattice seeds never drew in forty iterations: such a draw books no key.
        if (drawn!.classKey === null) {
          expect(drawn!.log.some(line => line.startsWith('|cant|')), `iteration ${iteration}`).toBe(true);
          continue;
        }
        seen.add(drawn!.classKey);
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

/**
 * Round 89 (#59, T322 block 1): the four trees of one search draw each root cell by quantile (`search/root-quantile.ts`): tree k
 * answers a die of chance p so that floor(4p) to ceil(4p) of the four trees see it come true, where the seeds of the stream gave
 * 0 to 4. A cell is checked when it holds the board's attack and the foe does not protect; its class key is read per tree.
 */
describe('(f) a real search draws its root cells by quantile: a die of chance p comes true in floor(4p) or ceil(4p) of four trees', () => {
  const settings = { depth: 1 as const, samples: 1 as const, tera: false as const, mode: 'mcts' as const, prove: false };
  const ironHead = { move: 'ironhead', chance: 0.3, token: '+flinch' };
  const thunderbolt = { move: 'thunderbolt', chance: 0.1, token: '+par' };
  const stoneEdge = { move: 'stoneedge', chance: 0.2, token: 'miss' };

  /** Per root cell that holds the attack: the class key of each of the four trees (undefined where a tree booked none). */
  function keysPerCell(serialized: string, attack: string, own: (choice: string) => boolean): Map<string, (string | undefined)[]> {
    const found = new Map<string, (string | undefined)[]>();
    for (let offset = 0; offset < 4; offset++) {
      const stats = mctsTreeSearch(serialized, settings, offset);
      for (const cell of stats.cells) {
        const p1 = stats.p1Options[Math.floor(cell.key / 10_000)].choice;
        const p2 = stats.p2Options[cell.key % 10_000].choice;
        if (!p1.includes(attack) || p2.includes('protect') || !own(p1)) continue;
        const name = `${p1} / ${p2}`;
        const row = found.get(name) ?? [undefined, undefined, undefined, undefined];
        row[offset] = cell.classKey;
        found.set(name, row);
      }
    }
    return found;
  }

  function expectStrata(found: Map<string, (string | undefined)[]>, die: { chance: number; token: string }, ownPart: (key: string) => string) {
    let checked = 0;
    for (const [name, keys] of found) {
      const keyed = keys.filter((key): key is string => key !== undefined);
      const count = keyed.filter(key => ownPart(key).includes(die.token)).length;
      expect(count, `${name}: ${keys}`).toBeLessThanOrEqual(Math.ceil(4 * die.chance));
      if (keyed.length === 4) {
        expect(count, `${name}: ${keys}`).toBeGreaterThanOrEqual(Math.floor(4 * die.chance));
        checked++;
      }
    }
    expect(checked, 'cells with four keyed trees').toBeGreaterThan(0);
  }

  const withBudget = (run: () => void) => {
    configureSearchBudget({ ...SEARCH_BUDGET_DEFAULT, iterations: 120 });
    try { run(); } finally { configureSearchBudget(null); }
  };

  describe('doubles', () => {
    const boards = [
      { name: 'Extrasensory flinch 10 percent', die: { chance: 0.1, token: '+flinch' }, attack: 'extrasensory', root: BOARDS.flinch.root },
      { name: 'Thunderbolt paralysis 10 percent', die: thunderbolt, attack: 'thunderbolt', root: BOARDS.paralysis.root },
      { name: 'Stone Edge miss 20 percent', die: stoneEdge, attack: 'stoneedge', root: BOARDS.miss.root },
      {
        name: 'Iron Head flinch 30 percent', die: ironHead, attack: 'ironhead',
        root: () => doublesRoot([pairSet('Fast', 'Aerodactyl', ['Iron Head', 'Protect'], SPEED), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])], slow()),
      },
    ];
    test.each(boards)('$name', ({ die, attack, root }) => {
      withBudget(() => {
        const found = keysPerCell(root().serialized, attack, () => true);
        expectStrata(found, die, key => key);
      });
    });
  });

  describe('singles', () => {
    const board = (attack: string) => rootOf(battleOf(
      'gen9customgame', [set('Aerodactyl', [attack, 'protect'])], [set('Snorlax', ['earthquake', 'rest'])],
    ));
    test.each([ironHead, thunderbolt, stoneEdge])('$move', die => {
      withBudget(() => {
        const found = keysPerCell(board(die.move).serialized, die.move, () => true);
        expect(found.size).toBeGreaterThan(0);
        // a singles key joins the sides' outcomes p1 first: the die belongs to the first part
        expectStrata(found, die, key => key.split('|')[0]);
      });
    });
  });
  describe('the weight of the drawn class rides with its key (`classWeight`, the Dex weight the merge weighs it by)', () => {
    const weightsOf = (serialized: string, attack: string): Map<string, number> => {
      const weights = new Map<string, number>();
      for (let offset = 0; offset < 4; offset++) {
        const stats = mctsTreeSearch(serialized, settings, offset);
        for (const cell of stats.cells) {
          if (cell.classKey === undefined || !stats.p1Options[Math.floor(cell.key / 10_000)].choice.includes(attack)) continue;
          expect(cell.classWeight, `${cell.classKey}`).toBeGreaterThan(0);
          weights.set(cell.classKey, cell.classWeight!);
        }
      }
      return weights;
    };

    test('doubles: Iron Head books 0.7 for the plain hit and 0.3 for the flinch', () => {
      withBudget(() => {
        const root = doublesRoot([pairSet('Fast', 'Aerodactyl', ['Iron Head', 'Protect'], SPEED), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])], slow());
        const weights = weightsOf(root.serialized, 'ironhead');
        expect(weights.get('p1a:ironhead>p2a=hit-nokill+flinch')).toBeCloseTo(0.3, 9);
        expect(weights.get('p1a:ironhead>p2a=hit-nokill')).toBeCloseTo(0.7, 9);
      });
    });

    test('singles: a tied cell books half of the sampler\'s weight for the order its tree drew', () => {
      withBudget(() => {
        const team = (species: string, move: string) => Teams.pack([{
          name: species, species, item: '', ability: 'No Ability', moves: [move], nature: 'Hardy',
          evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
        }, {
          name: 'Chansey', species: 'Chansey', item: '', ability: 'No Ability', moves: ['softboiled'], nature: 'Hardy',
          evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 4, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
        }]);
        const battle = new Battle({ formatid: toID('gen9customgame'), seed: '1,2,3,4', p1: { name: 'Alpha', team: team('Jolteon', 'Thunder') }, p2: { name: 'Beta', team: team('Jolteon', 'Thunder') } });
        if (battle.sides.some(side => side.requestState === 'teampreview')) { battle.choose('p1', 'team 12'); battle.choose('p2', 'team 12'); }
        for (const side of battle.sides) side.active[0]!.sethp(1);
        const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)));
        const sampled = sampleCell(root, 0, 'move thunder', 'move thunder', 3, cache, true).blend!.classes;
        const orders = new Set<string>();
        for (let offset = 0; offset < 4; offset++) {
          const stats = mctsTreeSearch(root.serialized, settings, offset);
          const i = stats.p1Options.findIndex(option => option.choice === 'move thunder');
          const j = stats.p2Options.findIndex(option => option.choice === 'move thunder');
          const cell = stats.cells.find(entry => entry.key === cellKey(i, j))!;
          expect(cell.classKey, `offset ${offset}`).toMatch(/^p[12]:/);
          expect(cell.classWeight, cell.classKey).toBeCloseTo(sampled.find(cls => cls.key === cell.classKey)!.weight, 9);
          orders.add(cell.classKey!.slice(0, 2));
        }
        expect(orders.size).toBeGreaterThan(0);
      });
    });

    test('singles: Iron Head books 0.7 for the plain hit and 0.3 for the flinch', () => {
      withBudget(() => {
        const board = rootOf(battleOf('gen9customgame', [set('Aerodactyl', ['ironhead', 'protect'])], [set('Snorlax', ['earthquake', 'rest'])]));
        const weights = weightsOf(board.serialized, 'ironhead');
        expect(weights.get('hit-nokill+flinch')).toBeCloseTo(0.3, 9);
        expect(weights.get('hit-nokill')).toBeCloseTo(0.7, 9);
      });
    });
  });
});
