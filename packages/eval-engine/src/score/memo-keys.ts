import type { Battle, Pokemon } from '@pkmn/sim';
import { bodyStateKey, boardStateKey, readsFactory, type ReadSet } from './board-key.ts';

/**
 * Round 89 (#149, step A8): the memo keys of the two memos that play a board, built from the board key of score/board-key.ts.
 * A body's key runs to several hundred characters (every field the play reads), so a memo key holds numbers: a key string is
 * interned to a small integer, and the interner starts over together with the memo it serves. A reader caches the numbers it
 * handed out, with the interner's generation, and drops them when the memo started over: a number from before a clear is
 * never reused.
 */
export class Interner {
  /** Raised when the interner starts over. */
  generation = 0;
  private readonly ids = new Map<string, number>();

  id(text: string): number {
    let id = this.ids.get(text);
    if (id === undefined) this.ids.set(text, id = this.ids.size);
    return id;
  }

  reset(): void {
    this.ids.clear();
    this.generation++;
  }
}

/** Where a body stands. */
export const placeKey = (pokemon: Pokemon): string => `${pokemon.side.id}${pokemon.position}:`;

/** The id of a body's key under a set of reads, found once per reader and generation. */
function bodyIds(consumer: 'hit' | 'residual', interner: Interner): (pokemon: Pokemon, reads: ReadSet, withHp?: boolean) => number {
  let generation = interner.generation;
  let cache = [new Map<ReadSet, Map<Pokemon, number>>(), new Map<ReadSet, Map<Pokemon, number>>()];
  return (pokemon, reads, withHp = false) => {
    if (generation !== interner.generation) {
      generation = interner.generation;
      cache = [new Map(), new Map()];
    }
    const sets = cache[withHp ? 1 : 0];
    let bodies = sets.get(reads);
    if (!bodies) sets.set(reads, bodies = new Map());
    let id = bodies.get(pokemon);
    if (id === undefined) bodies.set(pokemon, id = interner.id(`${withHp ? 'b' : 'a'}${bodyStateKey(pokemon, reads, consumer, withHp)}`));
    return id;
  };
}

/** The reading of the key of a hit for one board: the key of `attacker`'s hit of `moveId` on `defender`. */
export type HitKey = (attacker: Pokemon, defender: Pokemon, moveId: string) => string;

/**
 * The key under which the hit of a pair is memoized: the board key (field, sides, battle) and the key of the move, the pair
 * with its places, every other active with its place, and, where a handler on the board names a side's `pokemon`, the benched
 * bodies of both sides with their HP. What the hit reads of each body follows the reads of everything on the board and of the move.
 */
export function hitKeyReader(battle: Battle, interner: Interner): HitKey {
  const reads = readsFactory(battle, 'hit');
  const bodyId = bodyIds('hit', interner);
  let generation = interner.generation;
  let boards = new Map<ReadSet, number>();
  const boardId = (set: ReadSet): number => {
    if (generation !== interner.generation) {
      generation = interner.generation;
      boards = new Map();
    }
    let id = boards.get(set);
    if (id === undefined) boards.set(set, id = interner.id(boardStateKey(battle, set, 'hit')));
    return id;
  };
  return (attacker, defender, moveId) => {
    const set = reads([attacker, defender], moveId);
    const scene = battle.sides.flatMap(side => side.active.map(pokemon => (pokemon && pokemon !== attacker && pokemon !== defender ? `${placeKey(pokemon)}${bodyId(pokemon, set)}` : '-'))).join('|');
    const bench = set.has('pokemon')
      ? battle.sides.map(side => side.pokemon.map(pokemon => (pokemon.isActive || pokemon === attacker || pokemon === defender ? '-' : bodyId(pokemon, set, true))).join(',')).join('|')
      : '';
    return `${boardId(set)}#${moveId}#${placeKey(attacker)}${bodyId(attacker, set)}>${placeKey(defender)}${bodyId(defender, set)}#${scene}#${bench}`;
  };
}

/** The key under which the end of a board's turn is memoized: the board key and the key of every active, in the order of the slots. */
export function residualKey(battle: Battle, slots: readonly (Pokemon | null)[], interner: Interner): string {
  const set = readsFactory(battle, 'residual')([]);
  const bodyId = bodyIds('residual', interner);
  return `${interner.id(boardStateKey(battle, set, 'residual'))}||${slots.map(pokemon => (pokemon ? bodyId(pokemon, set) : '-')).join('|')}`;
}
