import { beforeAll, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalWorkerRequest, EvalWorkerResponse } from '@fulllifegames/eval-engine';

// The worker loads the Champions mod from the position itself: nothing in its module graph does it first.
const posted: EvalWorkerResponse[] = [];
const scope = {
  onmessage: null as ((event: MessageEvent<EvalWorkerRequest>) => Promise<void>) | null,
  postMessage: (message: EvalWorkerResponse) => { posted.push(message); },
};

const position = (id: string) => (JSON.parse(readFileSync(
  join('packages', 'eval-engine', 'test', 'fixtures', 'champions', `${id}.position.json`), 'utf-8',
)) as { serialized: string }).serialized;

beforeAll(async () => {
  vi.stubGlobal('self', scope);
  await import('../../../src/workers/eval-worker');
});

async function answer(request: Record<string, unknown>): Promise<EvalWorkerResponse | undefined> {
  posted.length = 0;
  await scope.onmessage?.({ data: request as unknown as EvalWorkerRequest } as MessageEvent<EvalWorkerRequest>);
  return posted.find(message => message.type !== 'progress' && message.type !== 'partial');
}

describe('eval worker on a Champions position', () => {
  const positions = [['singles', 'gen9championsou-2693832490-t3'], ['doubles', 'gen9championsvgc2026regmbbo3-2679053861-t3']] as const;
  for (const [kind, id] of positions) {
    test(`a choices message on a Champions ${kind} position is answered`, async () => {
      expect(await answer({ type: 'choices', id: 1, serializedBattle: position(id), tera: false, ruleset: 'champions' }))
        .toMatchObject({ type: 'choicesResult' });
    });
  }
});
