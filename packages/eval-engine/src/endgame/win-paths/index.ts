import { WinMeter } from './budget.ts';
import { luckPath } from './luck.ts';
import { mistakeStep } from './mistake.ts';
import { strongerStep } from './stronger.ts';
import type { WinPaths, WinPathsRequest, WinStep } from './types.ts';

/**
 * The on-demand job: the steps run in order (a stronger play, luck, a mistake by the opponent), each with a meter of its own so a step
 * that stops at its cap never takes the next one's work, and each is reported the moment it is done. A step that throws is a `failed`
 * step with the message and the others still run.
 */
export interface WinStepRunner {
  kind: WinStep['kind'];
  run(serialized: string, request: WinPathsRequest, meter: WinMeter): WinStep;
}

export const WIN_STEPS: readonly WinStepRunner[] = [
  { kind: 'stronger', run: strongerStep },
  { kind: 'luck', run: luckPath },
  { kind: 'mistake', run: mistakeStep },
];

/** Runs the win-path steps for a lost endgame; it runs only when the app asks (never in a sweep) and reads the serialized position without writing into any result. */
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
