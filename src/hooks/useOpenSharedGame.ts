import { useEffect, useRef, useState } from 'react';
import type { NewGameRecord } from '../lib/new-game/record';
import { findGame, saveGame } from '../lib/new-game/store';
import { historyOfShare, sameGameAsShare, shareEntry, type GameSharePayload } from '../lib/new-game/share';
import type { ViewLine } from '../lib/timeline';
import type { SavedVariation } from './useRestoreVariation';

/** Opens a shared game as a saved copy with a new id, or its branch in the held game when the link names it. */

export interface SharedGameApp {
  ctx: {
    shared: { sharedGame: GameSharePayload | null; clearSharedBranch: () => void };
    newGame: { record: NewGameRecord | null; openRecord: (record: NewGameRecord) => Promise<unknown> };
    replay: { replayData: { id: string } | null };
  };
  board: {
    deviation: { branchPreparing: boolean; restoreVariation: (saved: SavedVariation) => Promise<unknown> };
    timeline: { navigateTo: (position: { turn: number; line: ViewLine }) => void; handleGraphSelectLine: (turn: number) => void };
  };
}

const POLL_MS = 25;
const WAIT_MS = 60_000;

export function holdsMainLine(payload: GameSharePayload, record: NewGameRecord | null): record is NewGameRecord {
  if (!record || record.id !== payload.gameId || payload.entries.length > record.entries.length) return false;
  return payload.entries.every((entry, index) => JSON.stringify(entry) === JSON.stringify(shareEntry(record.entries[index])));
}

const tick = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

/** Waits until the game's data is on screen and no branch is being prepared; false after a minute. */
export async function waitForGame(latest: React.RefObject<SharedGameApp>, id: string): Promise<boolean> {
  for (let waited = 0; waited < WAIT_MS; waited += POLL_MS) {
    const { ctx, board } = latest.current;
    if (ctx.replay.replayData?.id === id && !board.deviation.branchPreparing) return true;
    await tick(POLL_MS);
  }
  return false;
}

async function restoreView(latest: React.RefObject<SharedGameApp>, payload: GameSharePayload): Promise<void> {
  const { variation, view } = payload;
  // one more render after the game's data: the restore reads the snapshots and sources of the latest render
  await tick(0);
  if (variation && variation.entries.length > 0) {
    await latest.current.board.deviation.restoreVariation({
      startTurn: variation.startTurn, history: historyOfShare(variation.entries, variation.startTurn + 1),
      prefill: { p1Choices: [], p2Choices: [] }, pinnedTeams: null,
    });
    await tick(0);
  }
  if (!view) return;
  const { timeline } = latest.current.board;
  if (view.t0) timeline.handleGraphSelectLine(0);
  else timeline.navigateTo({ turn: view.turn, line: view.line });
}

async function openShared(latest: React.RefObject<SharedGameApp>, payload: GameSharePayload): Promise<string | null> {
  const { ctx } = latest.current;
  let game = holdsMainLine(payload, ctx.newGame.record) ? ctx.newGame.record : null;
  const held = game ? null : findGame(record => sameGameAsShare(record, payload), payload.seed);
  if (held) {
    ctx.shared.clearSharedBranch();
    if (ctx.newGame.record?.id !== held.id) await ctx.newGame.openRecord(held);
    game = held;
  } else if (!game) {
    const { recordOfShare } = await import('./branch/share-open');
    const engine = await import('../lib/lazy/branch-engine');
    const made = await recordOfShare(engine, payload);
    if ('error' in made) {
      ctx.shared.clearSharedBranch();
      return made.error;
    }
    saveGame(made);
    ctx.shared.clearSharedBranch();
    await ctx.newGame.openRecord(made);
    game = made;
  } else {
    ctx.shared.clearSharedBranch();
  }
  if (!(await waitForGame(latest, game.id))) return 'The shared game took too long to open.';
  await restoreView(latest, payload);
  return null;
}

export function useOpenSharedGame(app: SharedGameApp): { opening: boolean; error: string | null } {
  const latest = useRef(app);
  useEffect(() => {
    latest.current = app;
  });
  const [state, setState] = useState<{ opening: boolean; error: string | null }>({ opening: false, error: null });
  const handled = useRef<GameSharePayload | null>(null);
  const link = app.ctx.shared.sharedGame;
  useEffect(() => {
    if (!link || handled.current === link) return;
    handled.current = link;
    setState({ opening: true, error: null });
    void openShared(latest, link).then(
      error => setState({ opening: false, error }),
      (failure: unknown) => setState({ opening: false, error: failure instanceof Error ? failure.message : String(failure) }),
    );
  }, [link]);
  return state;
}
