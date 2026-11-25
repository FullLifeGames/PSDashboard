/// <reference lib="webworker" />
import {
  mctsSearch, mctsTreeSearch, runOnRequestJob, type SearchExecutor, createLocalExecutor, searchPosition, takeSimFastReport,
  type EvalWorkerRequest, type EvalWorkerResponse, type StaticRuleset, loadSimModsFor,
} from '@fulllifegames/eval-engine';
import { adoptSearchBudgetStamp } from '../lib/eval/search-budget-setting';
import { adoptSimFastStamp } from '../lib/eval/sim-fast-setting';
import { isReplayJob, type ReplayJobRequest, type ReplayJobResponse } from '../lib/replay-jobs/types';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: EvalWorkerResponse) => scope.postMessage(message);
const settle = (message: EvalWorkerResponse) => post({ ...message, simFast: takeSimFastReport() });
const postReplay = (message: ReplayJobResponse) => scope.postMessage(
  message.type === 'replayProgress' || message.type === 'replayPosition' ? message : { ...message, simFast: takeSimFastReport() },
);
const PROGRESS_EVERY = 10;

// One executor serves every message about the same position under the same rule set (it picks the weight table).
const executors = new Map<string, SearchExecutor>();

// A missing rule set is a caller's bug: answered with an error, as the standard weights would misprice a VGC position.
function requireRuleset(ruleset: StaticRuleset | undefined): StaticRuleset {
  if (!ruleset) throw new Error('evaluation worker: a search message without a rule set');
  return ruleset;
}

function executorFor(serializedBattle: string, named: StaticRuleset | undefined): SearchExecutor {
  const ruleset = requireRuleset(named);
  const key = `${ruleset}|${serializedBattle}`;
  let executor = executors.get(key);
  if (!executor) {
    if (executors.size >= 4) executors.clear();
    executor = createLocalExecutor(serializedBattle, ruleset);
    executors.set(key, executor);
  }
  return executor;
}

scope.onmessage = async (event: MessageEvent<EvalWorkerRequest | ReplayJobRequest>) => {
  const message = event.data;
  // The host's speed-layer levers ride on every message (workers see no localStorage).
  adoptSimFastStamp(message);
  // The replay jobs ride this script in their own worker instance; their handlers load on demand (builder, dex, sets).
  if (isReplayJob(message)) {
    const { handleReplayJob } = await import('../lib/replay-jobs/handlers');
    await handleReplayJob(message, postReplay);
    return;
  }
  adoptSearchBudgetStamp(message);
  try {
    // A Champions position revives on the Champions mod, which nothing else in this worker loads.
    await loadSimModsFor(message.serializedBattle);
    if (message.type === 'search') {
      requireRuleset(message.settings.ruleset);
      const run = message.settings.mode === 'mcts' ? mctsSearch : searchPosition;
      const result = run(message.serializedBattle, message.settings, {
        onProgress: progress => post({ type: 'progress', id: message.id, progress }),
        onPartial: partial => post({ type: 'partial', id: message.id, result: partial }),
      });
      settle({ type: 'result', id: message.id, result });
    } else if (message.type === 'mctstree') {
      requireRuleset(message.settings.ruleset);
      const tree = mctsTreeSearch(message.serializedBattle, message.settings, message.seedOffset, {
        onProgress: progress => {
          if (progress.done % PROGRESS_EVERY === 0 || progress.done >= progress.total) {
            post({ type: 'progress', id: message.id, progress });
          }
        },
        // Tree 0 streams its interim result (every 150 iterations); the others ask for none.
        ...(message.partials && { onPartial: partial => post({ type: 'partial', id: message.id, result: partial }) }),
      });
      settle({ type: 'mctsTreeResult', id: message.id, tree });
    } else if (message.type === 'choices') {
      const info = await executorFor(message.serializedBattle, message.ruleset).choices(message.tera, message.keepPlayed, message.sleepClause);
      settle({ type: 'choicesResult', id: message.id, info });
    } else if (message.type === 'cells') {
      const values = await executorFor(message.serializedBattle, message.ruleset).evalCells(message.jobs);
      settle({ type: 'cellsResult', id: message.id, values });
    } else if (message.type === 'subsearch') {
      const result = await executorFor(message.serializedBattle, message.ruleset).subSearch(message.job);
      settle({ type: 'result', id: message.id, result });
    } else if (message.type === 'prove') {
      const outcome = await executorFor(message.serializedBattle, message.ruleset).prove(message.input);
      settle({ type: 'proveResult', id: message.id, outcome });
    } else if (message.type === 'lines') {
      const lines = await executorFor(message.serializedBattle, message.ruleset).lines!(message.input);
      settle({ type: 'linesResult', id: message.id, lines });
    } else if (message.type === 'job') {
      const result = runOnRequestJob(message.serializedBattle, requireRuleset(message.ruleset), message.job, step => post({ type: 'jobStep', id: message.id, step }));
      settle({ type: 'jobResult', id: message.id, result });
    }
  } catch (error) {
    settle({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
  }
};
