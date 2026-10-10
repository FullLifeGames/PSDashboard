import { beforeAll, describe, expect, test, vi } from 'vitest';
import { Battle, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { serializeLiveBattle, type EvalWorkerRequest, type EvalWorkerResponse } from '@fulllifegames/eval-engine';

/**
 * Round 67 (T139, app part): the worker never prices a position under a
 * rule set nobody named. A search message without one answers an error
 * instead of the standard weights, so a path that forgets to pass the
 * replay's rule set fails loudly. One test per message type; the worker
 * module runs on this thread over a stand-in for its global scope.
 */
const posted: EvalWorkerResponse[] = [];
const scope = {
  onmessage: null as ((event: MessageEvent<EvalWorkerRequest>) => Promise<void>) | null,
  postMessage: (message: EvalWorkerResponse) => { posted.push(message); },
};

const mon = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', gender: '', level: 50,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

let serializedBattle = '';

beforeAll(async () => {
  vi.stubGlobal('self', scope);
  await import('../../src/workers/eval-worker');
  const battle = new Battle({
    formatid: 'gen9customgame' as never, seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack([mon('Garchomp', ['earthquake', 'dragonclaw'])]) },
    p2: { name: 'Beta', team: Teams.pack([mon('Heatran', ['magmastorm', 'earthpower'])]) },
  });
  if (battle.sides[0].requestState === 'teampreview') {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  serializedBattle = serializeLiveBattle(battle);
});

/** The final answer of one message (progress and partials skipped). */
async function answer(request: Record<string, unknown>): Promise<EvalWorkerResponse | undefined> {
  posted.length = 0;
  await scope.onmessage?.({ data: request as unknown as EvalWorkerRequest } as MessageEvent<EvalWorkerRequest>);
  return posted.find(message => message.type !== 'progress' && message.type !== 'partial');
}

const job = { i: 0, j: 0, p1Choice: 'move 1', p2Choice: 'move 1' };

describe('eval worker rule set', () => {
  test('a choices message without a rule set is an error', async () => {
    expect(await answer({ type: 'choices', id: 1, serializedBattle, tera: false })).toMatchObject({ type: 'error', message: expect.stringMatching(/rule set/) });
  });

  test('a cells message without a rule set is an error', async () => {
    expect(await answer({ type: 'cells', id: 2, serializedBattle, jobs: [{ ...job, samples: 1 }] })).toMatchObject({ type: 'error', message: expect.stringMatching(/rule set/) });
  });

  test('a sub-search message without a rule set is an error', async () => {
    expect(await answer({ type: 'subsearch', id: 3, serializedBattle, job: { ...job, settings: { depth: 1, samples: 1 } } }))
      .toMatchObject({ type: 'error', message: expect.stringMatching(/rule set/) });
  });

  test('a proof message without a rule set is an error', async () => {
    expect(await answer({ type: 'prove', id: 4, serializedBattle, input: {} })).toMatchObject({ type: 'error', message: expect.stringMatching(/rule set/) });
  });

  test('a tree message whose settings name no rule set is an error', async () => {
    expect(await answer({ type: 'mctstree', id: 5, serializedBattle, settings: { depth: 1, samples: 1, mode: 'mcts' }, seedOffset: 0 }))
      .toMatchObject({ type: 'error', message: expect.stringMatching(/rule set/) });
  });

  test('a whole-search message whose settings name no rule set is an error', async () => {
    expect(await answer({ type: 'search', id: 6, serializedBattle, settings: { depth: 1, samples: 1 } }))
      .toMatchObject({ type: 'error', message: expect.stringMatching(/rule set/) });
  });

  test('a message that names its rule set is answered', async () => {
    expect(await answer({ type: 'cells', id: 7, serializedBattle, jobs: [{ ...job, samples: 1 }], ruleset: 'vgc' })).toMatchObject({ type: 'cellsResult' });
  });
});
