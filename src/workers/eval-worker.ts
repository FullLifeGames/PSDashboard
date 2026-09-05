/// <reference lib="webworker" />
import {
  mctsSearch, mctsTreeSearch, type SearchExecutor, createLocalExecutor, searchPosition, type EvalWorkerRequest,
  type EvalWorkerResponse,
} from '@fulllifegames/eval-engine';
import { isReplayJob, type ReplayJobRequest, type ReplayJobResponse } from '../lib/replay-jobs/types';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: EvalWorkerResponse) => scope.postMessage(message);
const postReplay = (message: ReplayJobResponse) => scope.postMessage(message);
/** MCTS iterations between two progress messages. */
const PROGRESS_EVERY = 10;

// One executor (with its matchup cache and lazily deserialized root) is
// reused across every message about the same position.
const executors = new Map<string, SearchExecutor>();

function executorFor(serializedBattle: string): SearchExecutor {
  let executor = executors.get(serializedBattle);
  if (!executor) {
    if (executors.size >= 4) executors.clear();
    executor = createLocalExecutor(serializedBattle);
    executors.set(serializedBattle, executor);
  }
  return executor;
}

scope.onmessage = async (event: MessageEvent<EvalWorkerRequest | ReplayJobRequest>) => {
  const message = event.data;
  // The replay jobs (spread solve, reconstruction) ride the same script in
  // their own worker instance (ReplayWorkerClient). Their handlers load on
  // demand: they carry replay-core's team builder, the standalone dex, and
  // the learnsets, which the evaluation pool never needs.
  if (isReplayJob(message)) {
    const { handleReplayJob } = await import('../lib/replay-jobs/handlers');
    await handleReplayJob(message, postReplay);
    return;
  }
  try {
    if (message.type === 'search') {
      const run = message.settings.mode === 'mcts' ? mctsSearch : searchPosition;
      const result = run(message.serializedBattle, message.settings, {
        onProgress: progress => post({ type: 'progress', id: message.id, progress }),
        onPartial: partial => post({ type: 'partial', id: message.id, result: partial }),
      });
      post({ type: 'result', id: message.id, result });
    } else if (message.type === 'mctstree') {
      const tree = mctsTreeSearch(message.serializedBattle, message.settings, message.seedOffset, {
        // Every iteration reports; one message per ten (plus the last) is
        // all a progress bar can show, and each message is a main-thread
        // clone plus a render (round 38: the play-out's frozen panel).
        onProgress: progress => {
          if (progress.done % PROGRESS_EVERY === 0 || progress.done >= progress.total) {
            post({ type: 'progress', id: message.id, progress });
          }
        },
      });
      post({ type: 'mctsTreeResult', id: message.id, tree });
    } else if (message.type === 'choices') {
      const info = await executorFor(message.serializedBattle).choices(message.tera, message.keepPlayed, message.sleepClause);
      post({ type: 'choicesResult', id: message.id, info });
    } else if (message.type === 'cells') {
      const values = await executorFor(message.serializedBattle).evalCells(message.jobs);
      post({ type: 'cellsResult', id: message.id, values });
    } else if (message.type === 'subsearch') {
      const result = await executorFor(message.serializedBattle).subSearch(message.job);
      post({ type: 'result', id: message.id, result });
    } else if (message.type === 'prove') {
      const outcome = await executorFor(message.serializedBattle).prove(message.input);
      post({ type: 'proveResult', id: message.id, outcome });
    }
  } catch (error) {
    post({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
  }
};
