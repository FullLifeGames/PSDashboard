import type { WinBudget } from './types.ts';

// The work counter of a win-path step, counted and never timed, so a step answers the same on every machine. `cells` are the matrix
// cells the engine's first choice prices, `turns` the simulator turns the dice search plays on copies (a turn with its dice read is one,
// each play of a damage roll's bisection is one). A unit costs 18 to 52 ms on devbox, so a step that runs into a cap takes 10 to 20 s.
/** The default caps of a win-path step. */
export const WIN_BUDGET: WinBudget = { cells: 350, turns: 175 };

/** The default chance below which the luck search stops (1 in 1,000). */
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
