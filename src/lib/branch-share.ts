import type { BranchHistoryEntry } from './branch-history';
import type { ReplayData, SideId } from '@fulllifegames/replay-core';
import { notationSideLabel } from '@fulllifegames/eval-engine';
import { sideMarkTexts, turnDiceMarks } from './branch-dice-marks';
import { isGameSharePayload, type GameSharePayload } from './new-game/share';

// The fields after the commands are optional, so format version 1 stays (a link without labels lists the commands).
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

/** A saved row: a replay's branch (version 1) or a game's (version 2); a replay or game has one store key. */
export type SavedBranch = BranchSharePayload | GameSharePayload;

export function savedBranchOwner(row: SavedBranch): string {
  return row.version === 2 ? row.gameId : row.replayId;
}

/** How many choices a saved row holds: a replay's branch, or a game's open variation (none: its own line). */
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

/** What a `#branch=` link holds: version 1 a replay's branch, 2 a game; above 2 a newer app's; else damaged, throws. */
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

function uniqueSaveTime(existing: SavedBranch[]): string {
  let time = Date.now();
  while (existing.some(entry => entry.createdAt === new Date(time).toISOString())) time += 1;
  return new Date(time).toISOString();
}

/** Stores the branch as a new row: the key is `createdAt` and `branchTurn`, so saving twice makes two rows. */
export function saveBranchPayload(payload: SavedBranch): SavedBranch[] {
  const existing = loadSavedBranches(savedBranchOwner(payload));
  const next = [{ ...payload, createdAt: uniqueSaveTime(existing) }, ...existing].slice(0, 20);
  localStorage.setItem(savedBranchKey(savedBranchOwner(payload)), JSON.stringify(next));
  return next;
}

/** Removes one row: the first whose key matches (an old saved row may share a key). */
export function deleteSavedBranch(payload: SavedBranch): SavedBranch[] {
  const rows = loadSavedBranches(savedBranchOwner(payload));
  const index = rows.findIndex(entry => entry.createdAt === payload.createdAt && entry.branchTurn === payload.branchTurn);
  const next = index < 0 ? rows : rows.filter((_, position) => position !== index);
  localStorage.setItem(savedBranchKey(savedBranchOwner(payload)), JSON.stringify(next));
  return next;
}
