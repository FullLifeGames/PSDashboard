import { describe, expect, test } from 'vitest';
import { rulesDex } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { secondariesIn } from '../src/dice/secondaries';
import { secondaryEffectId } from '../src/dice/recognize';
import type { SecondaryEntry } from '../src/dice/types';

/**
 * Round 82 (forced dice), step A6: `secondariesIn(dex)` is what the first turn's log reader takes from the Dex (the effect ids of a
 * move's secondaries that carry a chance below 100). It lives in the module beside `recognize.ts`, which names the ids.
 */
await loadSimMods('gen9championsou');

const GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;

describe('secondariesIn reads the entries of the game\'s own Dex', () => {
  test.each(GENS)('rule set %i: every move gives the ids of its entries with a chance below 100', gen => {
    const dex = rulesDex(gen);
    const read = secondariesIn(dex);
    let moves = 0;
    for (const move of dex.moves.all()) {
      const entries = (move.secondaries ?? (move.secondary ? [move.secondary] : [])) as SecondaryEntry[];
      const wanted = entries.filter(entry => entry.chance !== undefined && entry.chance < 100).map(entry => secondaryEffectId(entry));
      expect(read(move.id), move.id).toEqual(wanted);
      moves += 1;
    }
    expect(moves).toBeGreaterThan(100);
  });

  test('Fire Fang names its burn and its flinch, Thunder Wave and a sure effect name nothing', () => {
    const read = secondariesIn(rulesDex(9));
    expect(read('firefang').sort()).toEqual(['brn', 'flinch']);
    expect(read('thunderwave')).toEqual([]);
    expect(read('nosuchmove')).toEqual([]);
  });
});
