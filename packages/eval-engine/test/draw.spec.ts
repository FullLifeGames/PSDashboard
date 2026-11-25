import { describe, expect, test } from 'vitest';
import { createMatchupCache } from '../src/eval-function';
import {
  advancePositionWithLog,
  positionBattle,
  serializeBattleStable,
  type SimPosition,
  createRootPosition,
} from '../src/forward-model';
import { simFastCounters } from '../src/forward/sim-fast/state';
import { loadSimMods } from '../src/forward/sim-mods';
import { configureSearchBudget, SEARCH_BUDGET_DEFAULT } from '../src/search/budget';
import { mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees } from '../src/mcts-merge';
import * as draws from '../src/pair/draw';
import { drawPair } from '../src/pair/draw';
import { pairCellSample } from '../src/pair/sampler';
import { cellKey } from '../src/rank';
import { treeSeed } from '../src/search/leaf';
import { SEARCH_SEEDS } from './seed-streams';
import type { CellBlend, MctsTreeStats } from '../src/types';
import { anchorRoot, doublesRoot, pairSet, PLAYED, QUIET, SPREAD } from './pair-battles';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { rootOf } from './secondary-classes-support';
import { sampleCell } from '../src/search/cell-sampler';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { AccuracyRecord, RollRecord } from '../src/pair/prng';

await loadSimMods('gen9championsou');

const cache = createMatchupCache();
const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20'];
const stampless = (log: readonly string[]): string[] => log.filter(line => !line.startsWith('|t:|'));
const SPEED = { nature: 'Jolly', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 } } as const;
// Snorlax at half speed would tie with a Munchlax in the residual order, and so would a Dragonite at 50.
const slow = () => [pairSet('Slow1', 'Snorlax', ['Rest', 'Protect']), pairSet('Slow2', 'Chansey', ['Rest', 'Protect'])];

async function keyedModule(): Promise<typeof import('../src/pair/tree-key')> {
  return import('../src/pair/tree-key');
}

function blendOf(root: SimPosition, p1: string, p2: string): CellBlend {
  const blend = blendIfPlanned(root, p1, p2);
  if (!blend) throw new Error(`no class plan for ${p1} / ${p2}`);
  return blend;
}

function blendIfPlanned(root: SimPosition, p1: string, p2: string): CellBlend | null {
  const cell = pairCellSample(root, p1, p2, 3, cache);
  return cell.kind === 'sample' && cell.sample.blend ? cell.sample.blend : null;
}

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
    if (stop) expect(pending).toBeGreaterThan(0);
  });

  test('the tree\'s keyed draw always stops at a forced switch (the rule of `stop` true above)', async () => {
    const { keyedAdvance } = await keyedModule();
    const root = anchorRoot();
    let pending = 0;
    for (const seed of SEEDS) {
      const plain = advancePositionWithLog(root, ...PLAYED, seed as never, { stopAtForcedSwitch: true });
      const keyed = keyedAdvance({}, root, cellKey(0, 0), ...PLAYED, seed as never);
      expect(keyed, seed).not.toBeNull();
      expect(keyed!.pendingSwitch, seed).toBe(plain.pendingSwitch);
      expect(serializeBattleStable(positionBattle(keyed!.child)), seed).toBe(serializeBattleStable(positionBattle(plain.child)));
      if (plain.pendingSwitch) pending++;
    }
    expect(pending).toBeGreaterThan(0);
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
      const first = keyedAdvance(owner, root, cellKey(0, 0), p1, p2, SEARCH_SEEDS[0]);
      expect(first?.classKey).toBe(blend.classes.find(cls => cls.hasFirst)?.key);
      for (let iteration = 0; iteration < 40; iteration++) {
        const drawn = keyedAdvance(owner, root, cellKey(0, 0), p1, p2, treeSeed(iteration, 1));
        expect(drawn).not.toBeNull();
        // The hashed seeds reach a paralysed target that cannot move on the same turn (`cant:par`, a read the pair plan
        // falls back on), which the five lattice seeds never drew in forty iterations: such a draw books no key.
        if (drawn!.classKey === null) {
          expect(drawn!.log.some(line => line.startsWith('|cant|')), `iteration ${iteration}`).toBe(true);
          continue;
        }
        seen.add(drawn!.classKey);
      }
      expect(blend.classes.map(cls => cls.key)).toEqual(expect.arrayContaining([...seen]));
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
      let planned = 0;
      for (const cell of keyed) {
        const [i, j] = [Math.floor(cell.key / 10_000), cell.key % 10_000];
        const blend = blendIfPlanned(root, stats.p1Options[i].choice, stats.p2Options[j].choice);
        if (!blend) continue;
        planned++;
        expect(blend.classes.map(cls => cls.key), `${stats.p1Options[i].choice} / ${stats.p2Options[j].choice}`).toContain(cell.classKey);
      }
      expect(planned).toBeGreaterThan(0);
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
    expect(keyedAdvance({}, root, cellKey(0, 0), 'move dragonclaw 1, move softboiled', 'move rest, move rest', SEARCH_SEEDS[0])).toBeNull();
  });

  test('a choice the pair plan does not parse is no keyed draw', async () => {
    const { keyedAdvance } = await keyedModule();
    expect(keyedAdvance({}, anchorRoot(), cellKey(0, 0), 'team 12', 'team 12', SEARCH_SEEDS[0])).toBeNull();
  });

  test('a cell with no uncertain event draws and books no key', async () => {
    const { keyedAdvance } = await keyedModule();
    const root = anchorRoot();
    const drawn = keyedAdvance({}, root, cellKey(0, 0), ...QUIET, SEARCH_SEEDS[0]);
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
    keyedAdvance(owner, root, cellKey(0, 0), p1, p2, SEARCH_SEEDS[0]);
    for (const seed of SEEDS) {
      const plain = clones(() => advancePositionWithLog(root, p1, p2, seed as never, { stopAtForcedSwitch: true }));
      const keyed = clones(() => keyedAdvance(owner, root, cellKey(0, 0), p1, p2, seed as never));
      expect(keyed, seed).toBe(plain);
    }
  });
});

