import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CORPUS, rebuildThrough, refusalsOfTurn } from './rebuild-through';

/**
 * Round 89 (#143): a move the simulator refuses turned the whole side to `default`. Each row rebuilds a corpus game through the turn,
 * like the bank does: the turn adds no refusal, and the side keeps the actions the log shows (the switch of a partner, the move lines of
 * both bodies, the Tera or Mega click). The unit and sweep rows are in `packages/eval-engine/test/refused-choice-stand-in.spec.ts`.
 */

/** `side`: the side whose actions the row reads (the other side's block drifts by its own cause); both when absent. */
interface Row { id: string; turn: number; type: string; what: string; side?: 'p1' | 'p2' }

const ROWS: Row[] = [
  { id: 'gen9vgc2025regg-2318522075', turn: 7, type: 'VGC', what: 'Disable stops Dragonite and the log shows Struggle (a Choice item held it)' },
  { id: 'smogtours-gen6ubers-902024', turn: 24, type: 'Gen 6 Ubers', what: 'a refused move in singles' },
  { id: 'gen9doublesou-2694097898', turn: 6, type: 'Doubles OU', what: 'a refused move in doubles (the p1 side drifts: Chi-Yu enters a turn early)', side: 'p2' },
  { id: 'gen9championsvgc2026regmc-2693006013', turn: 11, type: 'Champions VGC', what: 'Encore lands, then Disable stops Archaludon\'s Dragon Pulse' },
  { id: 'gen9championsvgc2026regmc-2693006013', turn: 12, type: 'Champions VGC', what: 'the turn after the Encore then Disable shape' },
  { id: 'gen9championsvgc2026regmb-2674079451', turn: 5, type: 'Champions VGC', what: 'Encore then Disable on Toxapex' },
];

/** The actions of a block the choice decides: the move and switch lines, with the actor and the move or body. */
const actionsOf = (lines: string[]): string[] =>
  lines.filter(line => /^\|(?:move|switch|-terastallize|-mega)\|/.test(line) && !line.includes('[from]')).map(line => line.split('|').slice(1, 4).join('|'));

describe('a refused choice keeps the rest of the side (#143)', () => {
  for (const row of ROWS) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.type} ${row.id} turn ${row.turn}: ${row.what}`, async () => {
      const { logged, emitted, refusals } = await rebuildThrough(row.id, row.turn);
      expect(await refusalsOfTurn(row.id, row.turn, refusals), 'refusals of the turn').toBe(0);
      const own = (action: string) => (action.startsWith('switch') || action.startsWith('-')) && (!row.side || action.includes(`|${row.side}`));
      expect(actionsOf(emitted).filter(own)).toEqual(actionsOf(logged).filter(own));
    }, 300_000);
  }
});
