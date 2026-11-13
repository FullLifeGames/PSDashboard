import type { AppController } from '../hooks/useAppController';
import { gameTipTurn } from '../hooks/useNewGame';
import { encodeBranchShare } from '../lib/branch-share';
import { idleGameTip } from '../lib/game-end';
import { makeGameSharePayload, type GameSharePayload } from '../lib/new-game/share';
import { turnEntryCount } from '../lib/variation-turns';
import { shareUrl } from './useBranchSaveShare';

/**
 * Round 89 (#105): a new game's live tip is the main line's next turn, no variation (`idleGameTip`): while no turn was played from
 * it, or its first turn waits for a replacement, the timeline, the side panels, the graph and the share link show none of a
 * variation's chrome. One reading for every reader of it.
 */
export function idleTip(app: AppController): boolean {
  const record = app.ctx.newGame.record;
  const { history, variationStartTurn, simState } = app.ctx.branch;
  return idleGameTip({
    gameTip: record ? gameTipTurn(record) : null, startTurn: variationStartTurn, history, turnEntries: turnEntryCount(history),
    replacementPending: !!simState && (simState.p1ForceSwitch || simState.p2ForceSwitch),
  });
}

/** Where the sharer stands: on the main line's tip while the tip turn is idle, else where the pointer is. */
function gameView(app: AppController, idle: boolean): NonNullable<GameSharePayload['view']> {
  const record = app.ctx.newGame.record!;
  const { viewTurn, viewT0, viewingVariation } = app.board.timeline;
  if (idle) {
    const tip = gameTipTurn(record);
    return tip === 0 ? { turn: 1, line: 'main', t0: true } : { turn: tip, line: 'main' };
  }
  return { turn: viewTurn, line: viewingVariation ? 'variation' : 'main', ...(viewT0 ? { t0: true } : {}) };
}

/**
 * The share link of the open game: its main line, the open variation when there is one, and the turn the pointer stands on
 * (version 2, ruling 31 H6a). It exists for a game at Team Preview, on the main line, at the tip and at the end, with or without a
 * variation; a tip turn that waits for its replacement is no variation. Null while no game is open.
 */
export function gameShareLink(app: AppController): string | null {
  const record = app.ctx.newGame.record;
  if (!record) return null;
  const { history, variationStartTurn } = app.ctx.branch;
  const idle = idleTip(app);
  const variation = !idle && variationStartTurn !== null && history.length > 0 ? { startTurn: variationStartTurn, history } : undefined;
  return shareUrl(encodeBranchShare(makeGameSharePayload({ record, variation, view: gameView(app, idle) })));
}
