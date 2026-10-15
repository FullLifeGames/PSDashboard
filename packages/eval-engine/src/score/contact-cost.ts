/**
 * What one hit of a move costs its attacker (13.10.2026, the contact punishments of boostsBiting): the reading
 * score/contact.ts answers and score/contact-price.ts prices into a race. Kept apart from the reader so that the
 * player of the hit and the pricing share the shape without importing each other.
 */

/** One status (or an item taken over) that a hit can leave on the attacker. */
export interface StatusCost {
  /** The status id the simulator gives (`brn`, `par`, `psn`, `slp`, ...), or `item:<id>` for an item the foe's hit passed on. */
  status: string;
  /** The chance per hit that the hit leaves it, from the played dice. */
  chance: number;
  /** The HP it takes per turn, as a share of the attacker's max HP: the end of the turn played with it, minus without. */
  chip: number;
  /** The share of its damage the attacker's move still deals while it carries it (a burn halves a physical move: 0.5). */
  output: number;
}

/** What one hit costs the attacker. */
export interface HitCost {
  /** The HP the hit takes, as a share of the attacker's max HP: the foe's item and ability, the move's recoil, the attacker's own item. */
  chip: number;
  /** The statuses the hit can leave, each with its chance. */
  statuses: readonly StatusCost[];
}

export const NO_COST: HitCost = { chip: 0, statuses: [] };
