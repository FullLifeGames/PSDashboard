import type { NewGameRecord } from './record';
import { GAME_RECORD_VERSION } from './record';

/**
 * Round 89 (lane H, #105): where new games live in localStorage. One key per game holds its record; an index lists the games
 * for the panel (newest first, at most 20, as saved variations keep 20). A game's saved variations stay under today's
 * `ps-replay-interceptor:branches:<id>` and its set edits under `ps-replay-interceptor:sets:<id>`: a delete removes both.
 */

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
  /** The dice seed (shown in the saved list); a row written before the seed was listed has none. */
  seed?: string;
}

function rowOf(record: NewGameRecord): SavedGameRow {
  return { id: record.id, formatName: record.formatName, players: record.players, turns: record.turns, updatedAt: record.updatedAt, seed: record.seed };
}

/** The saved games, newest first; an unreadable index reads as empty. */
export function listGames(): SavedGameRow[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(GAMES_INDEX_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as SavedGameRow[]) : [];
  } catch {
    return [];
  }
}

/** The game a key holds; null for none, an unreadable record or a record of a newer shape. */
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

/** The newest saved game that satisfies the test, else null (the index's seed spares loading a record whose seed cannot match). */
export function findGame(matches: (record: NewGameRecord) => boolean, seed?: string): NewGameRecord | null {
  for (const row of listGames()) {
    if (seed !== undefined && row.seed !== undefined && row.seed !== seed) continue;
    const record = loadGame(row.id);
    if (record && matches(record)) return record;
  }
  return null;
}

/** Removes a game and what it owns; the other games stay. */
export function deleteGame(id: string): SavedGameRow[] {
  for (const key of [gameKey(id), branchesKey(id), setsKey(id)]) localStorage.removeItem(key);
  const next = listGames().filter(row => row.id !== id);
  localStorage.setItem(GAMES_INDEX_KEY, JSON.stringify(next));
  return next;
}

const evictionListeners = new Set<(rows: SavedGameRow[]) => void>();

/** Calls the listener with the rows a save pushed out of the store (the notice names them); returns the function that stops it. */
export function onGameEvicted(listener: (rows: SavedGameRow[]) => void): () => void {
  evictionListeners.add(listener);
  return () => { evictionListeners.delete(listener); };
}

/**
 * The rows that stay: the newest first, at most 20. A game over the limit that has no played turn goes first (the oldest of them), then the oldest game;
 * the game just saved (the first row) never goes (round 89, H15a).
 */
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

/**
 * Saves the record and moves its row to the front of the index; a 21st game pushes one game out with everything it owns (the oldest
 * without a played turn, else the oldest) and tells the listeners which. Returns false when the browser refuses the write (a full
 * store): the game stays in memory and the caller may say so.
 */
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
