// Data-only Dex, like set-coherence.ts: this module rides into the app's
// MAIN bundle through the team-info enrichment.
import { Dex } from '@pkmn/dex';
import type { SetAssumption } from '../smogon/sets-lookup.ts';
import { toId } from '../ids.ts';

/**
 * Published move slots (round 63, T89): a Smogon set lists a slot either as
 * one move or as its options ("Heat Wave / Hidden Power Ice"). A slot holds
 * one move, so a seen option fills it; the build offers a fixed move before
 * any alternative (spec decision 11).
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

const slotKeys = (move: SetAssumption) => new Set((move.options ?? [move.value]).map(slotMoveKey));

/**
 * The slots the revealed moves fill: one move per slot, as many slots as
 * the moves can fill together (a maximum matching), fixed slots tried
 * first. Two seen options of one slot fill it once (573756: "The Pex" lists
 * Toxic and Haze as one slot, the log shows both).
 */
export function filledSlots(moves: SetAssumption[], revealedKeys: Iterable<string>): Set<number> {
  const keys = moves.map(slotKeys);
  const order = keys.map((_, index) => index).sort((a, b) => keys[a].size - keys[b].size);
  const holder = new Map<number, string>();
  const place = (key: string, tried: Set<number>): boolean => {
    for (const slot of order) {
      if (!keys[slot].has(key) || tried.has(slot)) continue;
      tried.add(slot);
      const previous = holder.get(slot);
      if (previous === undefined || place(previous, tried)) {
        holder.set(slot, key);
        return true;
      }
    }
    return false;
  };
  for (const key of new Set(revealedKeys)) place(key, new Set());
  return new Set(holder.keys());
}

/**
 * The set's moves in the order the build offers them: a filled slot with
 * options drops out (the seen move already heads the pool), fixed moves come
 * first, then each open slot's first unseen option, then the open slots'
 * other options (the rest of the chosen set, which a short pool draws on
 * before usage, decision 12). A set without slots keeps its own array.
 */
export function slotOrderedMoves(moves: SetAssumption[], revealedKeys: ReadonlySet<string>): SetAssumption[] {
  if (!moves.some(move => (move.options?.length ?? 0) > 1)) return moves;
  const filled = filledSlots(moves, revealedKeys);
  const fixed: SetAssumption[] = [];
  const open: SetAssumption[][] = [];
  moves.forEach((move, index) => {
    const options = move.options ?? [move.value];
    if (options.length <= 1) fixed.push(move);
    else if (!filled.has(index)) {
      open.push(options.filter(option => !revealedKeys.has(slotMoveKey(option)))
        .map(value => ({ value, sourceDetail: move.sourceDetail })));
    }
  });
  return [...fixed, ...open.map(options => options[0]), ...open.flatMap(options => options.slice(1))]
    .filter((move): move is SetAssumption => move !== undefined);
}
