export interface StatusCost {
  /** The status id the simulator gives (`brn`, `par`, ...), or `item:<id>` for an item the foe's hit passed on. */
  status: string;
  chance: number;
  /** Per turn, as a share of the attacker's max HP: the end of the turn played with it, minus without. */
  chip: number;
  /** Share of its damage the attacker's move still deals while it carries it (a burn halves a physical move: 0.5). */
  output: number;
  acts?: readonly number[];
}

/** The longest race priced, in hits and in turns: the profile of `acts` runs over as many turns. */
export const MAX_PRICED_HITS = 8;

export interface HitCost {
  /** The share of the attacker's max HP the hit takes: the foe's item and ability, the move's recoil, its own item. */
  chip: number;
  statuses: readonly StatusCost[];
}

export const NO_COST: HitCost = { chip: 0, statuses: [] };
