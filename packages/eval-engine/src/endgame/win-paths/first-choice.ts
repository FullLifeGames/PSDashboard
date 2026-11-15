import { createRootPosition, positionBattle, type ChoiceOption, type SimPosition } from '../../forward-model.ts';
import type { TeraAllowance } from '../../types.ts';
import type { WinPathsRequest } from './types.ts';
import type { StaticRuleset } from '../../score/weights.ts';
import { endgameKey } from '../key.ts';
import { oneTurnMatrix } from '../solver.ts';
import type { WinMeter } from './budget.ts';

/**
 * Round 89 (#130, D1): the engine's first choice past the root of a win-path search. The turn the card shows has its own ranking
 * (the request's `first`); at every later position both sides take the best row of the one-turn matrix (`oneTurnMatrix`: each pair
 * of options played once, each child at its static value): a side's best row is the one with the highest value against the other
 * side's equilibrium mix. A depth-1 search per position would cost seconds (the play-out engine, G5 section 2); the matrix costs one
 * cell per pair of options, counted in the step's meter. Memoized per position, so a position the search reaches twice pays once.
 *
 * Singles and doubles share this path: a doubles side's options are the search's own (`searchOptions`, the hint-restricted list), a
 * position that asks one side for a replacement offers the other side `wait`.
 */
export interface RankedOption { option: ChoiceOption; /** The value against the other side's mix, from the side's own view (-1 to 1). */ value: number }
export interface FirstChoices { p1: ChoiceOption; p2: ChoiceOption; ranked: { p1: RankedOption[]; p2: RankedOption[] } }

export interface FirstChoiceOptions { tera?: TeraAllowance; sleepClause?: boolean; ruleset?: StaticRuleset }

const byValue = (a: RankedOption, b: RankedOption): number => b.value - a.value;

/** The key of a position for this module: the endgame key and the requests the sides are in (a replacement is no boundary). */
export function positionKey(position: SimPosition): string {
  const battle = positionBattle(position);
  return `${battle.sides.slice(0, 2).map(side => side.requestState).join('/')}|${endgameKey(battle)}`;
}

export class FirstChoice {
  private readonly memo = new Map<string, FirstChoices | null>();
  private readonly meter: WinMeter;
  private readonly options: FirstChoiceOptions;

  constructor(meter: WinMeter, options: FirstChoiceOptions) {
    this.meter = meter;
    this.options = options;
  }

  /** Both sides' first choices at the position, null when the game is over or a side has no option. */
  at(position: SimPosition): FirstChoices | null {
    const key = positionKey(position);
    if (this.memo.has(key)) return this.memo.get(key) ?? null;
    const matrix = oneTurnMatrix(position, this.options);
    this.meter.cells += matrix?.cells ?? 0;
    let result: FirstChoices | null = null;
    if (matrix) {
      const own = matrix.p1.map((option, row) => ({ option, value: matrix.p2Mix.reduce((sum, weight, col) => sum + weight * matrix.values[row][col], 0) })).sort(byValue);
      const foe = matrix.p2.map((option, col) => ({ option, value: -matrix.p1Mix.reduce((sum, weight, row) => sum + weight * matrix.values[row][col], 0) })).sort(byValue);
      result = { p1: own[0].option, p2: foe[0].option, ranked: { p1: own, p2: foe } };
    }
    this.memo.set(key, result);
    return result;
  }
}

/** The root position of a request (the serialized battle at the start of the turn). */
export function rootOf(serialized: string, request: Pick<WinPathsRequest, 'ruleset'>): SimPosition {
  return createRootPosition(serialized, request.ruleset);
}
