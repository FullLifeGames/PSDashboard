import { useEffect, useRef } from 'react';
import type { BranchHistoryEntry } from './branch/shared';
import type { NewGameRecord } from '../lib/new-game/record';
import { gameTipTurn } from './useNewGame';
import type { SavedVariation } from './useRestoreVariation';
import { waitForGame, type SharedGameApp } from './useOpenSharedGame';

/**
 * Round 89 (lane H, #105), step H8 (wave-tester finding 8, user ruling: the game is saved after every finished turn and a reload
 * reopens it at its tip): the record of a game whose tip turn was played and waits for its replacement carries that turn
 * (`pending`). When such a game opens and its live branch is empty, the turn plays again on the branch from the tip, which asks
 * for the replacement as before the reload. One restore per record object: a failed one does not repeat on every render.
 */

/** What the hook reads of the app: the open game, the live branch and the branch restore. */
export interface PendingTurnApp extends SharedGameApp {
  ctx: SharedGameApp['ctx'] & { branch: { history: BranchHistoryEntry[] } };
}

/** The saved variation that plays a record's pending turn again from the main line's tip. */
export function pendingTurnVariation(record: NewGameRecord): SavedVariation | null {
  if (!record.pending || record.pending.length === 0) return null;
  return { startTurn: gameTipTurn(record), history: record.pending, prefill: { p1Choices: [], p2Choices: [] }, pinnedTeams: null };
}

export function useRestorePendingTurn(app: PendingTurnApp, sharedOpening: boolean): void {
  const latest = useRef(app);
  useEffect(() => {
    latest.current = app;
  });
  const handled = useRef<BranchHistoryEntry[] | null>(null);
  const record = app.ctx.newGame.record;
  const idle = app.ctx.branch.history.length === 0;
  const ready = app.ctx.replay.replayData?.id === record?.id && !app.board.deviation.branchPreparing;
  useEffect(() => {
    if (!record?.pending || handled.current === record.pending || !idle || !ready || sharedOpening) return;
    handled.current = record.pending;
    const saved = pendingTurnVariation(record);
    if (!saved) return;
    void (async () => {
      if (!(await waitForGame(latest, record.id))) return;
      // one more render after the game's data: the restore reads the snapshots and sources of the latest render
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      await latest.current.board.deviation.restoreVariation(saved);
    })();
  }, [record, idle, ready, sharedOpening]);
}
