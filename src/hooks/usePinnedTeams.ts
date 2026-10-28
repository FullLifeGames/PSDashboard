import { useCallback, useMemo, useState } from 'react';
import type { PinnedTeams } from '../lib/eval-acquire';

/** FNV-1a over the text: a short, stable marker for the sets fingerprint. */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Round 77 (user gate 28.10.2026, 3a): the teams a reported session built, pinned for its reproduction, so
 * every rebuild plays the reported sets instead of today's Smogon guess. The pin belongs to its replay (a new
 * one drops it by derivation), and its marker joins the sets fingerprint: stored positions and cached
 * evaluations never mix pinned and inferred sets.
 */
export function usePinnedTeams(replayId: string | null) {
  const [pinned, setPinned] = useState<{ replayId: string; teams: PinnedTeams } | null>(null);
  const teams = pinned && pinned.replayId === replayId ? pinned.teams : null;
  const marker = useMemo(() => (teams ? hashText(JSON.stringify(teams)) : null), [teams]);
  const setTeams = useCallback((next: PinnedTeams | null) => {
    setPinned(next && replayId ? { replayId, teams: next } : null);
  }, [replayId]);
  return { teams, marker, setTeams };
}
