import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { deserializeBattleExact } from '@fulllifegames/eval-engine';
import { rebuild } from './forced-reconstruction-support';

/**
 * Round 89 (#106): the PP a move has left, on the corpus games where Revival Blessing (1 PP) was used and the same body moves again. The
 * Evaluation panel ranked the move first at the next boundary: the rebuilt slot read 1/1 where the game's read 0/1. Three scenes of the
 * probe of lanes/C/c1-pp.txt (40 games with the move, 12 of them wrong at a boundary before the fix):
 * - cause A, singles: 2692599072 turn 5, Pawmot's built Leppa Berry eats in the rebuild and restores the move; the log shows no berry;
 * - cause B, doubles: 2695388932 turn 8, the rebuild knocks Rabsca out before it acts, so the move never runs there;
 * - the guard, singles: 2691485449 turns 13 and 14, the log shows the Leppa Berry, so the move reads 1/1 at turn 14 and stays on offer.
 * The games sit in the local fit corpus (`.fit-corpus`), which a clone lacks: the rows then skip.
 *
 * `through` stops the rebuild at the boundary, whose position is corrected from the snapshot like the position the app evaluates.
 */
const CORPUS = (id: string): string => join('.fit-corpus', `${id}.json`);

interface Row {
  id: string;
  turn: number;
  side: 'p1' | 'p2';
  body: string;
  type: 'singles' | 'doubles';
  /** The slot's PP at the boundary, and whether the ranking offers the move. */
  pp: number;
  offered: boolean;
}

const ROWS: Row[] = [
  { id: 'gen9championsou-2692599072', turn: 6, side: 'p2', body: 'Pawmot', type: 'singles', pp: 0, offered: false },
  { id: 'gen9doublesou-2695388932', turn: 9, side: 'p2', body: 'Rabsca', type: 'doubles', pp: 0, offered: false },
  { id: 'gen9championsou-2691485449', turn: 14, side: 'p2', body: 'Pawmot', type: 'singles', pp: 1, offered: true },
];

describe.each(ROWS)('#106 $id turn $turn: $body at the boundary ($type)', row => {
  test.skipIf(!existsSync(CORPUS(row.id)))('the slot holds the log\'s count and the ranking offers what the game can click', async () => {
    const rebuilt = await rebuild(row.id, { corpus: true, through: row.turn });
    const serialized = rebuilt.positions.get(row.turn);
    expect(serialized).toBeDefined();
    const battle = deserializeBattleExact(serialized!);
    const side = battle.sides[row.side === 'p1' ? 0 : 1];
    const body = side.pokemon.find(pokemon => pokemon.name === row.body)!;
    const slot = body.baseMoveSlots.find(entry => entry.id === 'revivalblessing')!;
    expect(slot.pp).toBe(row.pp);
    if (!side.active.includes(body)) return;
    // The ranking lists what the side's request offers: the move is on offer when its entry in the request is enabled.
    const request = side.activeRequest;
    const entry = request && 'active' in request ? request.active?.[side.active.indexOf(body)]?.moves.find(move => move.id === 'revivalblessing') : undefined;
    expect(!!entry && !entry.disabled).toBe(row.offered);
  }, 600_000);
});
