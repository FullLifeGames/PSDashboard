import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PRNG } from '@pkmn/sim';
import { createMatchupCache } from '../src/eval-function';
import { createRootPosition, legalChoices, positionBattle, type SimPosition } from '../src/forward-model';
import { benchOrder } from '../src/search/bench-order';
import { sampleCell } from '../src/search/cell-sampler';
import { SEARCH_SEEDS, cellSeedList } from '../src/search/leaf';
import { cellHash, positionKey } from '../src/search/root-quantile';
import { drawChild } from '../src/search/trend-probe';
import { VERIFY_PLAIN_SEEDS } from '../src/search/verify-cell';
import { PROBE_SEEDS } from '../src/cell-blend';
import { FALLBACK_SEEDS, pairCellSample } from '../src/pair/sampler';
import { countFainted } from '../src/search/leaf';

/**
 * Round 89 (#60, T324), A5 stage 2a: the matrix, the verify round, the pair sampler and the trend probe read one seed list per
 * cell (`cellSeedList(cellHash(positionKey(root), p1Choice, p2Choice), 16)`) where they read the fixed lists. Rows: (a) a die at a
 * fixed draw index of the first seed sits inside its binomial band over 200 cells of each path's own call, singles and doubles
 * (the fixed list gave every cell the same stream); (b) every seed a path reads belongs to its own cell's list and none is a
 * fixed seed; (c) the lists are shared: the matrix's first draw is the verify round's slot 0 and the pair sampler's first draw,
 * the trend probe rebuilds the child the matrix priced.
 */

const seen = vi.hoisted(() => ({ reads: [] as { root: unknown; p1: string; p2: string; seed: string }[] }));
vi.mock('../src/forward/advance', async importOriginal => {
  const real = await importOriginal<typeof import('../src/forward/advance')>();
  return {
    ...real,
    advancePosition: (root: SimPosition, p1: string, p2: string, seed: string, ...rest: unknown[]) => {
      seen.reads.push({ root, p1, p2, seed });
      return (real.advancePosition as (...a: unknown[]) => SimPosition)(root, p1, p2, seed, ...rest);
    },
    advancePositionWithLog: (root: SimPosition, p1: string, p2: string, seed: string, ...rest: unknown[]) => {
      seen.reads.push({ root, p1, p2, seed });
      return (real.advancePositionWithLog as (...a: unknown[]) => unknown)(root, p1, p2, seed, ...rest);
    },
  };
});

vi.mock('../src/pair/draw', async importOriginal => {
  const real = await importOriginal<typeof import('../src/pair/draw')>();
  return {
    ...real,
    drawPair: (root: SimPosition, p1: string, p2: string, seed: string, ...rest: unknown[]) => {
      seen.reads.push({ root, p1, p2, seed });
      return (real.drawPair as (...a: unknown[]) => unknown)(root, p1, p2, seed, ...rest);
    },
  };
});

const CELLS = 200;
const DRAWS = 8;
const PS = [1 / 24, 0.10, 0.30, 0.90];
const FIXED = new Set<string>([...SEARCH_SEEDS, ...PROBE_SEEDS, ...VERIFY_PLAIN_SEEDS, ...FALLBACK_SEEDS]);

const SINGLES = ['gen9ou-2658658993-t2', 'gen9ou-2658663776-t2', 'gen9ou-2658675932-t2'];
const DOUBLES = ['gen9doublesou-2660802611-t2', 'gen9doublesou-2660809089-t8', 'smogtours-gen9doublesou-912045-t6', 'gen9vgc2026regi-2629703929-t6'];

interface Cell { root: SimPosition; p1: string; p2: string }

const rootOf = (name: string): SimPosition => {
  const { serialized } = JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as { serialized: string };
  const order = benchOrder(serialized);
  return createRootPosition(order ? order.serialized : serialized);
};

