import type { SimSide } from './types.ts';

/** Two actives trade slots; both stay in play, so unlike a switch-in nothing about either body (its lock, its last move) is reset. */
export function swapActiveSlots(side: SimSide, from: number, to: number) {
  const [first, second] = [side.active[from], side.active[to]];
  side.active[from] = second;
  side.active[to] = first;
  // The sim keeps side.pokemon[i] === side.active[i] for the active slots.
  const [firstIndex, secondIndex] = [side.pokemon.indexOf(first), side.pokemon.indexOf(second)];
  side.pokemon[firstIndex] = second;
  side.pokemon[secondIndex] = first;
  first.position = secondIndex;
  second.position = firstIndex;
}
