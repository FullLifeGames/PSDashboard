import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PRNG } from '@pkmn/sim';
import { planCellEvents } from '../src/cell-blend';
import { createMatchupCache } from '../src/eval-function';
import { advancePosition, createRootPosition, legalChoices, positionBattle, type SimPosition } from '../src/forward-model';
import { endgameChildren } from '../src/endgame/children';
import { classesOf } from '../src/mcts';
import { benchOrder } from '../src/search/bench-order';
import { sampleCell } from '../src/search/cell-sampler';
import { SEARCH_SEEDS, cellSeedList, countFainted } from '../src/search/leaf';
import { createLocalExecutor } from '../src/search/position';
import { cellHash, positionKey } from '../src/search/root-quantile';
import { VERIFY_PLAIN_SEEDS } from '../src/search/verify-cell';
import { PROBE_SEEDS } from '../src/cell-blend';
import { FALLBACK_SEEDS } from '../src/pair/sampler';
import type { EvalSettings } from '../src/types';

/**
 * Round 89 (#60, T324), A5 stage 2b: the answer round's plain price (search/position.ts), the endgame's plain and class
 * children (endgame/children.ts) and the order of a log (mcts.ts classesOf) read the cell's own seed list where they read
 * `SEARCH_SEEDS[0]` or the fixed list. Rows: (a) a die at a fixed draw index of the first seed sits inside its binomial band
 * over 200 cells of each path's own call, singles and doubles; (b) every seed a path reads belongs to its cell's list and to no
 * fixed list; (c) the paths share the cell's slots: the answer round's plain price and the matrix's first draw read one seed,
 * the endgame children read slots 0 to 4 (plain: 0 to count - 1), the log order reads slot 0.
 */

const seen = vi.hoisted(() => ({
  reads: [] as { p1: string; p2: string; seed: string }[],
  /** The reach question of the odds plan (search/event-reach.ts) advances a scripted draw under its own seed: no price, not a read. */
  read(p1: string, p2: string, seed: string) {
    if (!new Error().stack?.includes('event-reach')) this.reads.push({ p1, p2, seed });
  },
}));
vi.mock('../src/forward/advance', async importOriginal => {
  const real = await importOriginal<typeof import('../src/forward/advance')>();
  return {
    ...real,
    advancePosition: (root: SimPosition, p1: string, p2: string, seed: string, ...rest: unknown[]) => {
      seen.read(p1, p2, seed);
      return (real.advancePosition as (...a: unknown[]) => SimPosition)(root, p1, p2, seed, ...rest);
    },
    advancePositionWithLog: (root: SimPosition, p1: string, p2: string, seed: string, ...rest: unknown[]) => {
      seen.read(p1, p2, seed);
      return (real.advancePositionWithLog as (...a: unknown[]) => unknown)(root, p1, p2, seed, ...rest);
    },
  };
});
vi.mock('../src/pair/draw', async importOriginal => {
  const real = await importOriginal<typeof import('../src/pair/draw')>();
  return {
    ...real,
    drawPair: (root: SimPosition, p1: string, p2: string, seed: string, ...rest: unknown[]) => {
      seen.read(p1, p2, seed);
      return (real.drawPair as (...a: unknown[]) => unknown)(root, p1, p2, seed, ...rest);
    },
  };
});

const CELLS = 200;
const DRAWS = 8;
const PS = [1 / 24, 0.10, 0.30, 0.90];
const FIXED = new Set<string>([...SEARCH_SEEDS, ...PROBE_SEEDS, ...VERIFY_PLAIN_SEEDS, ...FALLBACK_SEEDS]);

const SINGLES = ['gen9ou-2658658993-t2', 'gen9ou-2658663776-t2', 'gen9ou-2658675932-t2', 'smogtours-gen9ou-749351-t10', 'smogtours-gen9ou-749828-t23', 'smogtours-gen6ou-648453-t13'];
const DOUBLES = ['gen9doublesou-2660802611-t2', 'gen9doublesou-2660809089-t8', 'smogtours-gen9doublesou-912045-t6', 'gen9vgc2026regi-2629703929-t6', 'gen9doublesou-2663093831-t12'];
const SETTINGS: EvalSettings = { depth: 1, samples: 1, tera: false };

interface Cell { root: SimPosition; p1: string; p2: string }

const rootOf = (name: string): SimPosition => {
  const { serialized } = JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as { serialized: string };
  const order = benchOrder(serialized);
  return createRootPosition(order ? order.serialized : serialized);
};

/** `count` distinct cells over the fixtures, stepped through evenly; `keep` filters the product of both sides' legal choices. */
function cellsOf(names: string[], count: number, keep: (cell: Cell) => boolean = () => true): Cell[] {
  const per = Math.ceil(count / names.length);
  return names.flatMap(name => {
    const root = rootOf(name);
    const p1 = legalChoices(root, 'p1').map(option => option.choice);
    const p2 = legalChoices(root, 'p2').map(option => option.choice);
    const all = p1.flatMap(a => p2.map(b => ({ root, p1: a, p2: b }))).filter(keep);
    const step = Math.max(1, Math.floor(all.length / per));
    return all.filter((_, index) => index % step === 0).slice(0, per);
  }).slice(0, count);
}

