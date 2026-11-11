import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations, toId, type ReplayData } from '@fulllifegames/replay-core';
import { bankTeamsFor } from './bank-build';
import { CORPUS, rebuildThrough, refusalsOfTurn } from './rebuild-through';
import { diskCachedSmogonFetcher } from './smogon-fetch-cache';

/**
 * Round 89 (#140): a Pledge combination or Round writes `|move|p1a: Primarina|Water Pledge|p2a: Torkoal|[from] move: Grass Pledge`.
 * Primarina used its own Water Pledge; the partner's Grass Pledge pulled it forward. The inference booked Grass Pledge on Primarina,
 * the build left Water Pledge out, and the simulator refused the rebuilt `move waterpledge`. Each row reads a corpus game (local: the
 * rows skip without `.fit-corpus`): the built Pokémon holds the move its line shows and not the move that pulled it forward, and the
 * turn adds no refusal. The unit and sweep rows are in `packages/replay-core/test/from-move-sweep.spec.ts`.
 *
 * Singles and Champions OU have no such line (a Pledge combination and Round's pull need an ally): 0 of 3,891 games of the log scan.
 */

interface Row { id: string; turn: number; type: string; what: string; side: 'p1' | 'p2'; body: string; shown: string; pulled: string }

const ROWS: Row[] = [
  { id: 'gen9vgc2025regh-2449821675', turn: 6, type: 'VGC SV', what: 'Primarina\'s Water Pledge pulled by Grass Pledge', side: 'p1', body: 'Primarina', shown: 'Water Pledge', pulled: 'Grass Pledge' },
  { id: 'gen9vgc2024regh-2200445950', turn: 1, type: 'VGC SV', what: 'the same combination in an older log form (`[from]move:`)', side: 'p2', body: 'Primarina', shown: 'Water Pledge', pulled: 'Grass Pledge' },
  { id: 'gen9doublesou-2693827934', turn: 1, type: 'Doubles OU', what: 'Primarina\'s Water Pledge pulled by Grass Pledge', side: 'p1', body: 'Primarina', shown: 'Water Pledge', pulled: 'Grass Pledge' },
  { id: 'gen9doublesou-2693835949', turn: 1, type: 'Doubles OU', what: 'the side that moves second in turn order', side: 'p2', body: 'Primarina', shown: 'Water Pledge', pulled: 'Grass Pledge' },
  { id: 'gen9championsvgc2026regmbbo3-2684790367', turn: 5, type: 'Champions VGC', what: 'Round pulled by Round: one slot, no second Round', side: 'p2', body: 'Glalie', shown: 'Round', pulled: 'Round' },
  { id: 'gen9championsvgc2026regmbbo3-2689580906', turn: 3, type: 'Champions VGC', what: 'Round pulled by Round: one slot, no second Round', side: 'p2', body: 'Primarina', shown: 'Round', pulled: 'Round' },
];

type Replay = ReplayData & { formatid?: string };

/** The built set of the side's body of that species, through the bank's and the app's build with the disk-cached Smogon data. */
async function builtMoves(id: string, side: 'p1' | 'p2', body: string): Promise<string[]> {
  const replay = JSON.parse(readFileSync(CORPUS(id), 'utf-8')) as Replay;
  const parsed = parseReplayLogWithObservations(replay.log);
  const built = await bankTeamsFor({ log: replay.log, formatId: replay.formatid ?? id, parsed, fetcher: diskCachedSmogonFetcher() });
  const team = side === 'p1' ? built.teams?.p1Team : built.teams?.p2Team;
  const set = team?.find(entry => entry.species === body);
  if (!set) throw new Error(`${id}: no ${body} in the ${side} team`);
  return set.moves.map(move => toId(String(move)));
}

describe('a Pledge combination and Round book the move the line shows (#140)', () => {
  for (const row of ROWS) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.type} ${row.id} turn ${row.turn}: ${row.what}`, async () => {
      const moves = await builtMoves(row.id, row.side, row.body);
      expect(moves, `${row.body} holds ${row.shown}`).toContain(toId(row.shown));
      // Round pulls Round: the shown move and the pulling move are one slot. A Pledge pulled by another Pledge leaves the partner's.
      if (row.pulled !== row.shown) expect(moves, `${row.body} lacks ${row.pulled}`).not.toContain(toId(row.pulled));
      expect(moves.filter(move => move === toId(row.shown)), `one slot for ${row.shown}`).toHaveLength(1);
      // The simulator accepts the rebuilt choice: the turn adds no refusal.
      expect(await refusalsOfTurn(row.id, row.turn, (await rebuildThrough(row.id, row.turn)).refusals), 'refusals of the turn').toBe(0);
    }, 300_000);
  }
});
