import { type RevealedPokemonInfo, type StatId, evBudget, manualMove, toId } from '@fulllifegames/replay-core';

export interface EditorPools {
  items: string[];
  teraTypes: string[];
  natures: readonly string[];
  movesBySpecies: Record<string, string[]>;
  abilitiesBySpecies: Record<string, string[]>;
  /** The simulator's total EV limit of the format (`null`: none); absent until the pools are read. */
  evLimit?: number | null;
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

/**
 * What one Pokémon's spread may hold in a format: a cap per stat and, when the
 * format enforces one, a total (`null` = none). `statPoints` marks Pokémon
 * Champions, where the same numbers count Stat Points.
 */
export interface EvLimits { perStat: number; total: number | null; statPoints: boolean }

/**
 * The limits of a format. The per-stat cap and the Stat Points mark come from
 * replay-core's evBudget; the total is the simulator's rule table limit when
 * the pools have read it (`simTotal`, `null` = the format has none), and until
 * then only Champions' 66 is known without the simulator.
 */
export function evLimitsFor(format: string, simTotal?: number | null): EvLimits {
  const { perStat, total, statPoints } = evBudget(format);
  return { perStat, statPoints, total: simTotal !== undefined ? simTotal : statPoints ? total : null };
}

/** One typed EV: at most the stat cap and at most what the total leaves beside the other stats. */
export function clampEv(value: string, limits: EvLimits = evLimitsFor(''), othersTotal = 0): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  const room = limits.total === null ? limits.perStat : Math.max(0, limits.total - othersTotal);
  return Math.min(limits.perStat, room, Math.max(0, parsed));
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

/** The EVs a spread holds in every stat but `stat`: what the total has already spent beside it. */
export function evsBeside(evs: Partial<Record<StatId, number>>, stat: StatId): number {
  return EV_STATS.reduce((sum, entry) => (entry.id === stat ? sum : sum + (evs[entry.id] ?? 0)), 0);
}
