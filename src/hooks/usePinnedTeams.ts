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

/** The teams a reported session built, pinned for its reproduction so every rebuild plays the reported sets, not today's Smogon guess.
 *  The pin belongs to its replay, and its marker joins the sets fingerprint: stored positions and evaluations never mix pinned and
 *  inferred sets. */
export function usePinnedTeams(replayId: string | null, gameTeams: PinnedTeams | null = null) {
  const [pinned, setPinned] = useState<{ replayId: string; teams: PinnedTeams } | null>(null);
  // A new game plays its record's teams, exactly as typed; they stand in for a reproduction's pin.
  const teams = gameTeams ?? (pinned && pinned.replayId === replayId ? pinned.teams : null);
  const marker = useMemo(() => (teams ? hashText(JSON.stringify(teams)) : null), [teams]);
  const setTeams = useCallback((next: PinnedTeams | null) => {
    setPinned(next && replayId ? { replayId, teams: next } : null);
  }, [replayId]);
  return { teams, marker, setTeams };
}
