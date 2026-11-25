import { positionBattle, type ChoiceOption, type SimPosition } from '../../forward-model.ts';
import type { TeraAllowance } from '../../types.ts';
import type { StaticRuleset } from '../../score/weights.ts';
import { endgameKey } from '../key.ts';
import { oneTurnMatrix } from '../solver.ts';
import type { WinMeter } from './budget.ts';

// The engine's first choice past a win-path search's root: the best row of the one-turn matrix, memoized per position.
/** An option with its value against the other side's mix, from the side's own view (-1 to 1). */
export interface RankedOption { option: ChoiceOption; value: number }
export interface FirstChoices { p1: ChoiceOption; p2: ChoiceOption; ranked: { p1: RankedOption[]; p2: RankedOption[] } }

export interface FirstChoiceOptions { tera?: TeraAllowance; sleepClause?: boolean; ruleset?: StaticRuleset }

const byValue = (a: RankedOption, b: RankedOption): number => b.value - a.value;

/** The endgame key plus the requests the sides are in: a replacement is no boundary. */
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
