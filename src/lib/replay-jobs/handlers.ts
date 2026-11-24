import {
  buildChoiceLockContext, reconstructBranchRuntime, reconstructionReached, rolledCopy, serializeLiveBattle, validateBranchRuntime,
  type ReconstructParams,
} from '@fulllifegames/eval-engine';
import { solveReplaySpreads, type TurnSnapshot } from '@fulllifegames/replay-core';
import { snapshotAt } from '../eval-acquire';
import { loadReplayMods } from '../replay-mods';
import { replaySolveOptions } from '../team-build-options';
import type { ReconstructJob, ReconstructOutcome, ReplayJobRequest, ReplayJobResponse, RolledCopyJob, RolledCopyOutcome } from './types';

export type ReplayPost = (message: ReplayJobResponse) => void;

const PROGRESS_INTERVAL_MS = 100;

export async function handleReplayJob(message: ReplayJobRequest, post: ReplayPost): Promise<void> {
  try {
    // Its own realm: the main thread's Champions mod load does not reach this worker, so the job loads it first.
    await loadReplayMods(message.type === 'solveSpreads' ? { log: message.job.log } : { format: message.job.format, log: message.job.replayLog });
    if (message.type === 'solveSpreads') {
      const { job } = message;
      const solved = solveReplaySpreads(job.log, job.observations, replaySolveOptions(job));
      post({ type: 'solveSpreadsResult', id: message.id, entries: [...solved.entries()] });
      return;
    }
    if (message.type === 'rolledCopy') {
      post({ type: 'rolledCopyResult', id: message.id, outcome: playRolledCopy(message.job) });
      return;
    }
    post({ type: 'reconstructResult', id: message.id, outcome: await reconstruct(message.job, message.id, post) });
  } catch (error) {
    post({ type: 'replayError', id: message.id, message: error instanceof Error ? error.message : String(error) });
  }
}

function playRolledCopy(job: RolledCopyJob): RolledCopyOutcome | null {
  const copy = rolledCopy({ position: job.position, replayLog: job.replayLog, turn: job.turn, roll: job.roll });
  return copy ? { serialized: copy.serialized, stage: copy.stage, terminal: copy.terminal } : null;
}

function capturePositionsFor(
  job: ReconstructJob, id: number, post: ReplayPost, snapshotFor: (turn: number) => TurnSnapshot | null,
): NonNullable<ReconstructParams['capturePositions']> {
  return {
    snapshotFor,
    onPosition: (turn, battle) => {
      try {
        post({ type: 'replayPosition', id, turn, serialized: serializeLiveBattle(battle) });
      } catch {
        // A gap for the caller.
      }
    },
    ...(job.replacements ? {
      onReplacement: (point, battle) => {
        try {
          post({ type: 'replayReplacement', id, point, serialized: serializeLiveBattle(battle) });
        } catch {
          // A gap for the caller.
        }
      },
    } : {}),
  };
}

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
    ...(job.seed ? { seed: job.seed } : {}),
    deadlineMs: job.deadlineMs,
    ...(lead ? {} : { capturePositions: capturePositionsFor(job, id, post, snapshotFor) }),
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
