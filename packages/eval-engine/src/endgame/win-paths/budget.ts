import type { WinBudget } from './types.ts';

// The work counter of a win-path step, counted and never timed, so a step answers the same on every machine.
// `cells`: matrix cells the first choice prices; `turns`: simulator turns the dice search plays on copies.
export const WIN_BUDGET: WinBudget = { cells: 350, turns: 175 };

export const LUCK_FLOOR = 0.001;

export class WinMeter {
  cells = 0;
  turns = 0;
  readonly cap: WinBudget;

  constructor(cap: Partial<WinBudget> = {}) {
    this.cap = { ...WIN_BUDGET, ...cap };
  }

  get exhausted(): boolean {
    return this.cells >= this.cap.cells || this.turns >= this.cap.turns;
  }

  get spent(): { cells: number; turns: number } {
    return { cells: this.cells, turns: this.turns };
  }
}
