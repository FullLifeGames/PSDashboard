// Data-only Dex, like set-coherence.ts: this module rides into the app's
// MAIN bundle through the team-info enrichment.
import { Dex } from '@pkmn/dex';
import type { SetAssumption } from '../smogon/sets-lookup.ts';
import { toId } from '../ids.ts';

/**
 * Published move slots (round 63, T89): a Smogon set lists a slot either as
 * one move or as its options ("Heat Wave / Hidden Power Ice"). The build
 * reads a slot as filled once any option was seen, and offers a fixed move
 * before any alternative (spec decision 11).
 */

/**
 * The key a move fills a slot with: every typed Hidden Power answers a
 * typeless one, because logs before gen 8 show "Hidden Power" without its
 * type (the enrichment dedups the same way).
 */
export function slotMoveKey(name: string): string {
  const move = Dex.moves.get(name);
  const id = move.exists ? move.id as string : toId(name);
  return id.startsWith('hiddenpower') ? 'hiddenpower' : id;
}

/** Every move a set may carry, each option of each slot included. */
export function slotOptionKeys(moves: SetAssumption[]): string[] {
  return moves.flatMap(move => (move.options ?? [move.value]).map(slotMoveKey));
}

/**
 * The set's moves in the order the build offers them: a slot whose option
 * was seen drops out (the seen move already heads the pool), fixed moves
 * come first, then each open slot's first option, then the open slots'
 * other options (the rest of the chosen set, which a short pool draws on
 * before usage, decision 12). A set without slots keeps its own array.
 */
export function slotOrderedMoves(moves: SetAssumption[], revealedKeys: ReadonlySet<string>): SetAssumption[] {
  if (!moves.some(move => (move.options?.length ?? 0) > 1)) return moves;
  const fixed: SetAssumption[] = [];
  const open: SetAssumption[] = [];
  for (const move of moves) {
    const options = move.options ?? [move.value];
    if (options.length <= 1) fixed.push(move);
    else if (!options.some(option => revealedKeys.has(slotMoveKey(option)))) open.push(move);
  }
  const option = (move: SetAssumption, value: string): SetAssumption => ({ value, sourceDetail: move.sourceDetail });
  return [
    ...fixed,
    ...open.map(move => option(move, move.value)),
    ...open.flatMap(move => (move.options ?? []).slice(1).map(value => option(move, value))),
  ];
}
