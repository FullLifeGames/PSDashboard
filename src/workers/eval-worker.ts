/// <reference lib="webworker" />
import { mctsSearch } from '../lib/eval/mcts';
import type { SearchExecutor } from '../lib/eval/orchestrator';
import { createLocalExecutor, searchPosition } from '../lib/eval/search';
import type { EvalWorkerRequest, EvalWorkerResponse } from '../lib/eval/types';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: EvalWorkerResponse) => scope.postMessage(message);

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

scope.onmessage = async (event: MessageEvent<EvalWorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'search') {
      const run = message.settings.mode === 'mcts' ? mctsSearch : searchPosition;
      const result = run(message.serializedBattle, message.settings, {
        onProgress: progress => post({ type: 'progress', id: message.id, progress }),
        onPartial: partial => post({ type: 'partial', id: message.id, result: partial }),
      });
      post({ type: 'result', id: message.id, result });
    } else if (message.type === 'choices') {
      const info = await executorFor(message.serializedBattle).choices(message.tera);
      post({ type: 'choicesResult', id: message.id, info });
    } else if (message.type === 'cells') {
      const values = await executorFor(message.serializedBattle).evalCells(message.jobs);
      post({ type: 'cellsResult', id: message.id, values });
    } else if (message.type === 'subsearch') {
      const result = await executorFor(message.serializedBattle).subSearch(message.job);
      post({ type: 'result', id: message.id, result });
    }
  } catch (error) {
    post({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
  }
};
