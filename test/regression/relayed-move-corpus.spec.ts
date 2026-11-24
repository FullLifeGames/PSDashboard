import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CORPUS, rebuildThrough, refusalsOfTurn } from './rebuild-through';

interface Row { id: string; turn: number; type: string; body: string; what: string; clean: boolean }

// The first row's p1 side drifted a turn earlier, so it reads only what its holder's side does.
const ROWS: Row[] = [
  { id: 'gen9championsvgc2026regmbbo3-2685328963', turn: 6, type: 'Champions VGC', body: 'p2b: Hatterene', what: 'Magic Bounce sends Taunt back, Sableye switches', clean: false },
  { id: 'gen9doublesou-2695107754', turn: 5, type: 'Doubles OU', body: 'p2a: Oricorio', what: 'Dancer copies Quiver Dance before the own Hurricane', clean: true },
  { id: 'gen9doublesou-2662172165', turn: 1, type: 'Doubles OU', body: 'p2a: Hatterene', what: 'Magic Bounce sends Taunt back', clean: true },
  { id: 'gen9vgc2024regh-2273232103', turn: 6, type: 'VGC', body: 'p1a: Hatterene', what: 'Magic Bounce in the old format without a space', clean: true },
  { id: 'gen9championsou-2695226263', turn: 1, type: 'Champions OU', body: 'p2a: Clefable', what: 'Magic Bounce sends Sticky Web back', clean: true },
  { id: 'smogtours-gen9ou-675419', turn: 9, type: 'Gen 9 OU', body: 'p1a: Hatterene', what: 'Magic Bounce sends Encore back (singles)', clean: true },
  { id: 'smogtours-gen5ubers-899931', turn: 25, type: 'Gen 5 Ubers', body: 'p1a: Giratina', what: 'Magic Coat sends Leech Seed back (singles)', clean: true },
];

const movesOf = (lines: string[], body: string, own: boolean): string[] =>
  lines.filter(line => line.startsWith(`|move|${body}|`) && (!own || !line.includes('[from]'))).map(line => line.split('|').slice(2, 4).join('|'));

const entrancesOf = (lines: string[], side: string): string[] =>
  lines.filter(line => line.startsWith(`|switch|${side}`)).map(line => line.split('|').slice(2, 4).join('|'));

describe('a move another effect wrote for a body is not its click', () => {
  for (const row of ROWS) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.type} ${row.id} turn ${row.turn}: ${row.what}`, async () => {
      const { logged, emitted, refusals } = await rebuildThrough(row.id, row.turn);
      expect(movesOf(logged, row.body, false).some(move => move.length > 0), 'the log has move lines of the body').toBe(true);
      expect(movesOf(emitted, row.body, true)).toEqual(movesOf(logged, row.body, true));
      expect(entrancesOf(emitted, row.body.slice(0, 2))).toEqual(entrancesOf(logged, row.body.slice(0, 2)));
      if (row.clean) {
        expect(movesOf(emitted, row.body, false)).toEqual(movesOf(logged, row.body, false));
        expect(await refusalsOfTurn(row.id, row.turn, refusals)).toBe(0);
      }
    }, 300_000);
  }
});
