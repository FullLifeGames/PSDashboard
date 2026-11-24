import type { NewGameRecord } from '../../../src/lib/new-game/record';
import { saveGame } from '../../../src/lib/new-game/store';
import { startedRecord } from './new-game';

export async function savedRecord(players: [string, string] = ['Alice', 'Bob'], turns = 3, seed = '3,4,5,6', formatName = '[Gen 9] OU'): Promise<NewGameRecord> {
  const started = await startedRecord('gen9ou');
  const record: NewGameRecord = { ...started, id: `newgame-${players[0].toLowerCase()}${players[1].toLowerCase()}${turns}`, players, turns, seed, formatName, updatedAt: new Date(Date.UTC(2026, 10, 11, 20, 40 + turns)).toISOString() };
  if (!saveGame(record)) throw new Error('the store refused the saved game');
  return record;
}
