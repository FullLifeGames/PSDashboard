import { winPaths } from './endgame/win-paths/index.ts';
import type { WinPaths, WinPathsRequest, WinStep } from './endgame/win-paths/types.ts';
import type { StaticRuleset } from './score/weights.ts';

/**
 * Round 89 (#130, G8a): the jobs the app starts on request and the worker answers one step at a time. A job is never part of a sweep:
 * it runs on a worker of its own, streams a step each time one is done, ends with the whole result, and the client can stop it by
 * ending that worker. The message is generic on purpose: "search this row on request" (#104's open question) adds a `kind` here and a
 * runner below, not a message. The worker's message types: `job` (request), `jobStep` (stream) and `jobResult` (final).
 *
 * Worker messages are internal, so a new kind keeps `ENGINE_PROTOCOL`; no job writes into an `EvalResult`.
 */
export type OnRequestJob = { kind: 'winPaths'; request: WinPathsRequest };
export type OnRequestStep = { kind: 'winPaths'; step: WinStep };
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
