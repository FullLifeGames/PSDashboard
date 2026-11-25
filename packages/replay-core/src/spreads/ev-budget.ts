import { TeamValidator } from '@pkmn/sim';
import type { PokemonEvs } from '../types.ts';
import { genNumOf } from '../ids.ts';
import { isChampionsFormat } from '../champions-format.ts';

export const ZERO_EVS: PokemonEvs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/** Every IV at 31: a Pokémon Champions body (the validator demands it, statModify reads no IV). */
export const ALL_31_IVS: PokemonEvs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

/** The EV rules of a format: per-stat cap, total, Stat Points, start EVs (Gens 1 and 2), one Special stat. */
export interface EvBudget { perStat: number; total: number; statPoints: boolean; start: number; oneSpecial: boolean }
/** The EV budget of a format id or a bare generation hint ('gen1'). */
export function evBudget(formatid: string): EvBudget {
  // Champions: Stat Points (32 per stat, 66 in total); statModify adds one point per Stat Point and reads no IV.
  // Gens 1 and 2: no EV limit, a set without EVs gets 252 in every stat (`start`) and one Special stat (`oneSpecial`).
  if (isChampionsFormat(formatid)) return { perStat: 32, total: 66, statPoints: true, start: 0, oneSpecial: false };
  const gen = genNumOf(formatid);
  if (gen > 2) return { perStat: 252, total: 508, statPoints: false, start: 0, oneSpecial: false };
  return { perStat: 252, total: 6 * 252, statPoints: false, start: serverStartEv(gen), oneSpecial: true };
}

const startMemo = new Map<number, number>();

// The server's validator gives 252 in Gens 1 and 2; spread-gen12-build.spec.ts checks it against every format of them.
function serverStartEv(gen: number): number {
  const known = startMemo.get(gen);
  if (known !== undefined) return known;
  const probe = { name: '', species: 'Pikachu', moves: [] } as unknown as { evs?: PokemonEvs };
  try {
    new TeamValidator(`gen${gen}customgame`).validateSet(probe as never, {});
  } catch {
    // Not a format of the simulator: no EVs are given.
  }
  const start = probe.evs?.hp ?? 0;
  startMemo.set(gen, start);
  return start;
}

export const evsOfSet = (evs: Partial<PokemonEvs> | undefined, budget: EvBudget): PokemonEvs =>
  (evs ? { ...ZERO_EVS, ...evs } : { hp: budget.start, atk: budget.start, def: budget.start, spa: budget.start, spd: budget.start, spe: budget.start });

/** A spread as the calculator reads it with one Special stat: the validator copies Special Attack to Defense. */
export function coupleSpecial<T extends Partial<PokemonEvs>>(stats: T | undefined, budget: EvBudget): T | undefined {
  const special = stats?.spa ?? stats?.spd;
  return budget.oneSpecial && stats && special !== undefined ? { ...stats, spa: special, spd: special } : stats;
}

export const evTotal = (evs: PokemonEvs): number =>
  Object.values(evs).reduce((sum, value) => sum + (value ?? 0), 0);

export const evStep = (budget: EvBudget): number => (budget.statPoints ? 1 : 4);

/** Stat Points as calculator EVs: at IV 31, EV = 8·SP − 4 (0 at 0) gives floor(EV/4) = 2·SP − 1 in statModify. */
export function calcEvs(evs: PokemonEvs, budget: EvBudget): PokemonEvs {
  if (!budget.statPoints) return evs;
  const out = { ...ZERO_EVS };
  for (const stat of Object.keys(out) as (keyof PokemonEvs)[]) {
    const points = evs[stat] ?? 0;
    out[stat] = points >= 1 ? 8 * points - 4 : 0;
  }
  return out;
}

/** The IVs a calculator reads: a Champions body has every IV at 31. */
export const calcIvs = (ivs: Partial<PokemonEvs> | undefined, budget: EvBudget): Partial<PokemonEvs> | undefined =>
  (budget.statPoints ? { ...ALL_31_IVS } : ivs);

/** The Stat Points that give an EV count's stat at level 50: floor((floor(EV/4) + 1) / 2) (252 EVs are 32 SP). */
export const statPointsOfEv = (ev: number): number => Math.floor((Math.floor(Math.max(0, ev) / 4) + 1) / 2);

/** A spread on the budget's scale: under Stat Points, a spread above their bounds is EV-scale and converts. */
export function onBudgetScale(evs: PokemonEvs, budget: EvBudget): PokemonEvs {
  if (!budget.statPoints) return evs;
  const full = { ...ZERO_EVS, ...evs };
  const inBounds = Object.values(full).every(value => (value ?? 0) <= budget.perStat) && evTotal(full) <= budget.total;
  if (inBounds) return full;
  const out = { ...ZERO_EVS };
  for (const stat of Object.keys(out) as (keyof PokemonEvs)[]) out[stat] = statPointsOfEv(full[stat] ?? 0);
  return out;
}

/** Clamps to the per-stat cap, then shaves to the total in a fixed order; fixed stats (the log's HP) stay. */
export function capToBudget(
  evs: PokemonEvs, protectedStats: Set<keyof PokemonEvs>, budget: EvBudget, kept: ReadonlySet<keyof PokemonEvs> = new Set(),
  fixed: ReadonlySet<keyof PokemonEvs> = new Set(),
): PokemonEvs {
  const out: PokemonEvs = { ...evs };
  for (const stat of Object.keys(out) as (keyof PokemonEvs)[]) {
    out[stat] = Math.min(budget.perStat, Math.max(0, out[stat] ?? 0));
  }
  if (budget.oneSpecial) out.spa = out.spd = Math.max(out.spa ?? 0, out.spd ?? 0);
  const shaveOrder: (keyof PokemonEvs)[] = [
    ...(['atk', 'spa', 'def', 'spd', 'hp'] as (keyof PokemonEvs)[]).filter(stat => !protectedStats.has(stat) && !kept.has(stat)),
    ...(kept.has('spe') ? [] : ['spe' as const]),
    ...(['spd', 'def', 'hp', 'spa', 'atk'] as (keyof PokemonEvs)[]).filter(stat => protectedStats.has(stat) && !kept.has(stat)),
    ...(['spd', 'def', 'hp', 'spa', 'atk', 'spe'] as (keyof PokemonEvs)[]).filter(stat => kept.has(stat)),
  ].filter(stat => !fixed.has(stat));
  for (const stat of shaveOrder) {
    const over = evTotal(out) - budget.total;
    if (over <= 0) break;
    out[stat] = Math.max(0, (out[stat] ?? 0) - over);
  }
  return out;
}

export function legalizeEvs(evs: Partial<PokemonEvs> | undefined, formatid: string): PokemonEvs {
  const budget = evBudget(formatid);
  return capToBudget(onBudgetScale({ ...ZERO_EVS, ...(evs ?? {}) }, budget), new Set(), budget);
}
