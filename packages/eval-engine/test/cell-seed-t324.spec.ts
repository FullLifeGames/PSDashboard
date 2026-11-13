import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { PRNG, State } from '@pkmn/sim';
import { deserializeBattleExact } from '../src/forward/serialize';
import { createRootPosition, type SimPosition } from '../src/forward/position';
import { benchOrder } from '../src/search/bench-order';
import { SEARCH_SEEDS, cellSeed, cellSeedList, treeSeed } from '../src/search/leaf';
import { cellHash, positionKey, positionSalt, rootSalt } from '../src/search/root-quantile';

/**
 * Round 89 (#60, T324), A5 stage 1: a seed per cell. Round 88 (E1) and A1b: the fixed seeds roll one number at one draw index
 * in every cell, so a die at draw n came true in 0 % or 100 % of a search's cells (a 20 % secondary in 73 to 80 % of a singles
 * matrix, a crit at 1.4 % against 4.2 %). Ruling 11 of 09.11.2026: one list of seeds per cell, read by every path as it reads
 * the fixed list today (slot s of today's list is `cellSeed(s, key)`), the key a hash of the saved position and the cell's two
 * choice strings, hashed once per root. Rows: (a) a die at a fixed draw index over 200 cell keys sits inside its binomial band,
 * (b) the four-number form and the prefix of the list, (c) no clash with `treeSeed`, the fixed seeds or another cell, (d) the
 * key reads the game state, not the bench order (649664 t14), is hashed once per root and moves with the cell.
 */

const KEYS = 200;
const INDEXES = 16;
const DRAWS = 12;
const PS = [1 / 24, 0.10, 0.30, 0.90];

const fixture = (name: string): { serialized: string } =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as { serialized: string };

/** Draw n of the stream the seed starts: the number the simulator compares with a chance. */
function draws(seed: string): number[] {
  const prng = new PRNG(seed as never);
  return Array.from({ length: DRAWS }, () => prng.random());
}

/** Key families: 200 distinct cells of three singles roots, of one doubles root, of one VGC root (choice strings of both shapes), and the integers. */
function families(): Record<string, number[]> {
  const salts = [
    positionSalt(fixture('gen9ou-2658658993-t2').serialized), rootSalt('singles-b'), rootSalt('singles-c'),
  ];
  const doubles = positionSalt(fixture('gen9doublesou-2660802611-t2').serialized);
  const vgc = positionSalt(fixture('gen9vgc2026regi-2629703929-t6').serialized);
  const single = (j: number) => (j < 4 ? `move ${j + 1}` : `switch ${j - 1}`);
  /** 144 distinct doubles choices: a move and a target for each of the two slots. */
  const pairOf = (j: number) =>
    `move ${1 + (j % 4)} ${(Math.floor(j / 4) % 3) - 1}, move ${1 + (Math.floor(j / 12) % 4)} ${(Math.floor(j / 48) % 3) - 1}`;
  const doublesCells = (salt: number) => Array.from({ length: KEYS }, (_, i) => cellHash(salt, pairOf(i % 100), pairOf(100 + Math.floor(i / 100))));
  return {
    singles: Array.from({ length: KEYS }, (_, i) => cellHash(salts[Math.floor(i / 81) % 3], single(i % 9), single(Math.floor(i / 9) % 9))),
    doubles: doublesCells(doubles),
    vgc: doublesCells(vgc),
    integers: Array.from({ length: KEYS }, (_, i) => i),
  };
}

const z = (share: number, p: number): number => (share - p) / Math.sqrt(p * (1 - p) / KEYS);

describe('(a) a seed per cell follows the Dex chance at a fixed draw index (T324)', () => {
  test.each(Object.keys(families()))('%s: every die at every draw index of every slot sits inside 4.5 SE, with an RMS z near 1', family => {
    const keys = families()[family];
    const misses: string[] = [];
    for (const p of PS) {
      const zs: number[] = [];
      for (let index = 0; index < INDEXES; index++) {
        const streams = keys.map(key => draws(cellSeed(index, key)));
        for (let n = 0; n < DRAWS; n++) {
          const value = z(streams.filter(stream => stream[n] < p).length / KEYS, p);
          zs.push(value);
          if (Math.abs(value) > 4.5) misses.push(`slot ${index} draw ${n} p ${p.toFixed(3)}: z ${value.toFixed(2)}`);
        }
      }
      const rms = Math.sqrt(zs.reduce((sum, value) => sum + value * value, 0) / zs.length);
      const inside = zs.filter(value => Math.abs(value) <= 2).length / zs.length;
      if (rms < 0.85 || rms > 1.15) misses.push(`p ${p.toFixed(3)}: RMS z ${rms.toFixed(2)}`);
      if (inside < 0.92) misses.push(`p ${p.toFixed(3)}: ${(inside * 100).toFixed(1)} % inside 2 SE`);
    }
    expect(misses).toEqual([]);
  });
});

