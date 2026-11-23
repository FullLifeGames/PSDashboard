import { MAX_PRICED_HITS, type HitCost } from './contact-cost.ts';

// The cost of one hit (score/contact.ts) as three numbers for the side that pays, so that the races of score/races.ts can price it.

/** What a hit's cost adds to a side of a race. */
export interface HitPrice {
  /** HP lost per turn on top of the side's residual. */
  residual: number;
  /** The share of its damage the side still deals. */
  output: number;
  /** HP the side is worth more in the clock of the other side: one chip for the side that moves second. */
  buffer: number;
}

/** The longest race priced; a race that never ends is priced over this many hits (defined in score/contact-cost.ts). */
export { MAX_PRICED_HITS };

const FREE: HitPrice = { residual: 0, output: 1, buffer: 0 };

/** A clock as a number of hits: whole, at least one, at most MAX_PRICED_HITS (a clock that never ends is the longest). */
const horizon = (clock: number): number => Math.min(Math.max(1, Math.floor(clock)), MAX_PRICED_HITS);

/**
 * The price of the hits of one side that cost `cost`. `own` is the side's clock on the other (the hits it lands to win),
 * `other` the other side's clock on it (the turns it has to live), `ownFirst` whether it moves first.
 *
 * The chip of a hit is paid right after the hit. The first mover has paid t chips when the other side lands its t-th hit,
 * the second mover t - 1: a residual of one chip per turn counts t, so the second mover gets one chip back as `buffer`,
 * which makes the clock ceil((HP + chip) / (hit + chip)). The chip of the hit that finishes the race decides nothing.
 *
 * With q the chance that some status lands on one hit, the first status stays (the simulator gives a second one to nobody),
 * so it lands on hit j with chance (1 - q)^(j - 1) q. It takes its chip at the end of the turns j to the turn before the
 * other side's last hit, and only the hits after j deal its share of the damage (hit j is dealt before the status).
 * Paralysis, sleep and freeze take turns: `acts` holds the share of turns the body still moves on, turn by turn after the
 * landing; the halved Speed of a paralysis is not priced.
 */
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