/** `count` distinct cells over the fixtures: the product of both sides' legal choices, stepped through evenly. */
function cellsOf(names: string[], count: number): Cell[] {
  const per = Math.ceil(count / names.length);
  return names.flatMap(name => {
    const root = rootOf(name);
    const p1 = legalChoices(root, 'p1').map(option => option.choice);
    const p2 = legalChoices(root, 'p2').map(option => option.choice);
    const all = p1.flatMap(a => p2.map(b => ({ root, p1: a, p2: b })));
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
function readsOf(call: (cell: Cell) => void, cell: Cell): string[] {
  seen.reads.length = 0;
  call(cell);
  return seen.reads.filter(read => read.root === cell.root && read.p1 === cell.p1 && read.p2 === cell.p2).map(read => read.seed);
}

const matrix = (blendRoot: boolean, plainDraws?: number) => (cell: Cell) => {
  const fainted = countFainted(positionBattle(cell.root));
  sampleCell(cell.root, fainted, cell.p1, cell.p2, 5, createMatchupCache(), blendRoot, plainDraws);
};

const PATHS: Record<string, { cells: () => Cell[]; call: (cell: Cell) => void }> = {
  'singles matrix, plain draws': { cells: () => cellsOf(SINGLES, CELLS), call: matrix(false) },
  'singles matrix, blend': { cells: () => cellsOf(SINGLES, CELLS), call: matrix(true) },
  'doubles matrix, plain draws': { cells: () => cellsOf(DOUBLES, CELLS), call: matrix(false) },
  'doubles pair sampler': { cells: () => cellsOf(DOUBLES, CELLS), call: matrix(true) },
};

beforeEach(() => { seen.reads.length = 0; });

describe('(a) a die at a fixed draw index of the first seed follows its chance over 200 cells of each path', () => {
  test.each(Object.keys(PATHS))('%s', { timeout: 280_000 }, name => {
    const { cells, call } = PATHS[name];
    const firsts = cells().map(cell => readsOf(call, cell)[0]).filter(Boolean);
    expect(firsts.length).toBeGreaterThanOrEqual(CELLS * 0.9);
    const streams = firsts.map(streamOf);
    const misses: string[] = [];
    for (const p of PS) {
      for (let n = 0; n < DRAWS; n++) {
        const share = streams.filter(stream => stream[n] < p).length / streams.length;
        const value = (share - p) / Math.sqrt(p * (1 - p) / streams.length);
        if (Math.abs(value) > 4.5) misses.push(`draw ${n} p ${p.toFixed(3)}: z ${value.toFixed(2)}`);
      }
    }
    expect(misses).toEqual([]);
  });
});

describe('(b) every seed a path reads belongs to its cell\'s list, never to a fixed list', () => {
  test.each(Object.keys(PATHS))('%s', { timeout: 280_000 }, name => {
    const { cells, call } = PATHS[name];
    const stray: string[] = [];
    for (const cell of cells().slice(0, 60)) {
      const own = new Set(listOf(cell));
      for (const seed of readsOf(call, cell)) if (FIXED.has(seed) || !own.has(seed)) stray.push(`${cell.p1} / ${cell.p2}: ${seed}`);
    }
    expect(stray).toEqual([]);
  });

  test.each([['singles', SINGLES], ['doubles', DOUBLES]] as const)('%s verify round with plain draws: the 16 slots are the cell\'s list', { timeout: 280_000 }, (_, names) => {
    const stray: string[] = [];
    let reads = 0;
    for (const cell of cellsOf([...names], 40)) {
      const own = new Set(listOf(cell));
      const seeds = readsOf(matrix(true, 16), cell);
      reads += seeds.length;
      for (const seed of seeds) if (FIXED.has(seed) || !own.has(seed)) stray.push(`${cell.p1} / ${cell.p2}: ${seed}`);
    }
    expect(reads).toBeGreaterThan(40);
    expect(stray).toEqual([]);
  });
});

describe('(c) the paths share one list per cell', () => {
  test.each([['singles', SINGLES], ['doubles', DOUBLES]] as const)('%s: the matrix\'s first draw is the verify round\'s slot 0', { timeout: 280_000 }, (_, names) => {
    const wrong: string[] = [];
    for (const cell of cellsOf([...names], 40)) {
      const slot0 = listOf(cell, 1)[0];
      const plain = readsOf(matrix(true), cell)[0];
      const verify = readsOf(matrix(true, 16), cell)[0];
      if (plain !== slot0 || verify !== slot0) wrong.push(`${cell.p1} / ${cell.p2}: ${plain} ${verify} ${slot0}`);
    }
    expect(wrong).toEqual([]);
  });

  test('the pair sampler\'s first draw is the matrix\'s (doubles)', { timeout: 280_000 }, () => {
    const wrong: string[] = [];
    for (const cell of cellsOf(DOUBLES, 40)) {
      const pair = readsOf(c => { pairCellSample(c.root, c.p1, c.p2, 5, createMatchupCache()); }, cell)[0];
      const slot0 = listOf(cell, 1)[0];
      if (pair !== undefined && pair !== slot0) wrong.push(`${cell.p1} / ${cell.p2}: ${pair} ${slot0}`);
    }
    expect(wrong).toEqual([]);
  });

  test.each([['singles', SINGLES], ['doubles', DOUBLES]] as const)('%s: the trend probe rebuilds the child the matrix priced', { timeout: 280_000 }, (_, names) => {
    let checked = 0;
    const wrong: string[] = [];
    for (const cell of cellsOf([...names], 120)) {
      seen.reads.length = 0;
      const fainted = countFainted(positionBattle(cell.root));
      const sample = sampleCell(cell.root, fainted, cell.p1, cell.p2, 5, createMatchupCache(), true);
      const priced = seen.reads.filter(read => read.root === cell.root && read.p1 === cell.p1 && read.p2 === cell.p2).map(read => read.seed);
      for (const draw of sample.baseDraws ?? []) {
        if (draw.first || priced[draw.index] === undefined) continue;
        checked++;
        const expected = listOf(cell)[draw.index];
        // the matrix drew slot `index` of the cell's list; the probe's child must come from the same seed
        if (!priced.includes(expected)) wrong.push(`${cell.p1} / ${cell.p2}: slot ${draw.index} not priced`);
        const probe = readsOf(() => { drawChild(cell.root, cell.p1, cell.p2, draw); }, cell);
        if (probe[0] !== expected) wrong.push(`${cell.p1} / ${cell.p2}: probe read ${probe[0]}, matrix ${expected}`);
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });
});
