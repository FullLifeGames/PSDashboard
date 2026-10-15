import type { HitCost } from './contact-cost.ts';

/**
 * How the cost of one hit (score/contact.ts) enters a race of boostsBiting (13.10.2026, the Swords Dance report on
 * gen9draft-2058494320). The races of score/races.ts know a loss per turn and an HP, so the cost comes as three
 * numbers for the side that pays (the attacker of the hit): HP lost per turn on top of its residual, the share of its
 * damage it still deals, and an HP buffer.
 *
 * The chip of a hit is paid right after the hit, and it is paid for every hit, the one that wins the race included. The
 * side that moves first has paid t chips when the other side lands its t-th hit; the side that moves second has paid t - 1,
 * because the other side's hit comes before its own. A residual of the chip per turn counts t of them in the clock of
 * the other side; the second mover gets the missing one back as a buffer of one chip of HP, which makes the clock
 * exactly ceil((HP + chip) / (hit + chip)), the turn of the first hit for which t hits and t - 1 chips KO it. The chip
 * of the hit that finishes the race comes after the KO and decides nothing (a Brave Bird that KOs does not lose the race
 * to its own recoil; a second mover that KOs in one hit is not KO'd by a chip it has not paid yet), and a recoil that
 * KOs its user after the hit that did not finish the foe is the KO of that user a turn early, which the buffer shows
 * as the same verdict.
 *
 * A status chance compounds over the hits. With q the chance that some status lands on one hit, the first one to land
 * stays (the simulator gives a second status to nobody), so the chance that it lands on hit j is (1 - q)^(j - 1) q and
 * its share among the statuses follows from their chances. A status that lands on hit j takes its chip at the end of
 * the turns j to the turn before the other side's last hit, and the hits after j deal its share of the damage: a burn
 * halves a physical hit, a Guts body deals more, a Poison Heal body gains HP. Hit j itself is dealt before the status it
 * may leave. The expected chip is spread over the turns of the race, the expected damage over the hits the side lands.
 * Paralysis, sleep and freeze take turns instead of HP and damage, and are not priced here (the reader tells their
 * chance; the races have no turn to give).
 */

/** What a hit's cost adds to a side of a race. */
export interface HitPrice {
  /** HP lost per turn on top of the side's residual. */
  residual: number;
  /** The share of its damage the side still deals. */
  output: number;
  /** HP the side is worth more in the clock of the other side: one chip for the side that moves second. */
  buffer: number;
}

/** The longest race priced: a race that never ends, or runs longer, is priced over this many hits. */
export const MAX_PRICED_HITS = 8;

const FREE: HitPrice = { residual: 0, output: 1, buffer: 0 };

/** A clock as a number of hits to price: whole hits, at least one, at most the longest race priced (a clock that never ends is the longest). */
const horizon = (clock: number): number => Math.min(Math.max(1, Math.floor(clock)), MAX_PRICED_HITS);

/**
 * The price of the hits of one side that cost `cost`. `own` is the side's clock on the other (the hits it lands to win),
 * `other` the other side's clock on it (the turns it has to live), `ownFirst` whether it moves first.
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
      output += probability * (entry.output - 1) * Math.max(0, landing - at);
      chips += probability * entry.chip * Math.max(0, turns - at);
    }
  }
  return { residual: cost.chip + chips / turns, output: output / landing, buffer: ownFirst ? 0 : cost.chip };
}
