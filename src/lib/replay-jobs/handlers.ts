import {
  buildChoiceLockContext, reconstructBranchRuntime, reconstructionReached, serializeLiveBattle, validateBranchRuntime,
} from '@fulllifegames/eval-engine';
import { solveReplaySpreads } from '@fulllifegames/replay-core';
import { snapshotAt } from '../eval-acquire';
import { loadReplayMods } from '../replay-mods';
import { replaySolveOptions } from '../team-build-options';
import type { ReconstructJob, ReconstructOutcome, ReplayJobRequest, ReplayJobResponse } from './types';

export type ReplayPost = (message: ReplayJobResponse) => void;

/** Progress messages per job at most this often — a block runs in milliseconds. */
const PROGRESS_INTERVAL_MS = 100;

/**
 * The worker side of the replay jobs. Pure functions of their message: the
 * same code the main thread ran, so a reconstruction here yields the same
 * positions byte for byte (pinned by test/regression/replay-jobs.spec.ts).
 */
export async function handleReplayJob(message: ReplayJobRequest, post: ReplayPost): Promise<void> {
  try {
    // Round 75 (T160): this worker is its own realm (its own simulator), and the main thread's load of the Champions mod does not
    // reach it. Both jobs read the game's Dex from the log's tier line (the solve builds the sets, the reconstruction builds the
    // choice-lock context) before the branch engine would load the mod, so the job loads it first.
    await loadReplayMods(message.type === 'solveSpreads' ? { log: message.job.log } : { format: message.job.format, log: message.job.replayLog });
    if (message.type === 'solveSpreads') {
      const { job } = message;
      const solved = solveReplaySpreads(job.log, job.observations, replaySolveOptions(job));
      post({ type: 'solveSpreadsResult', id: message.id, entries: [...solved.entries()] });
      return;
    }
    post({ type: 'reconstructResult', id: message.id, outcome: await reconstruct(message.job, message.id, post) });
  } catch (error) {
    post({ type: 'replayError', id: message.id, message: error instanceof Error ? error.message : String(error) });
  }
}

/** One reconstruction: the protocol replay (healed, locked, captured) or the fresh lead game. */
async function reconstruct(job: ReconstructJob, id: number, post: ReplayPost): Promise<ReconstructOutcome> {
  const lead = job.mode === 'lead';
  const snapshotFor = (turn: number) => snapshotAt(job.snapshots, turn);
  let progressAt = 0;
  const runtime = await reconstructBranchRuntime({
    format: job.format,
    p1Team: job.p1Team,
    p2Team: job.p2Team,
    replayLog: job.replayLog,
    targetTurn: job.targetTurn,
    snapshot: lead ? null : snapshotFor(job.targetTurn),
    playerNames: job.playerNames,
    onProgress: (turn, target) => {
      const now = Date.now();
      if (now - progressAt < PROGRESS_INTERVAL_MS) return;
      progressAt = now;
      post({ type: 'replayProgress', id, turn, target });
    },
    choiceLocks: lead
      ? undefined
      : buildChoiceLockContext(job.replayLog, { p1Team: job.p1Team, p2Team: job.p2Team }, job.observations),
    bringOnly: job.bringOnly ?? undefined,
    leadOverride: job.leadOverride,
    deadlineMs: job.deadlineMs,
    ...(lead ? {} : {
      capturePositions: {
        snapshotFor,
        onPosition: (turn, battle) => {
          try {
            post({ type: 'replayPosition', id, turn, serialized: serializeLiveBattle(battle) });
          } catch {
            // A broken boundary is a gap for the caller, never a failed job.
          }
        },
      },
    }),
  });
  const battle = runtime.battleStream.battle;
  let serialized: string | null = null;
  if (battle) {
    try {
      serialized = serializeLiveBattle(battle);
    } catch {
      serialized = null;
    }
  }
  return {
    serialized,
    log: runtime.log,
    invalid: validateBranchRuntime(runtime),
    reached: reconstructionReached(runtime, job.targetTurn),
    ended: !!battle?.ended,
    turn: battle?.turn ?? 0,
    timedOut: runtime.timedOut,
    haxAlignment: runtime.haxAlignment,
    choiceErrors: { count: runtime.choiceErrors.count, last: runtime.choiceErrors.last },
  };
}
