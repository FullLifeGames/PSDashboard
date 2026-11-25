/** Mirrors the hit loop of battle-actions hitStepMoveHitLoop (no handler to ask); test/damage-calc.spec.ts holds it. */
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
