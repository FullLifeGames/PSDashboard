import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CORPUS, rebuildThrough } from './rebuild-through';

/**
 * Round 89 (#138, the rest): a block that enters two bodies on one slot, the second a nicknamed Ditto that Imposter turned into a copy of
 * the foe, must leave the Ditto on the slot with its Transform. The correction looked the Ditto line up by the species `Ditto`, found
 * nothing (the body carries the copied species, its nickname `:)` has no letters), and the repoint of the entry before it took the
 * simulator's Ditto off the field and cleared it: the rebuilt Ditto had only Transform, copied the foe's Lilligant-Hisui at turn 20 and
 * played Close Combat at turn 21, where the log has Tera Blast twice.
 *
 * Each row rebuilds the game through the turn, like the bank does, and reads the turn's entrances, faints and moves: the rebuild plays what
 * the log shows. The unit and sweep rows are in `packages/eval-engine/test/pass-through-entries.spec.ts`.
 */
const ID = 'smogtours-gen9ru-887325';
const play = (lines: string[]) => lines.filter(line => /^\|(switch|drag|faint|move)\|/.test(line));

describe('a nicknamed Ditto with a Transform keeps its copy through its entry block (#138)', () => {
  for (const turn of [20, 21]) {
    test.skipIf(!existsSync(CORPUS(ID)))(`Gen 9 RU ${ID} turn ${turn}: Tera Blast of the copy, not Transform`, async () => {
      const { logged, emitted } = await rebuildThrough(ID, turn);
      expect(logged.some(line => line.startsWith('|move|p2a: :)|Tera Blast|')), 'the log has the Ditto\'s Tera Blast').toBe(true);
      expect(play(emitted)).toEqual(play(logged));
    }, 300_000);
  }
});
