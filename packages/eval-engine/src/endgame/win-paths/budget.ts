import type { WinBudget } from './types.ts';

/**
 * Round 89 (#130, D3): the work counter of a win-path step. Counted, never timed: a step answers the same on every machine and in
 * every spec. `cells` are the matrix cells the engine's first choice prices, `turns` the simulator turns the dice search plays on
 * copies (a turn with its dice read is one, each play of a damage roll's bisection is one). The caps are set by the budget probe of G8a
 * (54 lost endgames of the corpus and the five scenes, singles, Champions OU, Doubles OU, VGC and Champions VGC apart; devbox, the PC
 * is 2.5 to 3 times faster): a unit costs 18 to 52 ms (typically 25 to 35), so a step that runs into a cap takes about 10 to 20 s on
 * devbox, about 4 to 7 s on the PC. Inside the cap finish: stronger 100 % of singles, Champions OU, Doubles OU and VGC and 91 % of
 * Champions VGC; luck 92 % of singles, 90 % of Champions OU, 90 % of Doubles OU, 100 % of VGC and Champions VGC (bars: 90 % singles,
 * 70 % doubles). The one Doubles OU position that ran away (2,200 cells, 1,224 turns, 138 s under the 4 x probe cap) now stops.
 */
export const WIN_BUDGET: WinBudget = { cells: 350, turns: 175 };

/** The default chance below which the luck search stops (gate question 4a, 1 in 1,000; the question is open at the user). */
export const LUCK_FLOOR = 0.001;

export class WinMeter {
  cells = 0;
  turns = 0;
  readonly cap: WinBudget;

  constructor(cap: Partial<WinBudget> = {}) {
    this.cap = { ...WIN_BUDGET, ...cap };
  }

  /** True once either count has reached its cap. */
  get exhausted(): boolean {
    return this.cells >= this.cap.cells || this.turns >= this.cap.turns;
  }

  get spent(): { cells: number; turns: number } {
    return { cells: this.cells, turns: this.turns };
  }
}
