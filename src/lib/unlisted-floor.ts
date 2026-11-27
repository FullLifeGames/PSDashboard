import type { EvalResult, RankedChoice } from '@fulllifegames/eval-engine';

type Side = 'p1' | 'p2';

export function floorReplyUnlisted(result: EvalResult, side: Side, row: Pick<RankedChoice, 'punishedBy'>): boolean {
  const matrix = result.matrix;
  if (!matrix || !row.punishedBy) return false;
  return !(side === 'p1' ? matrix.p2Labels : matrix.p1Labels).includes(row.punishedBy);
}

export function unlistedFloors(result: EvalResult): { side: Side; row: RankedChoice }[] {
  return (['p1', 'p2'] as const).flatMap(side =>
    result.perSide[side].filter(row => floorReplyUnlisted(result, side, row)).map(row => ({ side, row })));
}
