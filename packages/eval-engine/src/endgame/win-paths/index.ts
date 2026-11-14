import { WinMeter } from './budget.ts';
import { luckPath } from './luck.ts';
import { strongerStep } from './stronger.ts';
import type { WinPaths, WinPathsRequest, WinStep } from './types.ts';

/**
 * Round 89 (#130, G8a): the on-demand job. `winPaths` runs the steps in the order the user ruled (a stronger play, luck, a mistake by the
 * opponent), each with a meter of its own (one budget per step, so a step that stops at its cap never takes the next one's work), and
 * reports each step the moment it is done. It runs only when the app asks, never in a sweep, and it reads the serialized position and
 * writes nothing into any result.
 *
 * A step that throws is a `failed` step with the message and the others still run. The third step waits for a user answer (gate
 * question 3): its runner answers `unbuilt` until `mistakeStep` replaces it (G7b).
 */
export interface WinStepRunner {
  kind: WinStep['kind'];
  run(serialized: string, request: WinPathsRequest, meter: WinMeter): WinStep;
}

/** The seam of step 3: no search, nothing to show. G7b replaces this runner with `mistakeStep`. */
const unbuiltStep = (kind: WinStep['kind']): WinStep => ({ kind, status: 'unbuilt', spent: { cells: 0, turns: 0 } });

export const WIN_STEPS: readonly WinStepRunner[] = [
  { kind: 'stronger', run: strongerStep },
  { kind: 'luck', run: luckPath },
  { kind: 'mistake', run: () => unbuiltStep('mistake') },
];

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

export { LUCK_FLOOR, WIN_BUDGET, WinMeter } from './budget.ts';
export type { WinBudget, WinPaths, WinPathsRequest, WinStep } from './types.ts';
