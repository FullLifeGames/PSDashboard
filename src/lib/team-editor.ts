import type { RevealedPokemonInfo, StatId } from '../types';
import { manualMove } from './team-info';
import { toId } from './ids';

export interface EditorPools {
  items: string[];
  teraTypes: string[];
  natures: readonly string[];
  movesBySpecies: Record<string, string[]>;
  abilitiesBySpecies: Record<string, string[]>;
}

export function sourceLabel(source: RevealedPokemonInfo['ability']['source'], probability?: number) {
  const suffix = probability === undefined ? '' : ` ${Math.round(probability * 1000) / 10}%`;
  return `${source.toUpperCase()}${suffix}`;
}

export const EV_STATS: { id: StatId; label: string }[] = [
  { id: 'hp', label: 'HP' },
  { id: 'atk', label: 'Atk' },
  { id: 'def', label: 'Def' },
  { id: 'spa', label: 'SpA' },
  { id: 'spd', label: 'SpD' },
  { id: 'spe', label: 'Spe' },
];

export function clampEv(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(252, Math.max(0, parsed));
}

/** The move's canonical pool spelling, or the illegality verdict when the species' pool is known. */
export function canonicalMove(pool: string[] | undefined, trimmed: string): { canonical: string } | { illegal: true } {
  if (pool && pool.length > 0 && !pool.some(name => toId(name) === toId(trimmed))) return { illegal: true };
  return { canonical: pool?.find(name => toId(name) === toId(trimmed)) ?? trimmed };
}

/** The team with `canonical` appended to one Pokémon's moves (up to four, no duplicates). */
export function withAddedMove(list: RevealedPokemonInfo[], index: number, canonical: string): RevealedPokemonInfo[] {
  const updated = [...list];
  if (updated[index].moves.length < 4 && !updated[index].moves.some(entry => toId(entry.name) === toId(canonical))) {
    updated[index] = {
      ...updated[index],
      moves: [...updated[index].moves, manualMove(canonical)],
    };
  }
  return updated;
}
