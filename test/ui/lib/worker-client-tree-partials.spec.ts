import { afterEach, beforeAll, describe, expect, onTestFinished, test, vi } from 'vitest';
import { Battle, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { configureSearchBudget, parseSearchBudget, serializeLiveBattle, type EvalResult, type EvalSettings, type EvalWorkerRequest, type EvalWorkerResponse } from '@fulllifegames/eval-engine';
import { EvalWorkerClient } from '../../../src/lib/eval/worker-client';

/**
 * Round 89 (SB-9, gate finding BROKEN 1): a tree search streamed no result until a whole tree had ended, so a Cancel in the first
 * seconds of a doubles or VGC replacement kept nothing. The pool now asks tree 0 (and only tree 0) for its interim result, and only
 * when the caller listens: the game analysis and the play-out pass no `onPartial` and get no extra work. Rows run the real worker
 * module on this thread behind a stand-in pool, for a doubles battle and a singles battle (singles from a quarter fainted runs
 * the tree too).
 */

const posted: EvalWorkerRequest[] = [];
const answered: EvalWorkerResponse[] = [];

const askers = new Map<number, RealWorker>();
const scope = {
  onmessage: null as ((event: MessageEvent<EvalWorkerRequest>) => Promise<void>) | null,
  postMessage: (message: EvalWorkerResponse) => {
    answered.push(message);
    askers.get(message.id)?.deliver(message);
  },
};

class RealWorker {
  onmessage: ((event: MessageEvent<EvalWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(request: EvalWorkerRequest) {
    posted.push(request);
    askers.set(request.id, this);
    queueMicrotask(() => { void scope.onmessage?.({ data: request } as MessageEvent<EvalWorkerRequest>); });
  }
  deliver(message: EvalWorkerResponse) {
    queueMicrotask(() => this.onmessage?.({ data: message } as MessageEvent<EvalWorkerResponse>));
  }
  terminate() {}
}

const mon = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', gender: '', level: 50,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function battleOf(formatid: string, p1: PokemonSet[], p2: PokemonSet[]): string {
  const battle = new Battle({
    formatid: formatid as never, seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) },
    p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.sides[0].requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  return serializeLiveBattle(battle);
}

const BATTLES = {
  doubles: '',
  singles: '',
};

beforeAll(async () => {
  vi.stubGlobal('self', scope);
  await import('../../../src/workers/eval-worker');
  vi.unstubAllGlobals();
  BATTLES.doubles = battleOf(
    'gen9doublescustomgame',
    [mon('Garchomp', ['earthquake', 'dragonclaw']), mon('Rillaboom', ['woodhammer', 'fakeout'])],
    [mon('Heatran', ['magmastorm', 'earthpower']), mon('Gholdengo', ['makeitrain', 'shadowball'])],
  );
  BATTLES.singles = battleOf('gen9customgame', [mon('Garchomp', ['earthquake', 'dragonclaw'])], [mon('Heatran', ['magmastorm', 'earthpower'])]);
});

afterEach(() => {
  posted.length = 0;
  answered.length = 0;
  askers.clear();
  vi.unstubAllGlobals();
});

async function evaluate(serialized: string, onPartial?: (result: EvalResult) => void) {
  // The main thread reads the tree count before the first message stamps the budget, so the lean budget is set on both routes.
  localStorage.setItem('ps-replay-interceptor:search-budget', 'trees=2,iterations=200');
  configureSearchBudget(parseSearchBudget('trees=2,iterations=200'));
  onTestFinished(() => { localStorage.removeItem('ps-replay-interceptor:search-budget'); configureSearchBudget(null); });
  vi.stubGlobal('Worker', RealWorker);
  const client = new EvalWorkerClient();
  const settings: EvalSettings = { depth: 1, samples: 1, mode: 'mcts', tera: false, ruleset: 'standard', prove: false };
  try {
    return await client.evaluate(serialized, settings, onPartial ? { onPartial } : undefined);
  } finally {
    client.dispose();
  }
}

const treeMessages = () => posted.filter((request): request is Extract<EvalWorkerRequest, { type: 'mctstree' }> => request.type === 'mctstree');

describe.each(['doubles', 'singles'] as const)('worker client tree partials (%s)', game => {
  test('a listener makes the pool ask tree 0, and only tree 0, for its interim result', async () => {
    const heard: EvalResult[] = [];
    await evaluate(BATTLES[game], result => heard.push(result));
    const trees = treeMessages();
    expect(trees.map(request => [request.seedOffset, request.partials])).toEqual([[0, true], [1, undefined]]);
    expect(heard.length).toBeGreaterThan(0);
  });

  test('the interim result reaches the listener before the first tree is answered', async () => {
    const heard: EvalResult[] = [];
    await evaluate(BATTLES[game], result => heard.push(result));
    const firstPartial = answered.findIndex(message => message.type === 'partial');
    const firstTree = answered.findIndex(message => message.type === 'mctsTreeResult');
    expect(firstPartial, 'the worker posted an interim result').toBeGreaterThanOrEqual(0);
    expect(firstPartial).toBeLessThan(firstTree);
    expect(heard[0].perSide.p1.length + heard[0].perSide.p2.length).toBeGreaterThan(0);
  });

  test('without a listener no tree message asks for interim results', async () => {
    await evaluate(BATTLES[game]);
    expect(treeMessages().length).toBeGreaterThan(0);
    expect(treeMessages().every(request => request.partials === undefined)).toBe(true);
    expect(answered.some(message => message.type === 'partial' && posted.find(request => request.id === message.id)?.type === 'mctstree')).toBe(false);
  });
});
