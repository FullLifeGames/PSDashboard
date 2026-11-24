import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { deserializeBattleExact } from '@fulllifegames/eval-engine';
import { rebuild } from './forced-reconstruction-support';

// Local: the rows skip without `.fit-corpus`.
const CORPUS = (id: string): string => join('.fit-corpus', `${id}.json`);

interface Row {
  id: string;
  turn: number;
  side: 'p1' | 'p2';
  body: string;
  type: 'singles' | 'doubles';
  pp: number;
  offered: boolean;
}

const ROWS: Row[] = [
  { id: 'gen9championsou-2692599072', turn: 6, side: 'p2', body: 'Pawmot', type: 'singles', pp: 0, offered: false },
  { id: 'gen9doublesou-2695388932', turn: 9, side: 'p2', body: 'Rabsca', type: 'doubles', pp: 0, offered: false },
  { id: 'gen9championsou-2691485449', turn: 14, side: 'p2', body: 'Pawmot', type: 'singles', pp: 1, offered: true },
];

describe.each(ROWS)('$id turn $turn: $body at the boundary ($type)', row => {
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
    const request = side.activeRequest;
    const entry = request && 'active' in request ? request.active?.[side.active.indexOf(body)]?.moves.find(move => move.id === 'revivalblessing') : undefined;
    expect(!!entry && !entry.disabled).toBe(row.offered);
  }, 600_000);
});
