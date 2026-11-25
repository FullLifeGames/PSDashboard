import type { CalcBody } from './body.ts';

/** Stellar's one-time boost (calc isStellarFirstUse: 1.2x, 2x STAB on own types, power floor 60); not for Terapagos. */
export function stellarFirstUse(body: Pick<CalcBody, 'tera' | 'stellarBoostedTypes'>, typeAtUse: () => string): boolean {
  const spent = body.stellarBoostedTypes;
  return body.tera === 'Stellar' && !!spent && !spent.includes(typeAtUse());
}