describe('(f) a real search draws its root cells by quantile: a die of chance p comes true in floor(4p) or ceil(4p) of four trees', () => {
  const settings = { depth: 1 as const, samples: 1 as const, tera: false as const, mode: 'mcts' as const, prove: false };
  const ironHead = { move: 'ironhead', chance: 0.3, token: '+flinch' };
  const thunderbolt = { move: 'thunderbolt', chance: 0.1, token: '+par' };
  const stoneEdge = { move: 'stoneedge', chance: 0.2, token: 'miss' };

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

describe('(g) a root row reads the same through its marginals and through its cells', () => {
  // The merge corrects the visit mean of the top row and column by the cells of a keyed class mix: that holds
  // only while the row's visits and totals ARE the sums of its cells.
  const settings = { depth: 1 as const, samples: 1 as const, tera: false as const, mode: 'mcts' as const, prove: false };
  const boards = {
    doubles: () => doublesRoot([pairSet('Fast', 'Aerodactyl', ['Iron Head', 'Protect'], SPEED), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])], slow()).serialized,
    singles: () => rootOf(battleOf('gen9customgame', [set('Aerodactyl', ['ironhead', 'protect'])], [set('Snorlax', ['earthquake', 'rest'])])).serialized,
  };
  test.each(Object.keys(boards) as (keyof typeof boards)[])('%s: visits and totals of a row and a column equal the sums of the cells that did not end', name => {
    configureSearchBudget({ ...SEARCH_BUDGET_DEFAULT, iterations: 120 });
    try {
      let keyed = 0;
      for (let offset = 0; offset < 4; offset++) {
        const stats = mctsTreeSearch(boards[name](), settings, offset);
        const side = (marginal: number[], total: number[], pick: (key: number) => number) => marginal.forEach((visits, index) => {
          const cells = stats.cells.filter(cell => pick(cell.key) === index);
          expect(cells.some(cell => cell.ended), `${name} offset ${offset}`).toBe(false);
          expect(cells.reduce((sum, cell) => sum + cell.visits, 0), `${name} offset ${offset} visits ${index}`).toBe(visits);
          expect(cells.reduce((sum, cell) => sum + cell.total, 0), `${name} offset ${offset} total ${index}`).toBeCloseTo(total[index], 9);
          keyed += cells.filter(cell => cell.classKey !== undefined).length;
        });
        side(stats.p1N, stats.p1W, key => Math.floor(key / 10_000));
        side(stats.p2N, stats.p2W, key => key % 10_000);
      }
      expect(keyed, 'keyed cells seen').toBeGreaterThan(0);
    } finally { configureSearchBudget(null); }
  });
});

const withoutTimestamps = (log: string[]) => log.filter(line => !line.startsWith('|t:|'));

const rolls = (records: readonly { kind: string }[]) =>
  records.filter((record): record is RollRecord => record.kind === 'roll').map(record => record.key);

