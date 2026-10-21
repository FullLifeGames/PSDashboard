/** The part of a Dex this reads: any generation's or mod's. */
interface MoveDex {
  moves: { get(id: string): { exists: boolean; isZ?: unknown; isMax?: unknown } };
}

/**
 * A Z-move or a Max move (round 73, T229). Its line names the powered move; the data holds a placeholder power for it (1 for a Z-move,
 * 10 for most Max moves) and the simulator plays the real power of the base move, which the log never names. The Dex marks them
 * (`isZ`, `isMax`, G-Max moves and Max Guard included). A powered hit gives the solver no damage reading, and the move line gives the
 * set no move of its own.
 */
export function poweredMove(dex: MoveDex, moveId: string): boolean {
  const move = dex.moves.get(moveId);
  return move.exists && (!!move.isZ || !!move.isMax);
}
