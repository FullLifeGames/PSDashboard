---
Status: accepted (round 89, #130)
---

# On-request jobs run on a worker of their own and stay outside the engine protocol

The win-path search of a lost endgame ("How could <player> have won?", #130) is the first work the app does only when the user asks. It reads one position, runs up to three steps (a stronger play, luck, a mistake by the opponent) and takes seconds: a step that reaches its cap costs 10 to 20 s on devbox and 4 to 7 s on the PC (`WIN_BUDGET`, `endgame/win-paths/budget.ts`). The app already runs searches in workers that a cancel ends by termination (ADR 0011), and `EvalWorkerRequest` messages are internal, so the protocol an external engine answers (`ps-dashboard-engine/1`, ENGINES.md) covers the ranking of a position and nothing else (ADR 0014 names the versioned formats). The job had to find a place among them.

## Decision

1. **One generic message.** The eval worker answers a `job` message that names a kind (`OnRequestJob`, `packages/eval-engine/src/on-request.ts`). It streams a `jobStep` for each step the moment it ends and closes with a `jobResult`; `runOnRequestJob` runs the kind on the serialized position under the rule set the message names. Today the only kind is `winPaths`. Another search on request adds a kind and a runner, not a message.
2. **A worker of its own for each job.** `OnRequestJobs` (`src/lib/eval/on-request-jobs.ts`, behind `EvalWorkerClient.winPaths`) spawns a worker per job (`spawnWorker`, `src/lib/eval/worker-handle.ts`) and ends it when the job finishes, fails or is cancelled. The job never takes a worker of the evaluation pool. A sweep's search never waits for it, a sweep's `cancel` never ends it, and the job's `AbortSignal` ends only its own worker. `dispose` ends every running job.
3. **Outside the engine protocol.** No external engine receives or sends the job, so `ENGINE_PROTOCOL` keeps its value and `ENGINES.md` says the protocol does not carry it. The job reads the position and writes into no `EvalResult`, so no stored result, cache key or share link changes.
4. **The budget is counted, never timed.** A step stops at a cap of matrix cells (`cells`) or simulator turns (`turns`), each step with a meter of its own, so a step answers the same on every machine and in every spec. A step that throws reports `failed` with its message, and the other steps still run.
5. **A memo of finished answers.** `OnRequestJobs` keeps the newest 16 finished answers by rule set, serialized position and request and replays their steps at once on the same question. A failed or cancelled job keeps nothing.

## Considered options

- A worker of the evaluation pool: a pool worker stays busy until its search ends, so the job would queue behind a sweep's search, and terminating a busy worker to cancel the job (the pool's way, ADR 0011) would end a sweep's search with it.
- A wall-clock limit ("stops after 5 s"): the same position would answer differently on devbox, on the PC and in a spec. A worker can add a clock on top later; the panel would then say "Stopped after 5 s".
- A new request kind in the engine protocol: it would oblige every external engine to implement a search that rests on the dashboard's own prover and dice search, for a feature no ranking needs.
- Results kept in the evaluation cache or in `EvalResult`: they would make a score-neutral job part of the cache key and of what a stored result holds. The job stays read-only.

## Consequences

`winPaths` (`endgame/win-paths/index.ts`) runs the steps in their ruled order and reports each through `onStep`; the barrel exports `winPaths`, `WIN_BUDGET`, `runOnRequestJob` and their types. `useWinPaths` (`src/hooks/useWinPaths.ts`) is the only caller, keeps one search at a time, and aborts on close, on another turn, on another replay and on unmount. The analysis of a game costs the same as before, since no sweep path calls the job.

The worker's messages are internal, so a new kind keeps the protocol version. A change that makes an external engine read or answer a job would raise `ENGINE_PROTOCOL` and need its own ADR. Specs: `packages/eval-engine/test/win-paths-job.spec.ts` (order, a meter for each step, a failing step, a search result equal with and without a job between two runs) `test/ui/lib/worker-client-winpaths.spec.ts` (a job beside a sweep's pending search, each side's cancel leaving the other, an aborted signal, the memo) and `test/regression/win-paths-never-in-sweep.spec.ts` (no sweep path calls the job).
