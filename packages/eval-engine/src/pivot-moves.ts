interface PivotDex {
  moves: { get(name: string): { exists: boolean; selfSwitch?: unknown; slotCondition?: unknown } };
}

/** `selfSwitch` moves (Teleport from Gen 8) except Revival Blessing, whose `slotCondition` revives a fainted ally. */
export function isPivotMove(dex: PivotDex, moveId: string): boolean {
  const move = dex.moves.get(moveId);
  return move.exists && !!move.selfSwitch && !move.slotCondition;
}
