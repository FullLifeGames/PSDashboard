import type { AppController } from '../hooks/useAppController';
import { gameTipTurn } from '../hooks/useNewGame';
import { encodeBranchShare, makeBranchSharePayload } from '../lib/branch-share';
import { variationSaved } from '../lib/variation-saved';
import { idleGameTip } from '../lib/game-end';
import { makeGameSharePayload, type GameSharePayload } from '../lib/new-game/share';
import { turnEntryCount } from '../lib/variation-turns';
import { shareUrl } from './useBranchSaveShare';

/** A new game's tip is no variation while no turn was played from it or its first turn waits for a replacement. */
export function idleTip(app: AppController): boolean {
  const record = app.ctx.newGame.record;
  const { history, variationStartTurn, simState } = app.ctx.branch;
  return idleGameTip({
    gameTip: record ? gameTipTurn(record) : null, startTurn: variationStartTurn, history, turnEntries: turnEntryCount(history),
    replacementPending: !!simState && (simState.p1ForceSwitch || simState.p2ForceSwitch),
  });
}

/** A branch with a played turn that is no idle tip of a game; a replay's branch always counts. */
export function variationOpen(app: AppController): boolean {
  return app.ctx.branch.history.length > 0 && !idleTip(app);
}

/** An open variation that no saved branch holds; Save Branch writes the row the comparison reads. */
export function unsavedVariation(app: AppController): boolean {
  if (!variationOpen(app)) return false;
  const { history, variationStartTurn } = app.ctx.branch;
  const replay = app.ctx.replay.replayData;
  if (!replay) return false;
  const record = app.ctx.newGame.record;
  const startTurn = variationStartTurn ?? app.board.timeline.viewTurn;
  return !variationSaved(record
    ? makeGameSharePayload({ record, variation: { startTurn, history }, view: gameView(app, false) })
    : makeBranchSharePayload({ replay, branchTurn: startTurn, history, finalLog: app.analysis.simLog }));
}

function gameView(app: AppController, idle: boolean): NonNullable<GameSharePayload['view']> {
  const record = app.ctx.newGame.record!;
  const { viewTurn, viewT0, viewingVariation } = app.board.timeline;
  if (idle) {
    const tip = gameTipTurn(record);
    return tip === 0 ? { turn: 1, line: 'main', t0: true } : { turn: tip, line: 'main' };
  }
  return { turn: viewTurn, line: viewingVariation ? 'variation' : 'main', ...(viewT0 ? { t0: true } : {}) };
}

/** Null while no game is open; a tip turn that waits for its replacement is no variation (link version 2). */
export function gameShareLink(app: AppController): string | null {
  const record = app.ctx.newGame.record;
  if (!record) return null;
  const { history, variationStartTurn } = app.ctx.branch;
  const idle = idleTip(app);
  const variation = !idle && variationStartTurn !== null && history.length > 0 ? { startTurn: variationStartTurn, history } : undefined;
  return shareUrl(encodeBranchShare(makeGameSharePayload({ record, variation, view: gameView(app, idle) })));
}
