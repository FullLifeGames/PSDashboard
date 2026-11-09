import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CORPUS, rebuildThrough } from './rebuild-through';

/**
 * Round 89 (#138): a body the game switched out comes back without the volatiles its exit ended. Each row rebuilds a corpus game
 * through the turn, like the bank does, and reads the body's volatiles at the next boundary. The log gives no Taunt, Encore or Disable
 * to the body after its exit, so the simulator holds none. The unit and sweep rows are in
 * `packages/eval-engine/test/exit-corrections.spec.ts`.
 */

interface Row { id: string; turn: number; type: string; side: 0 | 1; body: string; gone: string[]; what: string }

const ROWS: Row[] = [
  { id: 'gen9doublesou-2553498001-unli98296xkqgwfdu8vatxnrins5waupw', turn: 5, type: 'Doubles OU', side: 1, body: 'Sableye', gone: ['taunt'], what: 'taunted, switches out of p2b, Roar drags it into p2a' },
  { id: 'gen9doublesou-2694776968', turn: 4, type: 'Doubles OU', side: 0, body: 'Grimmsnarl', gone: ['taunt'], what: 'the same shape' },
  // Guard rows: the red scene of the issue reads right on the base once the relayed-move fix (#135) lets the switch of turn 6 through, and
  // the singles row of the issue (a Taunt of Falco Peregrinus at boundary 32) does not reproduce on the base at this head either.
  { id: 'gen9championsvgc2026regmbbo3-2685328963', turn: 6, type: 'Champions VGC', side: 1, body: 'Sableye', gone: ['taunt'], what: 'the displaced Sableye enters turn 7 without its Taunt (guard)' },
  { id: 'smogtours-gen9ou-681732', turn: 31, type: 'Gen 9 OU', side: 1, body: 'Falco Peregrinus', gone: ['taunt', 'encore', 'disable', 'torment'], what: 'a body back from the bench holds none of the four (singles, guard)' },
];

describe('a body the game switched out returns without the volatiles its exit ended (#138)', () => {
  for (const row of ROWS) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.type} ${row.id} turn ${row.turn}: ${row.what}`, async () => {
      const { battle } = await rebuildThrough(row.id, row.turn);
      const body = battle.sides[row.side].pokemon.find(pokemon => pokemon.name === row.body);
      expect(body, `${row.body} is on the board`).toBeDefined();
      for (const id of row.gone) expect(Object.keys(body!.volatiles), `${row.body} at the turn ${row.turn + 1} boundary`).not.toContain(id);
    }, 300_000);
  }
});
