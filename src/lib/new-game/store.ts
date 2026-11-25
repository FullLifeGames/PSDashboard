import type { NewGameRecord } from './record';
import { GAME_RECORD_VERSION } from './record';

// One key per game and an index for the panel; a game's saved variations and set edits go with it on delete.

export const GAMES_INDEX_KEY = 'ps-replay-interceptor:games';
export const MAX_SAVED_GAMES = 20;

export const gameKey = (id: string): string => `ps-replay-interceptor:game:${id}`;
const branchesKey = (id: string): string => `ps-replay-interceptor:branches:${id}`;
const setsKey = (id: string): string => `ps-replay-interceptor:sets:${id}`;

export interface SavedGameRow {
  id: string;
  formatName: string;
  players: [string, string];
  turns: number;
  updatedAt: string;
  seed?: string;
}

function rowOf(record: NewGameRecord): SavedGameRow {
  return { id: record.id, formatName: record.formatName, players: record.players, turns: record.turns, updatedAt: record.updatedAt, seed: record.seed };
}

export function listGames(): SavedGameRow[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(GAMES_INDEX_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as SavedGameRow[]) : [];
  } catch {
    return [];
  }
}

export function loadGame(id: string): NewGameRecord | null {
  try {
    const raw = localStorage.getItem(gameKey(id));
    if (!raw) return null;
    const record = JSON.parse(raw) as NewGameRecord;
    return record.recordVersion === GAME_RECORD_VERSION && record.id === id ? record : null;
  } catch {
    return null;
  }
}

export function findGame(matches: (record: NewGameRecord) => boolean, seed?: string): NewGameRecord | null {
  for (const row of listGames()) {
    if (seed !== undefined && row.seed !== undefined && row.seed !== seed) continue;
    const record = loadGame(row.id);
    if (record && matches(record)) return record;
  }
  return null;
}

export function deleteGame(id: string): SavedGameRow[] {
  for (const key of [gameKey(id), branchesKey(id), setsKey(id)]) localStorage.removeItem(key);
  const next = listGames().filter(row => row.id !== id);
  localStorage.setItem(GAMES_INDEX_KEY, JSON.stringify(next));
  return next;
}

const evictionListeners = new Set<(rows: SavedGameRow[]) => void>();

export function onGameEvicted(listener: (rows: SavedGameRow[]) => void): () => void {
  evictionListeners.add(listener);
  return () => { evictionListeners.delete(listener); };
}

// At most 20 rows: a game with no played turn goes first (oldest of them), then the oldest; the new game never goes.
function keepNewest(rows: SavedGameRow[]): { kept: SavedGameRow[]; evicted: SavedGameRow[] } {
  const kept = [...rows];
  const evicted: SavedGameRow[] = [];
  while (kept.length > MAX_SAVED_GAMES) {
    let at = -1;
    for (let index = kept.length - 1; index > 0; index -= 1) if (kept[index].turns === 0) { at = index; break; }
    if (at < 0) at = kept.length - 1;
    evicted.push(...kept.splice(at, 1));
  }
  return { kept, evicted };
}

/** Saves the record and moves its row to the front; a 21st game pushes one out. False when the write is refused. */
export function saveGame(record: NewGameRecord): boolean {
  try {
    localStorage.setItem(gameKey(record.id), JSON.stringify(record));
    const { kept, evicted } = keepNewest([rowOf(record), ...listGames().filter(row => row.id !== record.id)]);
    for (const gone of evicted) {
      for (const key of [gameKey(gone.id), branchesKey(gone.id), setsKey(gone.id)]) localStorage.removeItem(key);
    }
    localStorage.setItem(GAMES_INDEX_KEY, JSON.stringify(kept));
    if (evicted.length > 0) for (const listener of evictionListeners) listener(evicted);
    return true;
  } catch {
    return false;
  }
}
