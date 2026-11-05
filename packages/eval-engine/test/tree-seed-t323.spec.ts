import { describe, expect, test } from 'vitest';
import { PRNG } from '@pkmn/sim';
import { SEARCH_SEEDS, treeSeed } from '../src/search/leaf';

/**
 * Round 86 (the engine reads the dice, A13): the seed of a tree's cell. The five SEARCH_SEEDS are one arithmetic
 * progression of the Gen 5 LCG state, so a die at draw n came true in 0 or 20 % of a tree's cells at p = 0.10, never in
 * a tenth, and the same five numbers decided every position. A tree's seed is now a pure hash of (offset, iteration).
 */

const OFFSETS = [0, 1, 2, 3];
const ITERATIONS = 600;
const DRAWS = 12;
const PS = [0.10, 0.30, 0.85];

/** Draw n of the stream the seed starts: the number the simulator compares with a chance. */
function draws(seed: ReturnType<typeof treeSeed>): number[] {
  const prng = new PRNG(seed);
  return Array.from({ length: DRAWS }, () => prng.random());
}

/** Inside four standard errors of the binomial share. */
function inBand(share: number, p: number, n: number): boolean {
  return Math.abs(share - p) <= 4 * Math.sqrt(p * (1 - p) / n);
}

describe('tree seeds follow the Dex chance (T323)', () => {
  test('draw n falls under p in a binomial share of the streams, over all trees and in each tree', () => {
    const streams = OFFSETS.map(offset => Array.from({ length: ITERATIONS }, (_, iteration) => draws(treeSeed(iteration, offset))));
    const misses: string[] = [];
    for (let n = 0; n < DRAWS; n++) {
      for (const p of PS) {
        const all = streams.flat();
        const share = all.filter(stream => stream[n] < p).length / all.length;
        if (!inBand(share, p, all.length)) misses.push(`all draw ${n} p ${p}: ${share.toFixed(3)}`);
        streams.forEach((own, offset) => {
          const ownShare = own.filter(stream => stream[n] < p).length / own.length;
          if (!inBand(ownShare, p, own.length)) misses.push(`offset ${offset} draw ${n} p ${p}: ${ownShare.toFixed(3)}`);
        });
      }
    }
    expect(misses).toEqual([]);
  });

  test('the seed is a pure function of (offset, iteration), in the simulator\'s four-number form', () => {
    for (const offset of [0, 1, 7, 15]) {
      for (const iteration of [0, 1, 599]) {
        expect(treeSeed(iteration, offset)).toBe(treeSeed(iteration, offset));
        const parts = treeSeed(iteration, offset).split(',').map(Number);
        expect(parts).toHaveLength(4);
        for (const part of parts) {
          expect(Number.isInteger(part)).toBe(true);
          expect(part).toBeGreaterThan(0);
          expect(part).toBeLessThanOrEqual(0xffff);
        }
      }
    }
  });

  test('no two trees share a stream: not within an iteration, not over the whole schedule, and none is a SEARCH_SEED', () => {
    const seen = new Map<string, string>();
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      for (const offset of [...OFFSETS, 4, 5, 6, 7, 15]) {
        const seed = treeSeed(iteration, offset);
        const first = seen.get(seed);
        expect(first, `offset ${offset} iteration ${iteration} repeats ${first}`).toBeUndefined();
        seen.set(seed, `offset ${offset} iteration ${iteration}`);
        expect(SEARCH_SEEDS).not.toContain(seed);
      }
    }
  });
});
