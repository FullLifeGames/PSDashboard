/**
 * Round 89 (#105, H4h): the end of a new game's main line (H19a: a replay's too). The end is the game's, not a variation's: the dock names the winner as
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

/** The end of a main line: its winner (null for a tie), and `battle` for a replay (Showdown's own "won the battle!"), absent for a new game. */
export interface MainLineEnd {
  winner: string | null;
  battle?: true;
}

/**
 * Round 89, H19a (user ruling 13.11.2026): a replay at its end shows its result in the dock's place, as a game does, with no picker to
 * play: the winner of its log, or a tie. A log cut off before any result shows no end (the picker stays). Only the main line has an
 * end; a branch's end is the variation's.
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
