import type { PokemonEvs } from '../types.ts';

export const ZERO_EVS: PokemonEvs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/** Format-dependent EV legality (Pokémon Champions uses 32/stat, 66 total). */
export interface EvBudget { perStat: number; total: number }
export function evBudget(formatid: string): EvBudget {
  return /champions/.test(formatid) ? { perStat: 32, total: 66 } : { perStat: 252, total: 508 };
}

export const evTotal = (evs: PokemonEvs): number =>
  Object.values(evs).reduce((sum, value) => sum + (value ?? 0), 0);

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
 * the sim then played.
 */
export function capToBudget(
  evs: PokemonEvs, protectedStats: Set<keyof PokemonEvs>, budget: EvBudget, kept: ReadonlySet<keyof PokemonEvs> = new Set(),
): PokemonEvs {
  const out: PokemonEvs = { ...evs };
  for (const stat of Object.keys(out) as (keyof PokemonEvs)[]) {
    out[stat] = Math.min(budget.perStat, Math.max(0, out[stat] ?? 0));
  }
  const shaveOrder: (keyof PokemonEvs)[] = [
    ...(['atk', 'spa', 'def', 'spd', 'hp'] as (keyof PokemonEvs)[]).filter(stat => !protectedStats.has(stat) && !kept.has(stat)),
    ...(kept.has('spe') ? [] : ['spe' as const]),
    ...(['spd', 'def', 'hp', 'spa', 'atk'] as (keyof PokemonEvs)[]).filter(stat => protectedStats.has(stat) && !kept.has(stat)),
    ...(['spd', 'def', 'hp', 'spa', 'atk', 'spe'] as (keyof PokemonEvs)[]).filter(stat => kept.has(stat)),
  ];
  for (const stat of shaveOrder) {
    const over = evTotal(out) - budget.total;
    if (over <= 0) break;
    out[stat] = Math.max(0, (out[stat] ?? 0) - over);
  }
  return out;
}

/** Public legalizer: clamp any EV spread to the format's budget. */
export function legalizeEvs(evs: Partial<PokemonEvs> | undefined, formatid: string): PokemonEvs {
  return capToBudget({ ...ZERO_EVS, ...(evs ?? {}) }, new Set(), evBudget(formatid));
}
