import { winPaths } from './endgame/win-paths/index.ts';
import type { WinPaths, WinPathsRequest, WinStep } from './endgame/win-paths/types.ts';
import type { StaticRuleset } from './score/weights.ts';

// Worker messages are internal, so a new job kind keeps ENGINE_PROTOCOL; no job writes into an EvalResult.
/** A job the app starts on request: it runs on its own worker, streams steps, and is stopped by ending the worker. */
export type OnRequestJob = { kind: 'winPaths'; request: WinPathsRequest };
export type OnRequestStep = { kind: 'winPaths'; step: WinStep };
export type OnRequestResult = { kind: 'winPaths'; paths: WinPaths };

export function runOnRequestJob(
  serialized: string,
  ruleset: StaticRuleset,
  job: OnRequestJob,
  onStep: (step: OnRequestStep) => void,
): OnRequestResult {
  const paths = winPaths(serialized, { ...job.request, ruleset }, step => onStep({ kind: job.kind, step }));
  return { kind: job.kind, paths };
}
