import type { Battle, Pokemon } from '@pkmn/sim';
import { bodyStateKey, boardStateKey, readsFactory, type ReadSet } from './board-key.ts';

/** Maps a key string to a small integer; a reader drops its cached numbers when `generation` moves. */
export class Interner {
  generation = 0;
  private readonly ids = new Map<string, number>();

  id(text: string): number {
    let id = this.ids.get(text);
    if (id === undefined) this.ids.set(text, id = this.ids.size);
    return id;
  }

  held(): { entries: number; chars: number } {
    let chars = 0;
    for (const text of this.ids.keys()) chars += text.length;
    return { entries: this.ids.size, chars };
  }

  reset(): void {
    this.ids.clear();
    this.generation++;
  }
}

export const placeKey = (pokemon: Pokemon): string => `${pokemon.side.id}${pokemon.position}:`;

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

export type HitKey = (attacker: Pokemon, defender: Pokemon, moveId: string) => string;

/** The memo key of a hit: board key, the pair, other actives and, where a handler names `pokemon`, the bench. */
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

export function residualKey(battle: Battle, slots: readonly (Pokemon | null)[], interner: Interner): string {
  const set = readsFactory(battle, 'residual')([]);
  const bodyId = bodyIds('residual', interner);
  return `${interner.id(boardStateKey(battle, set, 'residual'))}||${slots.map(pokemon => (pokemon ? bodyId(pokemon, set) : '-')).join('|')}`;
}
