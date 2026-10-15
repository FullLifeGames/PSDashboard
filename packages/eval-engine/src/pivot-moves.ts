/**
 * Round 70 (N1): the moves whose follow-up is the user's switch to a living bench body: U-turn, Volt Switch, Flip Turn,
 * Parting Shot, Baton Pass, Shed Tail, Chilly Reception, and Teleport from Gen 8 on (before that it switches nobody). The
 * Dex says it per generation: the simulator's `selfSwitch`. Revival Blessing carries the field as well, but its request
 * revives a fainted ally (its `slotCondition`), so a switch to a living body is no follow-up of it. Two hand lists of eight
 * names used to answer this (played.ts and search/options.ts); test/pivot-moves.spec.ts plays every move of every
 * generation and the Champions mod against this reading. Pure data, safe for the main bundle: it asks a Dex (the
 * simulator's or @pkmn/dex's), never a battle.
 */

/** What both Dex objects share: the move lookup, and the two fields the reading needs. */
interface PivotDex {
  moves: { get(name: string): { exists: boolean; selfSwitch?: unknown; slotCondition?: unknown } };
}

export function isPivotMove(dex: PivotDex, moveId: string): boolean {
  const move = dex.moves.get(moveId);
  return move.exists && !!move.selfSwitch && !move.slotCondition;
}