const listOf = (cell: Cell, count = 16): string[] => cellSeedList(cellHash(positionKey(cell.root), cell.p1, cell.p2), count);

const streamOf = (seed: string): number[] => {
  const prng = new PRNG(seed as never);
  return Array.from({ length: DRAWS }, () => prng.random());
};

/** The seeds one call read for the cell, in order. */
function readsOf(call: (cell: Cell) => void | Promise<unknown>, cell: Cell): string[] {
  seen.reads.length = 0;
  const done = call(cell);
  if (done) throw new Error('an async call needs asyncReadsOf');
  return seen.reads.filter(read => read.p1 === cell.p1 && read.p2 === cell.p2).map(read => read.seed);
}

const priceJob = (cell: Cell) => ({ i: 0, j: 0, p1Choice: cell.p1, p2Choice: cell.p2, plain: true });
const plainPrice = (cell: Cell) => createLocalExecutor(cell.root.serialized).evalCells([priceJob(cell)]);

/**
 * Cells whose order a log settles are rare in the fixtures (26 over the singles ones), so the log-order rows also take the cells
 * of the children one advance of the first choices reaches under other seeds: each child is another position, another key.
 */
const LOG_FIXTURES = ['smogtours-gen9ou-751466-t2', 'smogtours-gen9ou-749351-t10', 'smogtours-gen6ou-649664-t14-g1', 'smogtours-gen6ou-649664-t14-g2', 'smogtours-gen8ou-573756-t73'];
function logCells(count: number): Cell[] {
  const cells: Cell[] = [];
  for (const name of LOG_FIXTURES) {
    const root = rootOf(name);
    const first = ['p1', 'p2'].map(side => legalChoices(root, side as 'p1' | 'p2')[0].choice);
    const roots = [root];
    for (let k = 1; k <= 14; k++) {
      const child = advancePosition(root, first[0], first[1], cellSeedList(k * 7919, 1)[0]);
      if (!positionBattle(child).ended) roots.push(child);
    }
    for (const position of roots) {
      const p1 = legalChoices(position, 'p1').map(option => option.choice);
      const p2 = legalChoices(position, 'p2').map(option => option.choice);
      for (const a of p1) for (const b of p2) if (twoEvents({ root: position, p1: a, p2: b })) cells.push({ root: position, p1: a, p2: b });
    }
  }
  return cells.slice(0, count);
}

/** Two events whose order a log settles: the cells `classesOf` reads a log for. */
const twoEvents = (cell: Cell): boolean => {
  const plan = planCellEvents(positionBattle(cell.root), cell.p1, cell.p2);
  return plan.kind === 'events' && plan.events.length >= 2;
};
const logOrder = (cell: Cell) => {
  const plan = planCellEvents(positionBattle(cell.root), cell.p1, cell.p2);
  if (plan.kind === 'events') classesOf({ position: cell.root } as never, cell.p1, cell.p2, plan.events);
};

const endgame = (cell: Cell) => { endgameChildren(cell.root, cell.p1, cell.p2); };

type Path = { cells: () => Cell[]; call: (cell: Cell) => void | Promise<unknown> };
const PATHS: Record<string, Path> = {
  'singles endgame children': { cells: () => cellsOf(SINGLES, CELLS), call: endgame },
  'doubles endgame children': { cells: () => cellsOf(DOUBLES, CELLS), call: endgame },
  'singles log order': { cells: () => logCells(CELLS), call: logOrder },
};
/** The answer round's plain price is async; its rows await the executor. */
const ASYNC_PATHS: Record<string, Pick<Path, 'cells'>> = {
  'singles answer plain price': { cells: () => cellsOf(SINGLES, CELLS) },
  'doubles answer plain price': { cells: () => cellsOf(DOUBLES, CELLS) },
};

async function asyncReads(cell: Cell): Promise<string[]> {
  seen.reads.length = 0;
  await plainPrice(cell);
  return seen.reads.filter(read => read.p1 === cell.p1 && read.p2 === cell.p2).map(read => read.seed);
}

beforeEach(() => { seen.reads.length = 0; });

function misses(firsts: string[]): string[] {
  const streams = firsts.map(streamOf);
  const out: string[] = [];
  for (const p of PS) {
    for (let n = 0; n < DRAWS; n++) {
      const share = streams.filter(stream => stream[n] < p).length / streams.length;
      const value = (share - p) / Math.sqrt(p * (1 - p) / streams.length);
      if (Math.abs(value) > 4.5) out.push(`draw ${n} p ${p.toFixed(3)}: z ${value.toFixed(2)}`);
    }
  }
  return out;
}

