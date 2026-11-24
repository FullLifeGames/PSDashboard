import { MAX_PRICED_HITS, type HitCost } from './contact-cost.ts';

export interface HitPrice {
  residual: number;
  output: number;
  /** HP the side is worth more in the clock of the other side: one chip for the side that moves second. */
  buffer: number;
}

export { MAX_PRICED_HITS };

const FREE: HitPrice = { residual: 0, output: 1, buffer: 0 };

const horizon = (clock: number): number => Math.min(Math.max(1, Math.floor(clock)), MAX_PRICED_HITS);

/** A side's hit price: the second mover gets a chip back as `buffer`; clock ceil((HP + chip) / (hit + chip)). */
// The first status stays (the simulator gives a second one to nobody): it lands on hit j with chance (1 - q)^(j - 1) q.
export function priceHit(cost: HitCost, own: number, other: number, ownFirst: boolean): HitPrice {
  if (cost.chip === 0 && cost.statuses.length === 0) return FREE;
  const landing = horizon(own);
  const turns = horizon(other);
  const chance = cost.statuses.reduce((sum, entry) => sum + entry.chance, 0);
  let output = landing;
  let chips = 0;
  for (const entry of cost.statuses) {
    for (let at = 1; at <= MAX_PRICED_HITS; at++) {
      const probability = (1 - chance) ** (at - 1) * entry.chance;
      for (let after = 1; after <= landing - at; after++) output += probability * (entry.output * (entry.acts?.[after - 1] ?? 1) - 1);
      chips += probability * entry.chip * Math.max(0, turns - at);
    }
  }
  return { residual: cost.chip + chips / turns, output: output / landing, buffer: ownFirst ? 0 : cost.chip };
}
