import type { Battle } from '@pkmn/sim';
import { positionBattle, type SimPosition } from '../forward-model.ts';
import { BOUNDARY_DRAW_BUDGET, type CellEvent } from '../cell-blend.ts';
import { SEARCH_SEEDS } from '../search/leaf.ts';
import { classChildren, drawChild, median, totalHp, type Draw } from '../search/outcome-children.ts';

/**
 * One matrix cell's children for the endgame solver (round 34): chance
 * priced as outcome classes with analytic weights, one representative
 * child per class, and a plain median child where no class plan exists.
 * Round 43: the class path lives in search/outcome-children.ts and draws
 * a class the base seeds never showed on demand (scripted dice) instead
 * of chasing it with probe seeds; `missing` now means the sim refused the
 * class (calc/sim disagreement) or the forced cap was reached. Round 35:
 * `share` keeps the analytic weight for the prover, `plain` marks the
 * median path.
 */
interface EndgameChild {
  position: SimPosition;
  /** Weight normalized over the drawn classes (the solver's blend). */
  weight: number;
  /** Analytic class weight before that normalization (the prover's mass); 1 on the plain path. */
  share: number;
  ended: boolean;
  /** Group key `${order}:${classKey}` on the class path; absent on the plain path. */
  key?: string;
}
export interface EndgameChildren {
  children: EndgameChild[];
  unpriced: boolean;
  /** True when the plain (median) path ran. */
  plain: boolean;
  /** Plain path only: the draws disagreed on damage, faints, or the end (chance moved the cell). */
  spread: boolean;
  /** Class path: the expected classes no draw showed, with their analytic share (round 35: the prover inherits proofs across dominated classes). */
  missing: { key: string; share: number }[];
  /** Class path: the cell's priced events, in the order the class keys join their outcomes. */
  events: CellEvent[];
}

const PLAIN_DRAWS = 3;

/** Whether either choice names a damaging move (base power, fixed damage, or OHKO). */
function damagingPair(battle: Battle, p1Choice: string, p2Choice: string): boolean {
  return [p1Choice, p2Choice].some(choice => choice.split(',').some(part => {
    const tokens = part.trim().split(' ');
    if (tokens[0] !== 'move') return false;
    const move = battle.dex.moves.get(tokens[1]);
    return move.exists && (move.basePower > 0 || Boolean(move.damage) || Boolean(move.ohko));
  }));
}

/** The plain path: the median of three draws for damaging pairs, one draw otherwise. */
function plainChildren(root: SimPosition, battle: Battle, rootHp: number, p1Choice: string, p2Choice: string): EndgameChildren {
  const count = damagingPair(battle, p1Choice, p2Choice) ? PLAIN_DRAWS : 1;
  const draws: Draw[] = SEARCH_SEEDS.slice(0, count).map(seed => drawChild(root, rootHp, p1Choice, p2Choice, seed));
  const pick = median(draws);
  const unpriced = draws.some(draw => draw.fainted !== draws[0].fainted || draw.ended !== draws[0].ended);
  const spread = unpriced || draws.some(draw => draw.measure !== draws[0].measure);
  return { children: [{ position: pick.position, weight: 1, share: 1, ended: pick.ended }], unpriced, plain: true, spread, missing: [], events: [] };
}

/**
 * `drawBudget` caps the forced draws a class cell may take for classes the
 * base seeds never showed (the root blend's BOUNDARY_DRAW_BUDGET by
 * default; the prover passes less and leaves rare classes open).
 */
export function endgameChildren(root: SimPosition, p1Choice: string, p2Choice: string, drawBudget = BOUNDARY_DRAW_BUDGET): EndgameChildren {
  const battle = positionBattle(root);
  const classes = classChildren(root, p1Choice, p2Choice, { baseSeeds: SEARCH_SEEDS, forcedCap: drawBudget });
  if (classes) {
    const children = classes.children.map(child => ({ position: child.position, weight: child.weight, share: child.share, ended: child.ended, key: child.key }));
    return { children, unpriced: classes.missing.length > 0, plain: false, spread: false, missing: classes.missing, events: classes.events };
  }
  return plainChildren(root, battle, totalHp(battle), p1Choice, p2Choice);
}
