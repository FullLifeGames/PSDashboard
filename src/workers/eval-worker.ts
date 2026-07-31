/// <reference lib="webworker" />
import { searchPosition } from '../lib/eval/search';
import type { EvalWorkerRequest, EvalWorkerResponse } from '../lib/eval/types';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: EvalWorkerResponse) => scope.postMessage(message);

scope.onmessage = (event: MessageEvent<EvalWorkerRequest>) => {
  const message = event.data;
  if (message.type !== 'search') return;
  try {
    const result = searchPosition(message.serializedBattle, message.settings, {
      onProgress: progress => post({ type: 'progress', id: message.id, progress }),
      onPartial: partial => post({ type: 'partial', id: message.id, result: partial }),
    });
    post({ type: 'result', id: message.id, result });
  } catch (error) {
    post({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
  }
};
