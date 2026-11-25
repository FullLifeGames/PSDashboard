import { winPaths } from './endgame/win-paths/index.ts';
import type { WinPaths, WinPathsRequest, WinStep } from './endgame/win-paths/types.ts';
import type { StaticRuleset } from './score/weights.ts';

// Worker messages are internal, so a new job kind keeps ENGINE_PROTOCOL; no job writes into an EvalResult.
/** A job the app starts on request: it runs on its own worker, streams steps, and is stopped by ending the worker. */
export type OnRequestJob = { kind: 'winPaths'; request: WinPathsRequest };
/** One streamed step of a job. */
export type OnRequestStep = { kind: 'winPaths'; step: WinStep };
/** The whole result a job ends with. */
export type OnRequestResult = { kind: 'winPaths'; paths: WinPaths };

/** Runs a job on the serialized position under the rule set the message names; `onStep` fires as each step is done. */
export function runOnRequestJob(
  serialized: string,
  ruleset: StaticRuleset,
  job: OnRequestJob,
  onStep: (step: OnRequestStep) => void,
): OnRequestResult {
  const paths = winPaths(serialized, { ...job.request, ruleset }, step => onStep({ kind: job.kind, step }));
  return { kind: job.kind, paths };
}
