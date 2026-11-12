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
}

function rowOf(record: NewGameRecord): SavedGameRow {
  return { id: record.id, formatName: record.formatName, players: record.players, turns: record.turns, updatedAt: record.updatedAt };
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

/** Removes a game and what it owns; the other games stay. */
export function deleteGame(id: string): SavedGameRow[] {
  for (const key of [gameKey(id), branchesKey(id), setsKey(id)]) localStorage.removeItem(key);
  const next = listGames().filter(row => row.id !== id);
  localStorage.setItem(GAMES_INDEX_KEY, JSON.stringify(next));
  return next;
}

/**
 * Saves the record and moves its row to the front of the index; a 21st game pushes the oldest out with everything it owns.
 * Returns false when the browser refuses the write (a full store): the game stays in memory and the caller may say so.
 */
export function saveGame(record: NewGameRecord): boolean {
  try {
    localStorage.setItem(gameKey(record.id), JSON.stringify(record));
    const rows = [rowOf(record), ...listGames().filter(row => row.id !== record.id)];
    for (const evicted of rows.slice(MAX_SAVED_GAMES)) {
      for (const key of [gameKey(evicted.id), branchesKey(evicted.id), setsKey(evicted.id)]) localStorage.removeItem(key);
    }
    localStorage.setItem(GAMES_INDEX_KEY, JSON.stringify(rows.slice(0, MAX_SAVED_GAMES)));
    return true;
  } catch {
    return false;
  }
}
