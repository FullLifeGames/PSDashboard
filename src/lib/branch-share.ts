import type { BranchHistoryEntry } from './branch-history';
import type { ReplayData } from '../types';

export interface BranchShareChoice {
  turnNumber: number;
  p1Choice: string;
  p2Choice: string;
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

export function saveBranchPayload(payload: BranchSharePayload): BranchSharePayload[] {
  const existing = loadSavedBranches(payload.replayId);
  const next = [payload, ...existing].slice(0, 20);
  localStorage.setItem(savedBranchKey(payload.replayId), JSON.stringify(next));
  return next;
}

export function deleteSavedBranch(payload: BranchSharePayload): BranchSharePayload[] {
  const next = loadSavedBranches(payload.replayId)
    .filter(entry => !(entry.createdAt === payload.createdAt && entry.branchTurn === payload.branchTurn));
  localStorage.setItem(savedBranchKey(payload.replayId), JSON.stringify(next));
  return next;
}
