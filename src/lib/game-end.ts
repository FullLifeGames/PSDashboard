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
}

export function gameEnd(args: GameEndArgs): { winner: string | null } | undefined {
  const { isGame, viewingVariation, liveTip, simState } = args;
  if (!isGame || viewingVariation) return undefined;
  return liveTip && simState?.ended ? { winner: simState.winner } : undefined;
}
