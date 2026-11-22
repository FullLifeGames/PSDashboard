import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations, toId, type ReplayData } from '@fulllifegames/replay-core';
import { bankTeamsFor } from './bank-build';
import { CORPUS, rebuildThrough } from './rebuild-through';
import { diskCachedSmogonFetcher } from './smogon-fetch-cache';

/**
 * Round 89 (#139): a body under Transform uses the moves of its target, so a move line of the copy shows that the target knows the
 * move (`|move|p1a: Ditto|Protect|p1a: Ditto`, the copy of the foe's Dragonite). The inference dropped such a line: the built target
 * lacked the move, the rebuilt copy could not play it, and the simulator refused the click. Each row reads a corpus game (local: the
 * rows skip without `.fit-corpus`): the built target holds the move, the copy's request at the start of the turn offers it (the copy
 * plays its logged move, the click needs no stand-in), and the turn adds no refusal. The unit rows are in
 * `packages/replay-core/test/transform-booking.spec.ts`, the sweep over every Dex entry that transforms a body in
 * `packages/replay-core/test/transform-booking-sweep.spec.ts`.
 *
 * Singles, Doubles OU, VGC SV and Champions each have a row (the log scan of 7,032 games: 357 move lines of copies in singles, 22 in
 * Doubles OU, 103 in VGC SV, 57 in Champions OU, 11 in Champions VGC). The first two rows were the scenes of two rows of
 * `refused-choice-corpus.spec.ts` (902024 turn 24, 2694097898 turn 6): their refusal is gone, because the copy now holds the move.
 */

/** `copy`: the slot of the transformed body and the move its line shows; `target`: the side and the nickname of the body it copied. */
interface Row { id: string; turn: number; type: string; what: string; copy: { slot: string; move: string }; target: { side: 'p1' | 'p2'; name: string } }

const ROWS: Row[] = [
  { id: 'smogtours-gen6ubers-902024', turn: 24, type: 'Gen 6 Ubers', what: 'Ditto copies Darkrai and plays its Sludge Bomb', copy: { slot: 'p1a', move: 'Sludge Bomb' }, target: { side: 'p2', name: 'Darkrai' } },
  { id: 'gen9doublesou-2694097898', turn: 6, type: 'Doubles OU', what: 'Ditto copies Dragonite and Protects', copy: { slot: 'p1a', move: 'Protect' }, target: { side: 'p2', name: 'Dragonite' } },
  { id: 'gen9vgc2025regi-2381808549', turn: 3, type: 'VGC SV', what: 'Ditto copies Zamazenta and plays Heavy Slam', copy: { slot: 'p1b', move: 'Heavy Slam' }, target: { side: 'p2', name: 'Zamazenta' } },
  { id: 'gen9vgc2026regi-2582571418', turn: 5, type: 'VGC SV', what: 'a Ditto copies Calyrex and plays Leech Seed', copy: { slot: 'p1a', move: 'Leech Seed' }, target: { side: 'p2', name: 'Calyrex' } },
  { id: 'gen9championsou-2694672446', turn: 26, type: 'Champions OU', what: 'Ditto copies Falinks and plays Knock Off', copy: { slot: 'p2a', move: 'Knock Off' }, target: { side: 'p1', name: 'Falinks' } },
];

type Replay = ReplayData & { formatid?: string };

/** The built set of the target through the bank's and the app's build with the disk-cached Smogon data. */
async function builtMoves(row: Row): Promise<string[]> {
  const replay = JSON.parse(readFileSync(CORPUS(row.id), 'utf-8')) as Replay;
  const built = await bankTeamsFor({ log: replay.log, formatId: replay.formatid ?? row.id, parsed: parseReplayLogWithObservations(replay.log), fetcher: diskCachedSmogonFetcher() });
  const team = row.target.side === 'p1' ? built.teams?.p1Team : built.teams?.p2Team;
  const set = team?.find(entry => entry.name === row.target.name || entry.species.startsWith(row.target.name));
  if (!set) throw new Error(`${row.id}: no ${row.target.name} in the ${row.target.side} team`);
  return set.moves.map(move => toId(String(move)));
}

describe('a copy\'s move books to the body it copied, and the copy plays it (#139)', () => {
  for (const row of ROWS) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.type} ${row.id} turn ${row.turn}: ${row.what}`, async () => {
      expect(await builtMoves(row), `${row.target.name} holds ${row.copy.move}`).toContain(toId(row.copy.move));
      const { refusals } = await rebuildThrough(row.id, row.turn);
      const earlier = await rebuildThrough(row.id, row.turn - 1);
      // The copy plays its logged move: the request at the start of the turn lists it, enabled.
      const body = earlier.battle.sides[Number(row.copy.slot[1]) - 1].active['abcd'.indexOf(row.copy.slot[2])];
      const offered = body.getMoveRequestData().moves.find(entry => toId(entry.move) === toId(row.copy.move));
      expect(!!offered && !offered.disabled, `${row.copy.move} of ${row.copy.slot} is playable at the start of the turn`).toBe(true);
      expect(refusals - earlier.refusals, 'refusals of the turn').toBe(0);
    }, 300_000);
  }
});
