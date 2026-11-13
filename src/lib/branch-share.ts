import type { BranchHistoryEntry } from './branch-history';
import type { ReplayData, SideId } from '@fulllifegames/replay-core';
import { notationSideLabel } from '@fulllifegames/eval-engine';
import { sideMarkTexts, turnDiceMarks } from './branch-dice-marks';
import { isGameSharePayload, type GameSharePayload } from './new-game/share';

/**
 * One executed entry of the branch. `p1Choice` and `p2Choice` are the simulator commands; the labels (round 77, D6) are the
 * move and Pokemon names the history panel shows, so the shared view reads names. A link built before the labels carries
 * the commands alone and the view lists those (format version 1 stays: the fields are optional). Round 82 (forced dice, step A7c):
 * `p1DiceLabels` and `p2DiceLabels` name the dice the user forced in the turn, one text per die as the history row writes it, a
 * die that took no effect marked; a turn without a forced die on a side has no key for it, and the viewer shows a link without them.
 */
interface BranchShareChoice {
  turnNumber: number;
  p1Choice: string;
  p2Choice: string;
  p1Label?: string;
  p2Label?: string;
  p1DiceLabels?: string[];
  p2DiceLabels?: string[];
  /** Set on a forced replacement of one side, which is its own line and consumes no turn. */
  forcedSide?: SideId;
}

export interface BranchSharePayload {
  version: 1;
  replayId: string;
  format: string;
  formatid: string;
  players: string[];
  branchTurn: number;
  createdAt: string;
  choices: BranchShareChoice[];
  finalLog: string;
}

/** A saved row: a replay's branch (version 1) or a game's (version 2, `GameSharePayload`). The rows of one replay or game share one store key. */
export type SavedBranch = BranchSharePayload | GameSharePayload;

/** The id the rows are stored under: the replay's, or the game's. */
export function savedBranchOwner(row: SavedBranch): string {
  return row.version === 2 ? row.gameId : row.replayId;
}

/** How many choices a saved row holds: a replay's branch, or the open variation of a game (none: the game's own line). */
export function savedBranchChoices(row: SavedBranch): number {
  return row.version === 2 ? (row.variation?.entries.length ?? 0) : row.choices.length;
}

export function savedBranchKey(replayId: string): string {
  return `ps-replay-interceptor:branches:${replayId}`;
}

export function makeBranchSharePayload(params: {
  replay: ReplayData;
  branchTurn: number;
  history: BranchHistoryEntry[];
  finalLog: string;
}): BranchSharePayload {
  const { replay, branchTurn, history, finalLog } = params;
  return {
    version: 1,
    replayId: replay.id,
    format: replay.format,
    formatid: replay.formatid,
    players: replay.players,
    branchTurn,
    createdAt: new Date().toISOString(),
    choices: history.map((entry, index) => {
      const marks = turnDiceMarks(history, index);
      const p1Dice = sideMarkTexts(marks, 'p1');
      const p2Dice = sideMarkTexts(marks, 'p2');
      return {
        turnNumber: entry.turnNumber,
        p1Choice: entry.p1Choice,
        p2Choice: entry.p2Choice,
        p1Label: notationSideLabel(entry.p1SlotChoices, entry.p1Choice),
        p2Label: notationSideLabel(entry.p2SlotChoices, entry.p2Choice),
        ...(p1Dice.length > 0 ? { p1DiceLabels: p1Dice } : {}),
        ...(p2Dice.length > 0 ? { p2DiceLabels: p2Dice } : {}),
        ...(entry.kind === 'forced' && entry.forcedSide ? { forcedSide: entry.forcedSide } : {}),
      };
    }),
    finalLog,
  };
}

/** Any share payload as the hash carries it: JSON as UTF-8 bytes in base64url, no padding. */
export function encodeShareJson(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function encodeBranchShare(payload: BranchSharePayload | GameSharePayload): string {
  return encodeShareJson(payload);
}

function decodeShareJson(encoded: string): unknown {
  const padded = encoded
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function decodeBranchShare(encoded: string): BranchSharePayload {
  return decodeShareJson(encoded) as BranchSharePayload;
}

/**
 * Round 89 (#105, H5): what a `#branch=` link holds. Version 1 is a replay's branch (its id and the log it ends on: the read-only
 * view), version 2 a game (`GameSharePayload`: the reader plays it). A version above 2 comes from a newer app and reads as such,
 * so the page can say so; anything else, a version 1 link without its log included, is damaged and throws.
 */
export type ReadShare =
  | { kind: 'branch'; payload: BranchSharePayload }
  | { kind: 'game'; payload: GameSharePayload }
  | { kind: 'newer'; version: number };

export function readShare(encoded: string): ReadShare {
  const value = decodeShareJson(encoded) as { version?: unknown } | null;
  const version = value?.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new Error('unsupported payload');
  if (version > 2) return { kind: 'newer', version };
  if (version === 2) {
    if (!isGameSharePayload(value)) throw new Error('unsupported payload');
    return { kind: 'game', payload: value };
  }
  const branch = value as unknown as BranchSharePayload;
  if (!branch.finalLog || !branch.replayId) throw new Error('unsupported payload');
  return { kind: 'branch', payload: branch };
}

export function loadSavedBranches(replayId: string): SavedBranch[] {
  try {
    const raw = localStorage.getItem(savedBranchKey(replayId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The time a save happened, moved forward by a millisecond while a saved row of the replay already carries it. */
function uniqueSaveTime(existing: SavedBranch[]): string {
  let time = Date.now();
  while (existing.some(entry => entry.createdAt === new Date(time).toISOString())) time += 1;
  return new Date(time).toISOString();
}

/**
 * Stores the branch as a new row. A row's key is its `createdAt` and `branchTurn`; the save stamps the time of the save, so
 * saving one branch twice makes two rows with two keys (round 77, D7) and a delete removes the row it names.
 */
export function saveBranchPayload(payload: SavedBranch): SavedBranch[] {
  const existing = loadSavedBranches(savedBranchOwner(payload));
  const next = [{ ...payload, createdAt: uniqueSaveTime(existing) }, ...existing].slice(0, 20);
  localStorage.setItem(savedBranchKey(savedBranchOwner(payload)), JSON.stringify(next));
  return next;
}

/** Removes one row: the first whose key matches (rows saved before the keys were unique may share one). */
export function deleteSavedBranch(payload: SavedBranch): SavedBranch[] {
  const rows = loadSavedBranches(savedBranchOwner(payload));
  const index = rows.findIndex(entry => entry.createdAt === payload.createdAt && entry.branchTurn === payload.branchTurn);
  const next = index < 0 ? rows : rows.filter((_, position) => position !== index);
  localStorage.setItem(savedBranchKey(savedBranchOwner(payload)), JSON.stringify(next));
  return next;
}