describe('(b) the form of the seed and of the cell\'s list', () => {
  test('four numbers, each an integer from 1 to 65535, and a pure function of (slot, key)', () => {
    for (const key of [0, 1, 0xdeadbeef, 0xffffffff]) {
      for (const index of [0, 1, 4, 15, 40]) {
        expect(cellSeed(index, key)).toBe(cellSeed(index, key));
        const parts = cellSeed(index, key).split(',').map(Number);
        expect(parts).toHaveLength(4);
        for (const part of parts) {
          expect(Number.isInteger(part)).toBe(true);
          expect(part).toBeGreaterThan(0);
          expect(part).toBeLessThanOrEqual(0xffff);
        }
      }
    }
  });

  test('a path that reads the first n seeds of today\'s list reads the first n of the cell\'s list', () => {
    const key = cellHash(positionSalt(fixture('gen9ou-2658658993-t2').serialized), 'move 1', 'move 2');
    const list = cellSeedList(key, 16);
    expect(list).toHaveLength(16);
    list.forEach((seed, index) => expect(seed).toBe(cellSeed(index, key)));
    expect(cellSeedList(key, 5)).toEqual(list.slice(0, 5));
    expect(new Set(list).size).toBe(16);
  });
});

describe('(c) no stream is shared by accident', () => {
  test('no cell seed is a tree seed of 16 offsets and 600 iterations, a fixed seed, or the seed of another slot or cell', () => {
    const tree = new Set<string>();
    for (let iteration = 0; iteration < 600; iteration++) for (let offset = 0; offset < 16; offset++) tree.add(treeSeed(iteration, offset));
    const seen = new Map<string, string>();
    for (const [family, keys] of Object.entries(families())) {
      keys.forEach((key, cell) => {
        for (let index = 0; index < INDEXES; index++) {
          const seed = cellSeed(index, key);
          expect(tree.has(seed), `${family} cell ${cell} slot ${index}`).toBe(false);
          expect(SEARCH_SEEDS).not.toContain(seed);
          const first = seen.get(seed);
          // the families draw from different roots, so a repeat is a clash; the same key in two families (the integers) cannot occur
          expect(first, `${family} cell ${cell} slot ${index} repeats ${first}`).toBeUndefined();
          seen.set(seed, `${family} cell ${cell} slot ${index}`);
        }
      });
    }
  });
});

describe('(d) the key of a cell', () => {
  const reverseBench = (serialized: string): string => {
    const battle = deserializeBattleExact(serialized);
    for (const side of battle.sides) {
      const actives = side.active.length;
      side.pokemon = [...side.pokemon.slice(0, actives), ...side.pokemon.slice(actives).reverse()];
      side.pokemon.forEach((pokemon, slot) => { pokemon.position = slot; });
    }
    return JSON.stringify(State.serializeBattle(battle));
  };
  const canonical = (serialized: string): string => benchOrder(serialized)?.serialized ?? serialized;

  test('649664 t14: the two boards of one game state and its reversed bench give one key', () => {
    const g1 = fixture('smogtours-gen6ou-649664-t14-g1').serialized;
    const g2 = fixture('smogtours-gen6ou-649664-t14-g2').serialized;
    const keys = [g1, g2, reverseBench(g1)].map(text => positionKey(createRootPosition(canonical(text))));
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
    expect(cellSeed(0, cellHash(keys[1], 'move 1', 'move 2'))).toBe(cellSeed(0, cellHash(keys[0], 'move 1', 'move 2')));
  });

  test('a position is serialized once, and its key is the salt of its saved text', () => {
    const text = fixture('gen9doublesou-2660802611-t2').serialized;
    let reads = 0;
    const position: SimPosition = { get serialized() { reads += 1; return text; } };
    const first = positionKey(position);
    expect(positionKey(position)).toBe(first);
    expect(positionKey(position)).toBe(first);
    expect(reads).toBe(1);
    expect(first).toBe(positionSalt(text));
  });

  test('another position, another choice and the other side\'s choice each give another key', () => {
    const a = positionKey(createRootPosition(fixture('gen9ou-2658658993-t2').serialized));
    const b = positionKey(createRootPosition(fixture('gen9ou-2658663776-t2').serialized));
    expect(b).not.toBe(a);
    const base = cellHash(a, 'move 1', 'move 2');
    expect(cellHash(b, 'move 1', 'move 2')).not.toBe(base);
    expect(cellHash(a, 'move 2', 'move 2')).not.toBe(base);
    expect(cellHash(a, 'move 2', 'move 1')).not.toBe(base);
  });

  test('a shiny flag is no part of the game state: the key is the same with and without it (identity-blind.spec.ts)', () => {
    const text = fixture('gen9ou-2658658993-t2').serialized;
    const state = JSON.parse(text) as { sides: { pokemon: { details: string }[] }[] };
    expect(state.sides.every(side => side.pokemon.every(body => !body.details.includes('shiny')))).toBe(true);
    for (const side of state.sides) for (const body of side.pokemon) body.details += ', shiny';
    expect(positionSalt(JSON.stringify(state))).toBe(positionSalt(text));
  });
});
