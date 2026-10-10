/**
 * The hit counts the simulator's hit loop draws for one use of a multi-hit
 * move (battle-actions hitStepMoveHitLoop), as the array it samples from.
 * Its rules live inline there, with no handler to ask, so they are mirrored
 * here once (round 67, T100): the static prices their mean
 * (score/move-facts.ts), the preview each count with its share
 * (damage-calc.ts). test/multi-hit.spec.ts and
 * test/damage-calc-hit-counts.spec.ts hold them against the simulator's own
 * draws: 2 to 5 hits sample 2/2/2/2/2/2/2/3/3/3/3/3/3/3/4/4/4/5/5/5 from
 * gen 5 on and 2/2/2/3/3/3/4/5 before; from gen 5 on Loaded Dice turns a
 * count under 4 into 4 or 5, and it turns ten hits into 4 to 10; any other
 * range draws each count alike. `multihit` is the count after the user's
 * ability reshaped it (Skill Link takes the top).
 */
export function hitDraws(gen: number, multihit: number | number[], holdsLoadedDice: boolean): number[] {
  if (typeof multihit === 'number') return multihit === 10 && holdsLoadedDice ? range(4, 10) : [multihit];
  const [low, high] = multihit;
  if (low !== 2 || high !== 5) return range(low, high);
  if (gen < 5) return [2, 2, 2, 3, 3, 3, 4, 5];
  const drawn = [2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5];
  return holdsLoadedDice ? drawn.flatMap(hits => (hits < 4 ? [4, 5] : [hits, hits])) : drawn;
}

function range(low: number, high: number): number[] {
  return Array.from({ length: high - low + 1 }, (_, index) => low + index);
}
