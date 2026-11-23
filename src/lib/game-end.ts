/**
 * The end of a main line (a new game's or a replay's). The end is the game's, not a variation's: the dock names the winner and
 * offers no turn. Two positions are that end: the live tip whose simulator ended with no turn played from it, and, after a
 * reload or Open, the end position of the main line (no live sim, only the log).
 */
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

/**
 * A replay at its end shows its result in the dock's place: the winner of its log, or a tie. A log cut off before any result shows
 * no end (the picker stays). Only the main line has an end.
 */
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

/**
 * Whether the live branch is the game's own next turn and no variation: no turn was played from the tip, or the first one is still
 * waiting for a replacement (it joins the main line once that is chosen). The variation chrome stays hidden then.
 */
export function idleGameTip(args: IdleTipArgs): boolean {
  const { gameTip, startTurn, history, turnEntries, replacementPending } = args;
  if (gameTip === null || startTurn !== gameTip) return false;
  return history.length === 0 || (replacementPending && turnEntries === 1);
}
