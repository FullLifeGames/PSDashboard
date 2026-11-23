import { useState } from 'react';
import type { OpponentTeamInfo } from '@fulllifegames/replay-core';
import { loadTeamEdits } from '../lib/team-edits-store';

/**
 * Puts the replay's saved editor edit back once the fresh inference exists, before any stored import text applies on top. A
 * render-phase reconcile, never an effect; it runs only while nothing was edited in this session, so a later edit or import is
 * never overwritten. A record that fits no inferred team is ignored.
 */
export function useRestoredTeamEdits(args: {
  replayId: string | undefined;
  p1Info: OpponentTeamInfo | null;
  opponentInfo: OpponentTeamInfo | null;
  edited: { p1: OpponentTeamInfo | null; p2: OpponentTeamInfo | null };
  setEdited: { p1: (info: OpponentTeamInfo | null) => void; p2: (info: OpponentTeamInfo | null) => void };
}): void {
  const { replayId, p1Info, opponentInfo, edited, setEdited } = args;
  const [tried, setTried] = useState<{ replayId: string; p1: OpponentTeamInfo; p2: OpponentTeamInfo } | null>(null);
  if (!replayId || !p1Info || !opponentInfo || edited.p1 || edited.p2) return;
  if (tried?.replayId === replayId && tried.p1 === p1Info && tried.p2 === opponentInfo) return;
  setTried({ replayId, p1: p1Info, p2: opponentInfo });
  const saved = loadTeamEdits(replayId, { p1: p1Info, p2: opponentInfo });
  if (!saved) return;
  setEdited.p1(saved.p1);
  setEdited.p2(saved.p2);
}
