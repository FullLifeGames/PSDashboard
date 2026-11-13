import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CORPUS, rebuildThrough } from './rebuild-through';

/**
 * Round 89 (#137): the simulator draws the foe a move is aimed at when the click names none (a move an Encore bent, a move that picks
 * its foe) and the body a drag brings in. The log shows both, and the rebuild used to draw its own: Sableye's Encore bent Gallade's click
 * to Taunt and the log shows Corviknight as the target, the rebuild taunted Sableye; Incineroar's Roar dragged Sableye in and the
 * rebuild dragged another body. Each row rebuilds a corpus game through the turn, like the bank does, and reads the lines that name the
 * draw in the rebuild's block against the log's.
 * The reader's unit rows are in `packages/eval-engine/test/dice-logged-results.spec.ts`, the sweeps over every Dex move and item in
 * `dice-random-target-sweep.spec.ts` and `dice-drag-sweep.spec.ts`.
 */
interface Row {
  id: string;
  turn: number;
  type: string;
  /** The lines of the log's block that name the draw: the rebuild's block must hold each of them. */
  lines: string[];
  /** The volatile a body carries (or lacks) at the next boundary: `[side index, body name, volatile, has]`. */
  volatiles?: [number, string, string, boolean][];
}

const ROWS: Row[] = [
  {
    id: 'gen9championsvgc2026regmb-2658911747', turn: 6, type: 'Champions VGC',
    lines: ['|move|p1a: Gallade|Taunt|p2a: Corviknight', '|-start|p2a: Corviknight|move: Taunt'],
    volatiles: [[1, 'Corviknight', 'taunt', true], [1, 'Sableye', 'taunt', false]],
  },
  {
    id: 'gen9doublesou-2553498001-unli98296xkqgwfdu8vatxnrins5waupw', turn: 5, type: 'Doubles OU',
    lines: ['|drag|p2a: Sableye|Sableye, F|100/100', '|-damage|p2a: Sableye|88/100|[from] Stealth Rock', '|-damage|p2a: Sableye|72/100|[from] Spikes'],
  },
  {
    // Encore bends Emergency Button's click to Draining Kiss (one target): the game drew Emergency Button, the rebuild Kleavor
    id: 'gen9championsvgc2026regma-2612217762', turn: 2, type: 'Champions VGC',
    lines: ['|move|p1a: Emergency Button|Encore|p2b: Sylveon', '|move|p2b: Sylveon|Draining Kiss|p1a: Emergency Button'],
  },
  {
    // a spread move an Encore bent (Snarl): the line names the foe the draw gave first
    id: 'gen9vgc2025regh-2460267628', turn: 2, type: 'VGC',
    lines: ['|move|p1b: Whimsicott|Encore|p2b: Archaludon', '|move|p2b: Archaludon|Snarl|p1a: Scrafty|[spread] p1a,p1b'],
  },
  {
    // Mortal Spin (a spread move) and Stealth Rock (a move on the foe's side) on the first turn: both name the foe the draw gave
    id: 'gen9doublesou-2543324419', turn: 1, type: 'Doubles OU',
    lines: ['|move|p2b: Glimmora|Mortal Spin|p1a: Diancie|[spread] p1a,p1b', '|move|p1b: Landorus|Stealth Rock|p2b: Glimmora'],
  },
  { id: 'gen9ou-2662176069', turn: 1, type: 'OU', lines: ['|drag|p1a: Walking Wake|Walking Wake|100/100'] },
  { id: 'gen9championsou-2691886974', turn: 1, type: 'Champions OU', lines: ['|drag|p1a: Archaludon|Archaludon, L50, F|100/100'] },
  { id: 'smogtours-gen5ubers-901915', turn: 1, type: 'Gen 5 Ubers', lines: ['|drag|p1a: Arceus|Arceus-Steel|100/100'] },
];

describe('the rebuild plays the random target and the drag the log shows (#137)', () => {
  for (const row of ROWS) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.type} ${row.id} turn ${row.turn}`, async () => {
      const { logged, emitted, battle } = await rebuildThrough(row.id, row.turn);
      for (const line of row.lines) {
        expect(logged, 'the log').toContain(line);
        expect(emitted, 'the rebuild').toContain(line);
      }
      for (const [side, name, volatile, has] of row.volatiles ?? []) {
        const body = battle.sides[side].pokemon.find(pokemon => pokemon.name === name);
        expect(body, name).toBeDefined();
        expect(Object.keys(body!.volatiles).includes(volatile), `${name} and ${volatile} at the next boundary`).toBe(has);
      }
    }, 300_000);
  }
});
