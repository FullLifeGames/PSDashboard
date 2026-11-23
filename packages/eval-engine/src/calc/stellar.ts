import type { CalcBody } from './body.ts';

/**
 * The Stellar one-time boost: a Stellar Tera body's first use of each type (calc isStellarFirstUse: 1.2 times, 2 times STAB on its own
 * types, base power floor 60). Spent types come from the simulator's stellarBoostedTypes; without the list no boost is claimed.
 * Terapagos-Stellar never spends one. `typeAtUse` is the type after the calc's own type changes.
 */
export function stellarFirstUse(body: Pick<CalcBody, 'tera' | 'stellarBoostedTypes'>, typeAtUse: () => string): boolean {
  const spent = body.stellarBoostedTypes;
  return body.tera === 'Stellar' && !!spent && !spent.includes(typeAtUse());
}
