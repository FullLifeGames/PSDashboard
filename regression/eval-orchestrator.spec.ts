import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { searchOrchestrated, type CellJob, type SearchExecutor, type SubSearchJob } from '../src/lib/eval/orchestrator';
import { createLocalExecutor, searchPosition } from '../src/lib/eval/search';
import type { EvalResult, SearchProgress } from '../src/lib/eval/types';

function makeSet(name: string, species: string, moves: string[], level = 50): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID('gen9customgame'),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));

const threeTurnWin = () => serialize(makeBattle(
  [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100)],
  [
    makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30),
    makeSet('Eevee', 'Eevee', ['Tackle', 'Growl'], 30),
    makeSet('Vulpix', 'Vulpix', ['Tackle', 'Growl'], 30),
  ],
));

test.describe('search orchestrator', () => {
  test('parity: orchestrated search over a local executor equals the sync search', async () => {
    for (const settings of [
      { depth: 1, samples: 3 },
      { depth: 2, samples: 1, tera: false },
      { depth: 3, samples: 1, tera: false },
    ] as const) {
      const root = threeTurnWin();
      const sync = searchPosition(root, settings);
      const orchestrated = await searchOrchestrated(createLocalExecutor(root), settings);
      expect(orchestrated, `settings ${JSON.stringify(settings)}`).toEqual(sync);
    }
  });

  test('progress covers the matrix and partials arrive per depth', async () => {
    const root = threeTurnWin();
    const progress: SearchProgress[] = [];
    const partials: EvalResult[] = [];
    await searchOrchestrated(createLocalExecutor(root), { depth: 2, samples: 1, tera: false }, {
      onProgress: p => progress.push(p),
      onPartial: r => partials.push(r),
    });
    expect(partials.map(partial => partial.depthCompleted)).toEqual([1, 2]);
    const depth1 = progress.filter(p => p.depth === 1);
    expect(depth1[depth1.length - 1].done).toBe(depth1[depth1.length - 1].total);
  });

  test('a fake executor drives the orchestration without any sim', async () => {
    // 2x2 matrix: p1's "a" is safe (0.2 worst case), "b" is punished (-0.5).
    const values: Record<string, number> = { '0,0': 0.2, '0,1': 0.3, '1,0': 0.6, '1,1': -0.5 };
    const subSearches: SubSearchJob[] = [];
    const executor: SearchExecutor = {
      async choices() {
        return {
          p1: [{ choice: 'move a', label: 'A' }, { choice: 'move b', label: 'B' }],
          p2: [{ choice: 'move x', label: 'X' }, { choice: 'move y', label: 'Y' }],
          rootValue: 0,
          rootEnded: false,
        };
      },
      async evalCells(jobs: CellJob[]) {
        return jobs.map(job => ({ i: job.i, j: job.j, value: values[`${job.i},${job.j}`], ended: false }));
      },
      async subSearch(job: SubSearchJob): Promise<EvalResult> {
        subSearches.push(job);
        // Deepening confirms the static value exactly, so iteration converges.
        return {
          score: values[`${job.i},${job.j}`],
          depthCompleted: job.settings.depth,
          perSide: {
            p1: [{ choice: 'move next', label: 'Next', worstCase: 0, expected: 0, punishedBy: null }],
            p2: [{ choice: 'move reply', label: 'Reply', worstCase: 0, expected: 0, punishedBy: null }],
          },
        };
      },
    };

    const result = await searchOrchestrated(executor, { depth: 2, samples: 1 });
    expect(result.depthCompleted).toBe(2);
    expect(result.perSide.p1[0].choice).toBe('move a'); // maximin: worst(a)=0.2 > worst(b)=-0.5
    expect(result.perSide.p1[0].line).toEqual([{ p1: 'Next', p2: 'Reply' }]);
    expect(subSearches.length).toBeGreaterThan(0);
  });
});
