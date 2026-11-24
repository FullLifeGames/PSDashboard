import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations, type ReplayData } from '@fulllifegames/replay-core';
import { bankTeamsFor } from './bank-build';
import { CORPUS } from './rebuild-through';
import { diskCachedSmogonFetcher } from './smogon-fetch-cache';

// Local: the rows skip without `.fit-corpus`.

// A Pokémon that spends a move's last PP and shows no item line held no Leppa Berry.
interface Row { id: string; type: string; side: 'p1' | 'p2'; body: string; what: string; leppa: boolean }

const ROWS: Row[] = [
  { id: 'gen9championsou-2692599072', type: 'Champions OU', side: 'p2', body: 'Pawmot', what: 'Revival Blessing used, no berry line: no Leppa Berry', leppa: false },
  { id: 'smogtours-gen9ou-677869', type: 'Gen 9 OU', side: 'p1', body: 'Pawmot', what: 'Revival Blessing used, no berry line: no Leppa Berry', leppa: false },
  { id: 'gen9championsou-2691485449', type: 'Champions OU', side: 'p2', body: 'Pawmot', what: 'the log shows the Leppa Berry: it stays', leppa: true },
];

type Replay = ReplayData & { formatid?: string };

async function builtItem(id: string, side: 'p1' | 'p2', body: string): Promise<string> {
  const replay = JSON.parse(readFileSync(CORPUS(id), 'utf-8')) as Replay;
  const parsed = parseReplayLogWithObservations(replay.log);
  const built = await bankTeamsFor({ log: replay.log, formatId: replay.formatid ?? id, parsed, fetcher: diskCachedSmogonFetcher() });
  const team = side === 'p1' ? built.teams?.p1Team : built.teams?.p2Team;
  const set = team?.find(entry => entry.species === body);
  if (!set) throw new Error(`${id}: no ${body} in the ${side} team`);
  return String(set.item ?? '');
}

describe('a move that ran out of PP with no Leppa Berry line leaves no Leppa Berry in the build', () => {
  for (const row of ROWS) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.type} ${row.id}: ${row.what}`, async () => {
      const item = await builtItem(row.id, row.side, row.body);
      if (row.leppa) expect(item).toBe('Leppa Berry');
      else expect(item).not.toBe('Leppa Berry');
    }, 120_000);
  }
});
