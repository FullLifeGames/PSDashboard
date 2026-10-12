import { TeamValidator } from '@pkmn/sim';
import type { PokemonEvs } from '../types.ts';
import { isChampionsFormat } from './champions-format.ts';

export const ZERO_EVS: PokemonEvs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/** Every IV at 31: a Pokémon Champions body (the validator demands it, statModify reads no IV). */
export const ALL_31_IVS: PokemonEvs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

/**
 * Format-dependent EV legality. Pokémon Champions replaces EVs by Stat
 * Points (32 per stat, 66 in total; `statPoints`): the server's statModify
 * (@pkmn/mods champions) adds one stat point per Stat Point and reads no IV.
 * Gens 1 and 2 (round 69, T192) have no EV limit, so a set without EVs gets
 * 252 in every stat from the server (`start`, asked of its validator), and
 * one Special stat (`oneSpecial`): the calculator throws and the validator
 * copies when a Special Defense differs from Special Attack there.
 */
export interface EvBudget { perStat: number; total: number; statPoints: boolean; start: number; oneSpecial: boolean }
export function evBudget(formatid: string): EvBudget {
  if (isChampionsFormat(formatid)) return { perStat: 32, total: 66, statPoints: true, start: 0, oneSpecial: false };
  if (!/^gen[12]\D/.test(formatid)) return { perStat: 252, total: 508, statPoints: false, start: 0, oneSpecial: false };
  return { perStat: 252, total: 6 * 252, statPoints: false, start: serverStartEv(formatid), oneSpecial: true };
}

const startMemo = new Map<string, number>();

/** The EV every stat of a set without EVs gets from the server's validator (252 where the format has no EV limit). */
function serverStartEv(formatid: string): number {
  const known = startMemo.get(formatid);
  if (known !== undefined) return known;
  const probe = { name: '', species: 'Pikachu', moves: [] } as unknown as { evs?: PokemonEvs };
  try {
    new TeamValidator(formatid).validateSet(probe as never, {});
  } catch {
    // Not a format of the simulator: no EVs are given.
  }
  const start = probe.evs?.hp ?? 0;
  startMemo.set(formatid, start);
  return start;
}

/** What a set carries as its spread: its own EVs, else what the server gives a set without any (round 69, T192). */
export const evsOfSet = (evs: Partial<PokemonEvs> | undefined, budget: EvBudget): PokemonEvs =>
  (evs ? { ...ZERO_EVS, ...evs } : { hp: budget.start, atk: budget.start, def: budget.start, spa: budget.start, spd: budget.start, spe: budget.start });

/**
 * A spread or IV set as the calculator reads it where there is one Special stat: the validator copies Special Attack to
 * Special Defense (Gen 1) and the calculator throws when they differ, so a body never reaches it apart (round 69, T192).
 */
export function coupleSpecial<T extends Partial<PokemonEvs>>(stats: T | undefined, budget: EvBudget): T | undefined {
  const special = stats?.spa ?? stats?.spd;
  return budget.oneSpecial && stats && special !== undefined ? { ...stats, spa: special, spd: special } : stats;
}

export const evTotal = (evs: PokemonEvs): number =>
  Object.values(evs).reduce((sum, value) => sum + (value ?? 0), 0);

/** The solver's step: the stat moves every 4 EVs, and with every Stat Point. */
export const evStep = (budget: EvBudget): number => (budget.statPoints ? 1 : 4);

/**
 * Round 67 (T145): Stat Points as the EVs a Gen 9 calculator reads. With IV
 * 31, EV = 8·SP − 4 (0 at 0) puts floor(EV/4) = 2·SP − 1 into the stat
 * formula, the inner term of the server's statModify, so the calculator
 * gives the server's stat on every level (the engine's champions-mod spec
 * checks it against statModify for every Champions species and nature).
 */
export function calcEvs(evs: PokemonEvs, budget: EvBudget): PokemonEvs {
  if (!budget.statPoints) return evs;
  const out = { ...ZERO_EVS };
  for (const stat of Object.keys(out) as (keyof PokemonEvs)[]) {
    const points = evs[stat] ?? 0;
    out[stat] = points >= 1 ? 8 * points - 4 : 0;
  }
  return out;
}

/** The IVs a calculator reads: a Champions body has every IV at 31 (statModify reads none, the validator demands 31). */
export const calcIvs = (ivs: Partial<PokemonEvs> | undefined, budget: EvBudget): Partial<PokemonEvs> | undefined =>
  (budget.statPoints ? { ...ALL_31_IVS } : ivs);

/** The Stat Points that give an EV count's stat at level 50: floor((floor(EV/4) + 1) / 2) (252 EVs are 32 SP). */
export const statPointsOfEv = (ev: number): number => Math.floor((Math.floor(Math.max(0, ev) / 4) + 1) / 2);

/**
 * A spread on the budget's scale: under Stat Points, a spread above their
 * bounds (a stat over 32 or a total over 66) comes from an EV-scale source
 * (a Scarlet/Violet usage or set file, the species-shaped default) and is
 * read as EVs, converted stat by stat; Stat Point data never exceeds the
 * bounds.
 */
export function onBudgetScale(evs: PokemonEvs, budget: EvBudget): PokemonEvs {
  if (!budget.statPoints) return evs;
  const full = { ...ZERO_EVS, ...evs };
  const inBounds = Object.values(full).every(value => (value ?? 0) <= budget.perStat) && evTotal(full) <= budget.total;
  if (inBounds) return full;
  const out = { ...ZERO_EVS };
  for (const stat of Object.keys(out) as (keyof PokemonEvs)[]) out[stat] = statPointsOfEv(full[stat] ?? 0);
  return out;
}

/**
 * Legalize a composed spread: clamp every stat to the per-stat cap, then
 * shave down to the total budget — least-evidenced stats first (the
 * unprotected offense, then bulk, then HP), Speed last (damage evidence
 * never justifies stripping Speed, so it only gives way when the budget
 * leaves no other room), and rung-claimed (protected) stats after all
 * unprotected ones. Kept stats (a prior investment the evidence cannot
 * measure at all, see the ladder) give way last of all: a rung's claims
 * shrink before a kept stat does. The old unlegalized composition let a
 * prior's 252 Spe ride along with 252/252 overrides — a 756-EV spread
 * the sim then played. Fixed stats (round 40: HP EVs the log's maximum HP
 * measured exactly) are never shaved at all — they are a reading, not a
 * claim.
 */
export function capToBudget(
  evs: PokemonEvs, protectedStats: Set<keyof PokemonEvs>, budget: EvBudget, kept: ReadonlySet<keyof PokemonEvs> = new Set(),
  fixed: ReadonlySet<keyof PokemonEvs> = new Set(),
): PokemonEvs {
  const out: PokemonEvs = { ...evs };
  for (const stat of Object.keys(out) as (keyof PokemonEvs)[]) {
    out[stat] = Math.min(budget.perStat, Math.max(0, out[stat] ?? 0));
  }
  // One Special: a claim on either side stands for both (the one stat serves offense and defense alike).
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

/** Public legalizer: any spread on the format's scale (onBudgetScale), clamped to its budget. */
export function legalizeEvs(evs: Partial<PokemonEvs> | undefined, formatid: string): PokemonEvs {
  const budget = evBudget(formatid);
  return capToBudget(onBudgetScale({ ...ZERO_EVS, ...(evs ?? {}) }, budget), new Set(), budget);
}
