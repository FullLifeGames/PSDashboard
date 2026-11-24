import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CORPUS, rebuildThrough } from './rebuild-through';

// The correction must not find the Ditto by species: the body carries the copied species, its nickname has no letters.
const ID = 'smogtours-gen9ru-887325';
const play = (lines: string[]) => lines.filter(line => /^\|(switch|drag|faint|move)\|/.test(line));

describe('a nicknamed Ditto with a Transform keeps its copy through its entry block', () => {
  for (const turn of [20, 21]) {
    test.skipIf(!existsSync(CORPUS(ID)))(`Gen 9 RU ${ID} turn ${turn}: Tera Blast of the copy, not Transform`, async () => {
      const { logged, emitted } = await rebuildThrough(ID, turn);
      expect(logged.some(line => line.startsWith('|move|p2a: :)|Tera Blast|')), 'the log has the Ditto\'s Tera Blast').toBe(true);
      expect(play(emitted)).toEqual(play(logged));
    }, 300_000);
  }
});
