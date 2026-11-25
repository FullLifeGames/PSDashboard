import type { OpponentTeamInfo } from '@fulllifegames/replay-core';

// The record leaves the page's memory, so it carries a version: another version's record stays in storage, ignored.
// The import text of a replay keeps its own key (`ps-replay-interceptor:sets:<id>`).

export const TEAM_EDITS_VERSION = 1;

export const teamEditsKey = (replayId: string): string => `ps-replay-interceptor:edits:${replayId}`;
const importKey = (replayId: string): string => `ps-replay-interceptor:sets:${replayId}`;

export interface TeamEdits {
  p1: OpponentTeamInfo | null;
  p2: OpponentTeamInfo | null;
}

function isTeam(value: unknown): value is OpponentTeamInfo {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as OpponentTeamInfo).pokemon)) return false;
  return (value as OpponentTeamInfo).pokemon.every(mon =>
    typeof mon === 'object' && mon !== null && typeof mon.species === 'string' && Array.isArray(mon.moves)
    && typeof mon.item === 'object' && mon.item !== null && typeof mon.ability === 'object' && mon.ability !== null);
}

// A saved side may hold more than the log showed: a game without team preview gets stand-ins, and an edit keeps them.
function fits(saved: OpponentTeamInfo | null, shown: OpponentTeamInfo): boolean {
  if (saved === null) return true;
  if (!isTeam(saved) || saved.pokemon.length < shown.pokemon.length) return false;
  const species = new Set(saved.pokemon.map(mon => mon.species));
  return shown.pokemon.every(mon => species.has(mon.species));
}

export function saveTeamEdits(replayId: string, edits: TeamEdits): void {
  try {
    localStorage.setItem(teamEditsKey(replayId), JSON.stringify({ version: TEAM_EDITS_VERSION, ...edits }));
  } catch {
    // Storage full or blocked: the edit still applies for this session.
  }
}

/** Nothing is deleted: a record this version cannot read stays for the version that wrote it. */
export function loadTeamEdits(replayId: string, inferred: { p1: OpponentTeamInfo; p2: OpponentTeamInfo }): TeamEdits | null {
  try {
    const raw = localStorage.getItem(teamEditsKey(replayId));
    if (!raw) return null;
    const record = JSON.parse(raw) as { version?: unknown; p1?: unknown; p2?: unknown } | null;
    if (!record || record.version !== TEAM_EDITS_VERSION) return null;
    const p1 = (record.p1 ?? null) as OpponentTeamInfo | null;
    const p2 = (record.p2 ?? null) as OpponentTeamInfo | null;
    return fits(p1, inferred.p1) && fits(p2, inferred.p2) ? { p1, p2 } : null;
  } catch {
    return null;
  }
}

export function readImportText(replayId: string): string | null {
  try {
    return localStorage.getItem(importKey(replayId));
  } catch {
    return null;
  }
}

export function forgetImportText(replayId: string): void {
  try {
    localStorage.removeItem(importKey(replayId));
  } catch {
    // Blocked store: the text stays and applies again on the next load, over the saved edit.
  }
}
