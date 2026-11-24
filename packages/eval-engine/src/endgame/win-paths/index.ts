import { WinMeter } from './budget.ts';
import { luckPath } from './luck.ts';
import { mistakeStep } from './mistake.ts';
import { strongerStep } from './stronger.ts';
import type { WinPaths, WinPathsRequest, WinStep } from './types.ts';

/** The on-demand job: each step has its own meter; a step that throws is a `failed` step and the others still run. */
export interface WinStepRunner {
  kind: WinStep['kind'];
  run(serialized: string, request: WinPathsRequest, meter: WinMeter): WinStep;
}

export const WIN_STEPS: readonly WinStepRunner[] = [
  { kind: 'stronger', run: strongerStep },
  { kind: 'luck', run: luckPath },
  { kind: 'mistake', run: mistakeStep },
];

/** Runs the win-path steps for a lost endgame; only when the app asks, never in a sweep, and writes into no result. */
export function winPaths(
  serialized: string,
  request: WinPathsRequest,
  onStep?: (step: WinStep) => void,
  runners: readonly WinStepRunner[] = WIN_STEPS,
): WinPaths {
  const steps: WinStep[] = [];
  for (const runner of runners) {
    const meter = new WinMeter(request.budget);
    let step: WinStep;
    try {
      step = runner.run(serialized, request, meter);
    } catch (error) {
      step = { kind: runner.kind, status: 'failed', error: error instanceof Error ? error.message : String(error), spent: meter.spent };
    }
    steps.push(step);
    onStep?.(step);
  }
  return { side: request.side, turn: request.turn ?? 0, steps };
}

export { WIN_BUDGET, WinMeter } from './budget.ts';
export type { WinBudget, WinPaths, WinPathsRequest, WinStep } from './types.ts';
