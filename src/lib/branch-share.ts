import type { BranchHistoryEntry } from './branch-history';
import type { ReplayData, SideId } from '@fulllifegames/replay-core';
import { notationSideLabel } from '@fulllifegames/eval-engine';

/**
 * One executed entry of the branch. `p1Choice` and `p2Choice` are the simulator commands; the labels (round 77, D6) are the
 * move and Pokemon names the history panel shows, so the shared view reads names. A link built before the labels carries
 * the commands alone and the view lists those (format version 1 stays: the fields are optional).
 */
interface BranchShareChoice {
  turnNumber: number;
  p1Choice: string;
  p2Choice: string;
  p1Label?: string;
  p2Label?: string;
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
    choices: history.map(entry => ({
      turnNumber: entry.turnNumber,
      p1Choice: entry.p1Choice,
      p2Choice: entry.p2Choice,
      p1Label: notationSideLabel(entry.p1SlotChoices, entry.p1Choice),
      p2Label: notationSideLabel(entry.p2SlotChoices, entry.p2Choice),
      ...(entry.kind === 'forced' && entry.forcedSide ? { forcedSide: entry.forcedSide } : {}),
    })),
    finalLog,
  };
}

export function encodeBranchShare(payload: BranchSharePayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function decodeBranchShare(encoded: string): BranchSharePayload {
  const padded = encoded
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as BranchSharePayload;
}

export function loadSavedBranches(replayId: string): BranchSharePayload[] {
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
function uniqueSaveTime(existing: BranchSharePayload[]): string {
  let time = Date.now();
  while (existing.some(entry => entry.createdAt === new Date(time).toISOString())) time += 1;
  return new Date(time).toISOString();
}

/**
 * Stores the branch as a new row. A row's key is its `createdAt` and `branchTurn`; the save stamps the time of the save, so
 * saving one branch twice makes two rows with two keys (round 77, D7) and a delete removes the row it names.
 */
export function saveBranchPayload(payload: BranchSharePayload): BranchSharePayload[] {
  const existing = loadSavedBranches(payload.replayId);
  const next = [{ ...payload, createdAt: uniqueSaveTime(existing) }, ...existing].slice(0, 20);
  localStorage.setItem(savedBranchKey(payload.replayId), JSON.stringify(next));
  return next;
}

/** Removes one row: the first whose key matches (rows saved before the keys were unique may share one). */
export function deleteSavedBranch(payload: BranchSharePayload): BranchSharePayload[] {
  const rows = loadSavedBranches(payload.replayId);
  const index = rows.findIndex(entry => entry.createdAt === payload.createdAt && entry.branchTurn === payload.branchTurn);
  const next = index < 0 ? rows : rows.filter((_, position) => position !== index);
  localStorage.setItem(savedBranchKey(payload.replayId), JSON.stringify(next));
  return next;
}