describe('(a) a die at a fixed draw index of the first seed follows its chance over 200 cells of each path', () => {
  test.each(Object.keys(PATHS))('%s', { timeout: 280_000 }, name => {
    const { cells, call } = PATHS[name];
    const firsts = cells().map(cell => readsOf(call, cell)[0]).filter(Boolean);
    expect(firsts.length).toBeGreaterThanOrEqual(name.includes('log') ? CELLS * 0.75 : CELLS * 0.9);
    expect(misses(firsts)).toEqual([]);
  });

  test.each(Object.keys(ASYNC_PATHS))('%s', { timeout: 280_000 }, async name => {
    const firsts: string[] = [];
    for (const cell of ASYNC_PATHS[name].cells()) {
      const seed = (await asyncReads(cell))[0];
      if (seed) firsts.push(seed);
    }
    expect(firsts.length).toBeGreaterThanOrEqual(CELLS * 0.9);
    expect(misses(firsts)).toEqual([]);
  });
});

describe('(b) every seed a path reads belongs to its cell\'s list, never to a fixed list', () => {
  test.each(Object.keys(PATHS))('%s', { timeout: 280_000 }, name => {
    const { cells, call } = PATHS[name];
    const stray: string[] = [];
    let reads = 0;
    for (const cell of cells().slice(0, 60)) {
      const own = new Set(listOf(cell));
      const seeds = readsOf(call, cell);
      reads += seeds.length;
      for (const seed of seeds) if (FIXED.has(seed) || !own.has(seed)) stray.push(`${cell.p1} / ${cell.p2}: ${seed}`);
    }
    expect(reads).toBeGreaterThan(20);
    expect(stray).toEqual([]);
  });

  test.each(Object.keys(ASYNC_PATHS))('%s', { timeout: 280_000 }, async name => {
    const stray: string[] = [];
    let reads = 0;
    for (const cell of ASYNC_PATHS[name].cells().slice(0, 60)) {
      const own = new Set(listOf(cell));
      const seeds = await asyncReads(cell);
      reads += seeds.length;
      for (const seed of seeds) if (FIXED.has(seed) || !own.has(seed)) stray.push(`${cell.p1} / ${cell.p2}: ${seed}`);
    }
    expect(reads).toBeGreaterThan(20);
    expect(stray).toEqual([]);
  });

  test('the answer round\'s sub-search without a draw prices the child of the cell\'s slot 0', { timeout: 280_000 }, async () => {
    const wrong: string[] = [];
    for (const [names, count] of [[SINGLES, 6], [DOUBLES, 6]] as const) {
      for (const cell of cellsOf([...names], count)) {
        seen.reads.length = 0;
        await createLocalExecutor(cell.root.serialized).subSearch({ i: 0, j: 0, p1Choice: cell.p1, p2Choice: cell.p2, settings: SETTINGS });
        const first = seen.reads.find(read => read.p1 === cell.p1 && read.p2 === cell.p2)?.seed;
        if (first !== listOf(cell, 1)[0]) wrong.push(`${cell.p1} / ${cell.p2}: ${first} ${listOf(cell, 1)[0]}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('(c) the paths share the cell\'s slots', () => {
  test.each([['singles', SINGLES], ['doubles', DOUBLES]] as const)('%s: the answer round\'s plain price reads the matrix\'s first draw', { timeout: 280_000 }, async (_, names) => {
    const wrong: string[] = [];
    for (const cell of cellsOf([...names], 40)) {
      const matrix = readsOf(c => { sampleCell(c.root, countFainted(positionBattle(c.root)), c.p1, c.p2, 5, createMatchupCache(), true); }, cell)[0];
      const price = (await asyncReads(cell))[0];
      if (price !== matrix || price !== listOf(cell, 1)[0]) wrong.push(`${cell.p1} / ${cell.p2}: ${price} ${matrix}`);
    }
    expect(wrong).toEqual([]);
  });

  test.each([['singles', SINGLES], ['doubles', DOUBLES]] as const)('%s: the endgame children read slots 0 to 4 of the cell and slot 0 first', { timeout: 280_000 }, (_, names) => {
    const wrong: string[] = [];
    let checked = 0;
    for (const cell of cellsOf([...names], 80)) {
      const seeds = readsOf(endgame, cell);
      if (seeds.length === 0) continue;
      checked++;
      const slots = new Set(listOf(cell, SEARCH_SEEDS.length));
      if (seeds[0] !== listOf(cell, 1)[0] || seeds.some(seed => !slots.has(seed))) wrong.push(`${cell.p1} / ${cell.p2}: ${seeds.join(' ')}`);
    }
    expect(checked).toBeGreaterThan(40);
    expect(wrong).toEqual([]);
  });

  test('the log order reads the matrix\'s first draw (singles)', { timeout: 280_000 }, () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const cell of logCells(120)) {
      const seeds = readsOf(logOrder, cell);
      checked++;
      if (seeds.length !== 1 || seeds[0] !== listOf(cell, 1)[0]) wrong.push(`${cell.p1} / ${cell.p2}: ${seeds.join(' ')}`);
    }
    expect(checked).toBeGreaterThan(20);
    expect(wrong).toEqual([]);
  });
});
