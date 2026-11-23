interface MoveDex {
  moves: { get(id: string): { exists: boolean; isZ?: unknown; isMax?: unknown } };
}

/** Whether the move is a Z-move or a Max move (`isZ`, `isMax`, G-Max and Max Guard included); a powered hit gives the solver no damage reading. */
export function poweredMove(dex: MoveDex, moveId: string): boolean {
  // The data holds a placeholder power (1 for a Z-move, 10 for most Max moves) while the simulator plays the base move's real power.
  const move = dex.moves.get(moveId);
  return move.exists && (!!move.isZ || !!move.isMax);
}
