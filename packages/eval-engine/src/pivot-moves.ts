// The moves whose follow-up is the user's switch to a living bench body, read per generation from the Dex; it asks a Dex, never a battle.

/** What both Dex objects share: the move lookup, and the two fields the reading needs. */
interface PivotDex {
  moves: { get(name: string): { exists: boolean; selfSwitch?: unknown; slotCondition?: unknown } };
}

/**
 * Whether the move is followed by the user's switch to a living bench body: the simulator's `selfSwitch` (Teleport carries it from Gen 8 on).
 * Revival Blessing carries the field too, but its request revives a fainted ally (its `slotCondition`). pivot-moves.spec.ts plays every move.
 */
export function isPivotMove(dex: PivotDex, moveId: string): boolean {
  const move = dex.moves.get(moveId);
  return move.exists && !!move.selfSwitch && !move.slotCondition;
}
