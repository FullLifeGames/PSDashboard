/**
 * Round 89 (#105, H4h): the end of a new game's main line. The end is the game's, not a variation's: the dock names the winner as
 * "won the game" and offers no turn. Two positions are that end: the live tip whose simulator ended with no turn played from it
 * (the game just finished), and, after a reload or Open, the end position of the main line (no live sim, only the log).
 */
export interface GameEndArgs {
  /** A new game is open (a replay keeps its own end). */
  isGame: boolean;
  viewingVariation: boolean;
  liveTip: boolean;
  simState: { ended: boolean; winner: string | null } | null;
  /** The pointer stands on the main line's end snapshot. */
  atEndPosition: boolean;
  /** The game's log, which names the winner at its end. */
  log: string;
}

/** The winner the log's win line names, else null. */
export const logWinner = (log: string): string | null => log.match(/\|win\|(.+)/)?.[1]?.trim() || null;

export function gameEnd(args: GameEndArgs): { winner: string | null } | undefined {
  const { isGame, viewingVariation, liveTip, simState, atEndPosition, log } = args;
  if (!isGame || viewingVariation) return undefined;
  if (liveTip) return simState?.ended ? { winner: simState.winner } : undefined;
  return atEndPosition ? { winner: logWinner(log) } : undefined;
}

export interface IdleTipArgs {
  /** The turn the game's next turn is played from; null when no new game is open. */
  gameTip: number | null;
  /** The live branch's start turn and entries. */
  startTurn: number | null;
  history: readonly object[];
  /** How many of the entries are turns (an interlude is the replacement that finishes one). */
  turnEntries: number;
  /** A side of the live sim still waits for a replacement: the turn is not finished. */
  replacementPending: boolean;
}

/**
 * Whether the live branch is the game's own next turn and no variation: no turn was played from the tip, or the first one is still
 * waiting for a replacement (it joins the main line once that is chosen). The top bar, the timeline and the side panels then show
 * none of a variation's chrome ("Branching", Discard variation, Variation moves, Save Branch); a variation from an earlier turn does.
 */
export function idleGameTip(args: IdleTipArgs): boolean {
  const { gameTip, startTurn, history, turnEntries, replacementPending } = args;
  if (gameTip === null || startTurn !== gameTip) return false;
  return history.length === 0 || (replacementPending && turnEntries === 1);
}
