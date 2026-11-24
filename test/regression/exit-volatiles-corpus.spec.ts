import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CORPUS, rebuildThrough } from './rebuild-through';

interface Row { id: string; turn: number; type: string; side: 0 | 1; body: string; gone: string[]; what: string }

const ROWS: Row[] = [
  { id: 'gen9doublesou-2553498001-unli98296xkqgwfdu8vatxnrins5waupw', turn: 5, type: 'Doubles OU', side: 1, body: 'Sableye', gone: ['taunt'], what: 'taunted, switches out of p2b, Roar drags it into p2a' },
  { id: 'gen9doublesou-2694776968', turn: 4, type: 'Doubles OU', side: 0, body: 'Grimmsnarl', gone: ['taunt'], what: 'the same shape' },
  { id: 'gen9championsvgc2026regmbbo3-2685328963', turn: 6, type: 'Champions VGC', side: 1, body: 'Sableye', gone: ['taunt'], what: 'the displaced Sableye enters turn 7 without its Taunt (guard)' },
  { id: 'smogtours-gen9ou-681732', turn: 31, type: 'Gen 9 OU', side: 1, body: 'Falco Peregrinus', gone: ['taunt', 'encore', 'disable', 'torment'], what: 'a body back from the bench holds none of the four (singles, guard)' },
];

describe('a body the game switched out returns without the volatiles its exit ended', () => {
  for (const row of ROWS) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.type} ${row.id} turn ${row.turn}: ${row.what}`, async () => {
      const { battle } = await rebuildThrough(row.id, row.turn);
      const body = battle.sides[row.side].pokemon.find(pokemon => pokemon.name === row.body);
      expect(body, `${row.body} is on the board`).toBeDefined();
      for (const id of row.gone) expect(Object.keys(body!.volatiles), `${row.body} at the turn ${row.turn + 1} boundary`).not.toContain(id);
    }, 300_000);
  }
});