describe('the recording dice', () => {
  test('without scripts a draw is the plain advance: same log, same child', () => {
    const root = anchorRoot();
    const cache = createMatchupCache();
    for (const [p1, p2] of [PLAYED, SPREAD, QUIET]) {
      for (const seed of ['1,2,3,4', '5,6,7,8'] as const) {
        const plain = advancePositionWithLog(root, p1, p2, seed);
        const drawn = drawPair(root, p1, p2, seed, new Map(), cache);
        expect(withoutTimestamps(drawn.log)).toEqual(withoutTimestamps(plain.log));
        expect(drawn.child.serialized).toBe(plain.child.serialized);
      }
    }
  });

  test('the played cell writes down the Play Rough miss with its threshold and both bodies', () => {
    const drawn = drawPair(anchorRoot(), ...PLAYED, '1,2,3,4', new Map(), createMatchupCache());
    const miss = drawn.records.find(record => record.kind === 'accuracy' && record.key === 'p1b:playrough>p2b') as AccuracyRecord;
    expect(miss).toMatchObject({ numerator: 90, hit: false });
    expect(miss.snapshot?.attacker.species).toBe('Mawile-Mega');
    expect(miss.snapshot?.defender.species).toBe('Incineroar');
    expect(drawn.log).toContain('|-miss|p1b: Mawile|p2b: Incineroar');
  });

  test('a script answers one target of a spread move and leaves the other to the seed', () => {
    const root = anchorRoot();
    const cache = createMatchupCache();
    const natural = drawPair(root, ...SPREAD, '1,2,3,4', new Map(), cache);
    expect(rolls(natural.records)).toEqual(['p2a:matchagotcha>p1a', 'p2a:matchagotcha>p1b']);
    const scripted = drawPair(root, ...SPREAD, '1,2,3,4', new Map([['p2a:matchagotcha>p1a', { hit: false }]]), cache);
    expect(scripted.log).toContain('|-miss|p2a: Sinistcha|p1a: Sinistcha');
    expect(rolls(scripted.records)).toEqual(['p2a:matchagotcha>p1b']);
  });

  test('an answered roll still consumes its draw: repeating the seed\'s own answer changes nothing', () => {
    const root = anchorRoot();
    const cache = createMatchupCache();
    const natural = drawPair(root, ...PLAYED, '1,2,3,4', new Map(), cache);
    const repeated = drawPair(root, ...PLAYED, '1,2,3,4', new Map([['p1b:playrough>p2b', { hit: false }]]), cache);
    expect(withoutTimestamps(repeated.log)).toEqual(withoutTimestamps(natural.log));
    expect(repeated.child.serialized).toBe(natural.child.serialized);
  });

  test('a scripted roll sets the damage: the top roll hits harder than the bottom one', () => {
    const root = anchorRoot();
    const cache = createMatchupCache();
    const hpAfter = (roll: number) => {
      const drawn = drawPair(root, ...SPREAD, '1,2,3,4', new Map([['p2a:matchagotcha>p1b', { hit: true, crit: false, roll }]]), cache);
      const line = drawn.log.find(entry => /^\|-damage\|p1b: Mawile\|\d+\/125$/.test(entry))!;
      return Number(line.split('|')[3].split('/')[0]);
    };
    expect(hpAfter(0)).toBeLessThan(hpAfter(15));
  });

  test('the roll record carries the drawn roll, the crit flag and the defender\'s live HP at the hit', () => {
    const drawn = drawPair(anchorRoot(), ...SPREAD, '1,2,3,4', new Map(), createMatchupCache());
    const mawile = drawn.records.find((record): record is RollRecord => record.kind === 'roll' && record.key === 'p2a:matchagotcha>p1b')!;
    expect(mawile.roll).toBeGreaterThanOrEqual(0);
    expect(mawile.roll).toBeLessThanOrEqual(15);
    expect(typeof mawile.crit).toBe('boolean');
    // Mawile stands at 84/125 on the root; Life Dew heals a quarter (31) before Matcha Gotcha lands.
    expect(mawile.snapshot.defender.hp).toBe(115);
    expect(mawile.snapshot.spreadHit).toBe(true);
    const moveLine = drawn.log.slice(0, mawile.logIndex).reverse().find(line => line.startsWith('|move|'));
    expect(moveLine).toMatch(/^\|move\|p2a: Sinistcha\|Matcha Gotcha\|/);
  });

  test('a speed tie among move actions is written down', () => {
    const pika = (name: string) => pairSet(name, 'Pikachu', ['Thunderbolt', 'Protect'], {
      nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    });
    const blissey = (name: string) => pairSet(name, 'Blissey', ['Soft-Boiled', 'Protect']);
    const root = doublesRoot([pika('A'), blissey('B')], [pika('C'), blissey('D')]);
    const drawn = drawPair(root, 'move thunderbolt 1, move softboiled', 'move thunderbolt 1, move softboiled', '1,2,3,4', new Map(), createMatchupCache());
    expect(drawn.records.some(record => record.kind === 'tie')).toBe(true);
  });
});
