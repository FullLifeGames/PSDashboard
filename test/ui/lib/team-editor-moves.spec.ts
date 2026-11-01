import { describe, expect, test } from 'vitest';
import { canonicalMove } from '../../../src/lib/team-editor';

/**
 * Round 83 (T308, GitHub issue #2): a move the species cannot learn is no error. `canonicalMove` reads the species' pool first,
 * then the generation's whole list; only a name neither list holds is unknown.
 */
const pool = ['Earthquake', 'Fire Fang'];
const every = ['Earthquake', 'Fire Fang', 'Power Whip', 'Spore'];

describe('canonicalMove', () => {
  test('a move of the species keeps its pool spelling and carries no note', () => {
    expect(canonicalMove(pool, 'fire fang', every)).toEqual({ canonical: 'Fire Fang', outside: false });
  });

  test('a move of the generation the species cannot learn resolves to the generation\'s spelling, marked outside', () => {
    expect(canonicalMove(pool, 'power whip', every)).toEqual({ canonical: 'Power Whip', outside: true });
  });

  test('a name the generation does not know is unknown', () => {
    expect(canonicalMove(pool, 'Moon Landing', every)).toEqual({ unknown: true });
  });

  test('a species without a pool of its own still reads the generation\'s list, and no note is possible', () => {
    expect(canonicalMove(undefined, 'spore', every)).toEqual({ canonical: 'Spore', outside: false });
    expect(canonicalMove([], 'Moon Landing', every)).toEqual({ unknown: true });
  });

  test('before the pools load, any name is taken as typed', () => {
    expect(canonicalMove(undefined, 'Magma Storm')).toEqual({ canonical: 'Magma Storm', outside: false });
    expect(canonicalMove(undefined, 'Magma Storm', [])).toEqual({ canonical: 'Magma Storm', outside: false });
  });
});
