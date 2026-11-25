import type { PokemonSet } from '@pkmn/sim';
import type { ReplayData } from '@fulllifegames/replay-core';
import type { NewGameStart } from '@fulllifegames/eval-engine';
import { DEFAULT_GAME_SEED } from '@fulllifegames/eval-engine';
import type { BranchHistoryEntry } from '../branch-history';
import { assembleGameLog } from './game-log';


export const GAME_RECORD_VERSION = 1;

export interface NewGameRecord {
  recordVersion: typeof GAME_RECORD_VERSION;
  id: string;
  /** The chosen format's id: always explicit, so no reader infers a format from the id. */
  format: string;
  formatName: string;
  players: [string, string];
  teams: { p1: PokemonSet[]; p2: PokemonSet[] };
  seed: string;
  teamPreview: boolean;
  bringCount: number | null;
  header: string[];
  body: string[];
  /** The main line's history entries in play order (lead first); positions are left out, a rebuild restores them. */
  entries: BranchHistoryEntry[];
  turns: number;
  /** Optional (old records have none): the tip's turn whose replacement is not picked yet; no part of the main line. */
  pending?: BranchHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

const ID_LENGTH = 10;

export const isGameId = (id: string): boolean => id.startsWith('newgame-');

export type RandomBytes = (length: number) => Uint8Array;
const cryptoBytes: RandomBytes = length => globalThis.crypto.getRandomValues(new Uint8Array(length));

export function newGameId(random: RandomBytes = cryptoBytes): string {
  return `newgame-${Array.from(random(ID_LENGTH), byte => (byte % 36).toString(36)).join('')}`;
}

/** The dice seed: 'fixed' keeps the seed every rebuild uses, 'fresh' draws four 16-bit numbers; Start calls it once. */
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

export interface FinishedTurn {
  entries: BranchHistoryEntry[];
  lines: string[];
}

/** An entry as the record keeps it, without position or board snapshots (60 doubles turns: 100 kB, not 960). */
export function withoutPosition(entry: BranchHistoryEntry): BranchHistoryEntry {
  return {
    ...entry, serializedPosition: undefined,
    p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [],
  };
}

function withoutPending(record: NewGameRecord): NewGameRecord {
  const copy = { ...record };
  delete copy.pending;
  return copy;
}

export function appendTurn(record: NewGameRecord, turn: FinishedTurn, now: Date = new Date()): NewGameRecord {
  const lead = turn.entries.length > 0 && turn.entries.every(entry => entry.leadChoices !== undefined);
  return {
    ...withoutPending(record),
    body: [...record.body, ...turn.lines],
    entries: [...record.entries, ...turn.entries.map(withoutPosition)],
    turns: record.turns + (lead ? 0 : 1),
    updatedAt: now.toISOString(),
  };
}

export function withPendingTurn(record: NewGameRecord, entries: readonly BranchHistoryEntry[], now: Date = new Date()): NewGameRecord {
  return { ...withoutPending(record), ...(entries.length > 0 ? { pending: entries.map(withoutPosition) } : {}), updatedAt: now.toISOString() };
}

export function gameReplayData(record: NewGameRecord): ReplayData {
  return {
    id: record.id,
    format: record.formatName,
    formatid: record.format,
    players: [...record.players],
    log: assembleGameLog(record.header, record.body, record.format),
    uploadtime: Math.floor(Date.parse(record.createdAt) / 1000),
    views: 0,
  };
}
