import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations, toId, type ReplayData } from '@fulllifegames/replay-core';
import { bankTeamsFor } from './bank-build';
import { CORPUS, rebuildThrough } from './rebuild-through';
import { diskCachedSmogonFetcher } from './smogon-fetch-cache';

// Rows skip without `.fit-corpus`. Each game type has a row: singles, Doubles OU, VGC SV and Champions.

interface Row { id: string; turn: number; type: string; what: string; copy: { slot: string; move: string }; target: { side: 'p1' | 'p2'; name: string } }

const ROWS: Row[] = [
  { id: 'smogtours-gen6ubers-902024', turn: 24, type: 'Gen 6 Ubers', what: 'Ditto copies Darkrai and plays its Sludge Bomb', copy: { slot: 'p1a', move: 'Sludge Bomb' }, target: { side: 'p2', name: 'Darkrai' } },
  { id: 'gen9doublesou-2694097898', turn: 6, type: 'Doubles OU', what: 'Ditto copies Dragonite and Protects', copy: { slot: 'p1a', move: 'Protect' }, target: { side: 'p2', name: 'Dragonite' } },
  { id: 'gen9vgc2025regi-2381808549', turn: 3, type: 'VGC SV', what: 'Ditto copies Zamazenta and plays Heavy Slam', copy: { slot: 'p1b', move: 'Heavy Slam' }, target: { side: 'p2', name: 'Zamazenta' } },
  { id: 'gen9vgc2026regi-2582571418', turn: 5, type: 'VGC SV', what: 'a Ditto copies Calyrex and plays Leech Seed', copy: { slot: 'p1a', move: 'Leech Seed' }, target: { side: 'p2', name: 'Calyrex' } },
  { id: 'gen9championsou-2694672446', turn: 26, type: 'Champions OU', what: 'Ditto copies Falinks and plays Knock Off', copy: { slot: 'p2a', move: 'Knock Off' }, target: { side: 'p1', name: 'Falinks' } },
];

type Replay = ReplayData & { formatid?: string };

async function builtMoves(row: Row): Promise<string[]> {
  const replay = JSON.parse(readFileSync(CORPUS(row.id), 'utf-8')) as Replay;
  const built = await bankTeamsFor({ log: replay.log, formatId: replay.formatid ?? row.id, parsed: parseReplayLogWithObservations(replay.log), fetcher: diskCachedSmogonFetcher() });
  const team = row.target.side === 'p1' ? built.teams?.p1Team : built.teams?.p2Team;
  const set = team?.find(entry => entry.name === row.target.name || entry.species.startsWith(row.target.name));
  if (!set) throw new Error(`${row.id}: no ${row.target.name} in the ${row.target.side} team`);
  return set.moves.map(move => toId(String(move)));
}

describe('a copy\'s move books to the body it copied, and the copy plays it', () => {
  for (const row of ROWS) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.type} ${row.id} turn ${row.turn}: ${row.what}`, async () => {
      expect(await builtMoves(row), `${row.target.name} holds ${row.copy.move}`).toContain(toId(row.copy.move));
      const { refusals } = await rebuildThrough(row.id, row.turn);
      const earlier = await rebuildThrough(row.id, row.turn - 1);
      const body = earlier.battle.sides[Number(row.copy.slot[1]) - 1].active['abcd'.indexOf(row.copy.slot[2])];
      const offered = body.getMoveRequestData().moves.find(entry => toId(entry.move) === toId(row.copy.move));
      expect(!!offered && !offered.disabled, `${row.copy.move} of ${row.copy.slot} is playable at the start of the turn`).toBe(true);
      expect(refusals - earlier.refusals, 'refusals of the turn').toBe(0);
    }, 300_000);
  }
});
