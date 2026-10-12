import type { CalcBody } from './body.ts';

/**
 * Round 69 (T152 point 3): the Stellar one-time boost. A Stellar Tera body's
 * first use of each type hits harder (the calc's isStellarFirstUse: 1.2 times,
 * or 2 times STAB on its own types, and a base power floor of 60), and the
 * simulator lists the types it spent (stellarBoostedTypes, empty before the
 * Tera turn; Terapagos-Stellar never spends one). The type at use is the
 * calc's own after its type changes, so the caller hands in a calculation of
 * the move without the flag. Without the list (a picker state approximated
 * from the replay) the spent types are unknown and no boost is claimed.
 */
export function stellarFirstUse(body: Pick<CalcBody, 'tera' | 'stellarBoostedTypes'>, typeAtUse: () => string): boolean {
  const spent = body.stellarBoostedTypes;
  return body.tera === 'Stellar' && !!spent && !spent.includes(typeAtUse());
}
