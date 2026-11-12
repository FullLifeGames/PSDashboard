import type { PokemonSet } from '@pkmn/sim';
import type { ReplayData } from '@fulllifegames/replay-core';
import type { NewGameStart } from '@fulllifegames/eval-engine';
import { DEFAULT_GAME_SEED } from '@fulllifegames/eval-engine';
import type { BranchHistoryEntry } from '../branch-history';
import { assembleGameLog } from './game-log';

/**
 * Round 89 (lane H, #105): a new game is a record. It holds the format, both teams as the format's battle reads them (with the
 * level the format gives), the player names, the dice seed, the header the format's battle wrote, and the turns played: every
 * history entry of the main line and the log lines of each finished turn. The app shows the record's log as the game's replay
 * data, so every reader of a replay (the parser, the sweep, the report) works on a game unchanged. `recordVersion` lets a later
 * shape migrate; nothing leaves the app in this stage.
 */

export const GAME_RECORD_VERSION = 1;

export interface NewGameRecord {
  recordVersion: typeof GAME_RECORD_VERSION;
  /** `newgame-<10 base36 characters>`, made at Start and kept in the save and the link. */
  id: string;
  /** The chosen format's id: always explicit, so no reader infers a format from the id. */
  format: string;
  formatName: string;
  players: [string, string];
  /** Both teams in full: each side knows the other's, as with open team sheets. */
  teams: { p1: PokemonSet[]; p2: PokemonSet[] };
  /** The dice seed of the game's simulator: fixed (`DEFAULT_GAME_SEED`) or drawn at Start (`newGameSeed`). */
  seed: string;
  teamPreview: boolean;
  bringCount: number | null;
  /** The log up to the start, from `startGameLog`. */
  header: string[];
  /** The log from `|start` on: the lead game's lines, then each finished turn's. */
  body: string[];
  /** The main line's history entries in play order (the lead entry first); positions are left out, a rebuild restores them. */
  entries: BranchHistoryEntry[];
  /** Finished turns on the main line. */
  turns: number;
  createdAt: string;
  updatedAt: string;
}

const ID_LENGTH = 10;

/** A source of random bytes: `crypto.getRandomValues` of the browser and of Node. */
export type RandomBytes = (length: number) => Uint8Array;
const cryptoBytes: RandomBytes = length => globalThis.crypto.getRandomValues(new Uint8Array(length));

/** `newgame-` and 10 base36 characters, drawn from a crypto source. */
export function newGameId(random: RandomBytes = cryptoBytes): string {
  return `newgame-${Array.from(random(ID_LENGTH), byte => (byte % 36).toString(36)).join('')}`;
}

/**
 * The dice seed of a new game. The user's ruling on a fixed or a fresh seed per game is open (plan section 8, question 4): 'fixed'
 * keeps the seed every rebuild uses, 'fresh' draws four 16-bit numbers. Start calls this once and the record keeps the result.
 */
export function newGameSeed(mode: 'fixed' | 'fresh' = 'fixed', random: RandomBytes = cryptoBytes): string {
  if (mode === 'fixed') return DEFAULT_GAME_SEED;
  const bytes = random(8);
  return Array.from({ length: 4 }, (_, index) => bytes[index * 2] * 256 + bytes[index * 2 + 1]).join(',');
}

export interface NewGameRecordParams {
  start: NewGameStart;
  formatName: string;
  players: [string, string];
  seed?: string;
  id?: string;
  now?: Date;
}

/** The record of a game that has started and has played nothing: the header, the teams, no body and no entries. */
export function newGameRecord(params: NewGameRecordParams): NewGameRecord {
  const { start } = params;
  const time = (params.now ?? new Date()).toISOString();
  return {
    recordVersion: GAME_RECORD_VERSION,
    id: params.id ?? newGameId(),
    format: start.format,
    formatName: params.formatName,
    players: params.players,
    teams: start.teams,
    seed: params.seed ?? DEFAULT_GAME_SEED,
    teamPreview: start.teamPreview,
    bringCount: start.bringCount,
    header: start.header,
    body: [],
    entries: [],
    turns: 0,
    createdAt: time,
    updatedAt: time,
  };
}

/** A finished turn: its history entries (a forced replacement is its own entry) and the log lines it wrote. */
export interface FinishedTurn {
  entries: BranchHistoryEntry[];
  lines: string[];
}

/** An entry as the record keeps it: the serialized position (tens of kilobytes) is left out, the exact store holds positions. */
function withoutPosition(entry: BranchHistoryEntry): BranchHistoryEntry {
  const { serializedPosition: position, ...rest } = entry;
  void position;
  return rest;
}

/** The record with one more finished turn; the lead entry (turn 0) joins without counting as a turn. */
export function appendTurn(record: NewGameRecord, turn: FinishedTurn, now: Date = new Date()): NewGameRecord {
  const lead = turn.entries.length > 0 && turn.entries.every(entry => entry.leadChoices !== undefined);
  return {
    ...record,
    body: [...record.body, ...turn.lines],
    entries: [...record.entries, ...turn.entries.map(withoutPosition)],
    turns: record.turns + (lead ? 0 : 1),
    updatedAt: now.toISOString(),
  };
}

/** The replay data of a game: the explicit `formatid` first, because the id never feeds format inference. */
export function gameReplayData(record: NewGameRecord): ReplayData {
  return {
    id: record.id,
    format: record.formatName,
    formatid: record.format,
    players: [...record.players],
    log: assembleGameLog(record.header, record.body),
    uploadtime: Math.floor(Date.parse(record.createdAt) / 1000),
    views: 0,
  };
}
