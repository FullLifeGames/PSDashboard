import { type RevealedPokemonInfo, type StatId, evBudget, manualMove, toId } from '@fulllifegames/replay-core';

export interface EditorPools {
  items: string[];
  teraTypes: string[];
  natures: readonly string[];
  movesBySpecies: Record<string, string[]>;
  abilitiesBySpecies: Record<string, string[]>;
  /** Every move and every ability of the generation (empty before Generation 3 for abilities): the editor takes these beside the species' own. */
  allMoves: string[];
  allAbilities: string[];
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

/**
 * The move's canonical spelling and whether it lies outside the species' own pool (`outside`: the editor marks it with a note),
 * or `unknown` when the generation's whole list is known and does not hold the name. Before the lists load (`everyMove` empty
 * or absent) any name is taken as typed. A species without a pool of its own has no note to carry.
 */
export function canonicalMove(
  pool: string[] | undefined, trimmed: string, everyMove?: string[],
): { canonical: string; outside: boolean } | { unknown: true } {
  const find = (names: string[] | undefined) => names?.find(name => toId(name) === toId(trimmed));
  const own = find(pool);
  if (own) return { canonical: own, outside: false };
  if (!everyMove || everyMove.length === 0) return { canonical: trimmed, outside: false };
  const other = find(everyMove);
  return other ? { canonical: other, outside: !!pool && pool.length > 0 } : { unknown: true };
}

/** Whether a move lies outside a species' own pool (a species without a pool, and the lists before they load, count as inside). */
export function isOutsidePool(pool: string[] | undefined, move: string): boolean {
  return !!pool && pool.length > 0 && !pool.some(name => toId(name) === toId(move));
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

/**
 * Round 88 (F, #101): the saved team without the stand-in flag on every body the user changed. A stand-in the editor left as it was
 * stays a guess (the panel keeps its marker); a changed one is the user's own, like any edited body. Bodies match by species.
 */
export function withEditedStandIns(saved: RevealedPokemonInfo[], original: RevealedPokemonInfo[]): RevealedPokemonInfo[] {
  return saved.map(entry => {
    if (!entry.standIn) return entry;
    const before = original.find(candidate => candidate.species === entry.species);
    if (before && JSON.stringify(before) === JSON.stringify(entry)) return entry;
    const { standIn: guessed, ...edited } = entry;
    void guessed;
    return edited;
  });
}
