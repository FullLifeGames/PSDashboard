import type { WinBudget } from './types.ts';

/**
 * Round 89 (#130, D3): the work counter of a win-path step. Counted, never timed: a step answers the same on every machine and in
 * every spec. `cells` are the matrix cells the engine's first choice prices, `turns` the simulator turns the dice search plays on
 * copies (a turn with its dice read is one, each play of a damage roll's bisection is one). The caps are a parameter: the budget probe
 * of G8a sets `WIN_BUDGET` so a step takes about 5 s on the PC; until then the numbers below are the probe's starting point
 * (G5 measured 10 to 26 ms a cell on devbox).
 */
export const WIN_BUDGET: WinBudget = { cells: 600, turns: 400 };

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
