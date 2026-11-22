import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CORPUS, rebuildThrough } from './rebuild-through';

/**
 * Round 89 (#136): the protocol hides the target of a move that fails before it animates (`|move|p2b: Sableye|Disable||[still]`), and the
 * rebuild aimed it at the foe in slot a: the Disable or Encore that failed on a fresh switch-in landed on the body in slot a, and the
 * rebuilt body carried a volatile the game never gave it. Each row rebuilds a corpus game through the turn, like the bank does: the move
 * line of the block hides its target as the log's does, and the foe in slot a has no such volatile at the next boundary.
 * The unit rows and the sweep are in `packages/eval-engine/test/hidden-aim.spec.ts`.
 */
interface Row { id: string; turn: number; type: string; line: RegExp; victim: string; volatile: string }

const ROWS: Row[] = [
  { id: 'gen9championsvgc2026regmb-2670418325', turn: 4, type: 'Champions VGC', line: /^\|move\|p2b: Sableye\|Disable\|\|\[still\]/, victim: 'Maushold', volatile: 'disable' },
  { id: 'gen9championsvgc2026regmbbo3-2680286086', turn: 3, type: 'Champions VGC', line: /^\|move\|p2b: Sableye\|Encore\|\|\[still\]/, victim: 'Snorlax', volatile: 'encore' },
  { id: 'gen9doublesou-2694495604', turn: 4, type: 'Doubles OU', line: /^\|move\|p1b: Cheerleader\|Encore\|\|\[still\]/, victim: 'Charjabug', volatile: 'encore' },
  { id: 'gen9vgc2024regg-2154103243', turn: 2, type: 'VGC', line: /^\|move\|p2a: Iron Valiant\|Disable\|\|\[still\]/, victim: 'Farigiraf', volatile: 'disable' },
];

describe('a failed move whose target the protocol hides lands on no one (#136)', () => {
  for (const row of ROWS) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.type} ${row.id} turn ${row.turn}: ${row.victim} keeps its moves`, async () => {
      const { logged, emitted, battle } = await rebuildThrough(row.id, row.turn);
      const hidden = (lines: string[]) => lines.find(line => row.line.test(line));
      expect(hidden(logged), 'the log hides the target').toBeDefined();
      expect(hidden(emitted), 'the rebuild\'s block hides it too').toBeDefined();
      const bodies = battle.sides.flatMap(side => side.pokemon).filter(pokemon => pokemon.name === row.victim);
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) expect(Object.keys(body.volatiles), `${row.victim} at the next boundary`).not.toContain(row.volatile);
    }, 300_000);
  }
});
