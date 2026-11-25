/** The end of a main line: the live tip whose simulator ended, or after a reload the main line's end (log only). */
export interface GameEndArgs {
  isGame: boolean;
  viewingVariation: boolean;
  liveTip: boolean;
  simState: { ended: boolean; winner: string | null } | null;
  atEndPosition: boolean;
  log: string;
}

export const logWinner = (log: string): string | null => log.match(/\|win\|(.+)/)?.[1]?.trim() || null;

export interface MainLineEnd {
  winner: string | null;
  battle?: true;
}

/** A replay at its end shows its result (the log's winner, or a tie); a log cut off before any result has no end. */
export function gameEnd(args: GameEndArgs): MainLineEnd | undefined {
  const { isGame, viewingVariation, liveTip, simState, atEndPosition, log } = args;
  if (viewingVariation) return undefined;
  if (!isGame) {
    const winner = logWinner(log);
    return atEndPosition && !liveTip && (winner || /\|tie(?:\||$)/m.test(log)) ? { winner, battle: true } : undefined;
  }
  if (liveTip) return simState?.ended ? { winner: simState.winner } : undefined;
  return atEndPosition ? { winner: logWinner(log) } : undefined;
}

export interface IdleTipArgs {
  gameTip: number | null;
  startTurn: number | null;
  history: readonly object[];
  turnEntries: number;
  replacementPending: boolean;
}

export function idleGameTip(args: IdleTipArgs): boolean {
  const { gameTip, startTurn, history, turnEntries, replacementPending } = args;
  if (gameTip === null || startTurn !== gameTip) return false;
  return history.length === 0 || (replacementPending && turnEntries === 1);
}
