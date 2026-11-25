import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { searchOrchestrated, type SearchExecutor, createLocalExecutor, searchPosition, type EvalCellJob, type EvalResult, type EvalSubSearchJob, type SearchProgress } from '@fulllifegames/eval-engine';

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

describe('search orchestrator', () => {
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

  test('parity includes pivot pairs — the orchestrated matrix names the follow-ups', async () => {
    // The worker-pool path builds root options through the choices RPC: a bare "U-turn" row would hide the
    // "U-turn → X" pairs the sync path enumerates.
    const root = serialize(makeBattle(
      [
        makeSet('Mien', 'Mienshao', ['U-turn', 'Close Combat'], 100),
        makeSet('Clef', 'Clefable', ['Moonblast'], 100),
        makeSet('Tran', 'Heatran', ['Lava Plume'], 100),
      ],
      [makeSet('Bliss', 'Blissey', ['Seismic Toss'], 100)],
    ));
    const settings = { depth: 1, samples: 1, tera: false } as const;
    const sync = searchPosition(root, settings);
    const orchestrated = await searchOrchestrated(createLocalExecutor(root), settings);
    expect(orchestrated).toEqual(sync);
    const labels = orchestrated.matrix?.p1Labels ?? [];
    expect(labels).toContain('U-turn → Clefable');
    expect(labels).toContain('U-turn → Heatran');
    expect(labels).not.toContain('U-turn');
  });

  test('parity holds for a doubles position', async () => {
    const root = serialize((() => {
      const battle = new Battle({
        formatid: toID('gen9doublescustomgame'),
        seed: '1,2,3,4',
        p1: {
          name: 'Alpha',
          team: Teams.pack([
            makeSet('Machamp', 'Machamp', ['Rock Slide', 'Karate Chop']),
            makeSet('Snorlax', 'Snorlax', ['Tackle', 'Protect']),
            makeSet('Chansey', 'Chansey', ['Protect']),
          ]),
        },
        p2: {
          name: 'Beta',
          team: Teams.pack([
            makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30),
            makeSet('Eevee', 'Eevee', ['Tackle', 'Growl'], 30),
          ]),
        },
      });
      if (battle.sides.some(side => side.requestState === 'teampreview')) {
        battle.choose('p1', 'team 123');
        battle.choose('p2', 'team 12');
      }
      return battle;
    })());
    for (const settings of [{ depth: 1, samples: 1, tera: false }, { depth: 2, samples: 1, tera: false }] as const) {
      const sync = searchPosition(root, settings);
      const orchestrated = await searchOrchestrated(createLocalExecutor(root), settings);
      expect(orchestrated, `settings ${JSON.stringify(settings)}`).toEqual(sync);
    }
  });

  test('parity includes the forced win: both paths bar the same proof', async () => {
    const root = threeTurnWin();
    const sync = searchPosition(root, { depth: 1, samples: 1, tera: false });
    const orchestrated = await searchOrchestrated(createLocalExecutor(root), { depth: 1, samples: 1, tera: false });
    expect(orchestrated.forcedWin).toEqual(sync.forcedWin);
    expect(orchestrated.score).toBe(sync.score);
    console.log(`threeTurnWin forcedWin: ${JSON.stringify(sync.forcedWin)}`);
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
    const values: Record<string, number> = { '0,0': 0.2, '0,1': 0.3, '1,0': 0.6, '1,1': -0.5 };
    const subSearches: EvalSubSearchJob[] = [];
    const executor: SearchExecutor = {
      async choices() {
        return {
          p1: [{ choice: 'move a', label: 'A' }, { choice: 'move b', label: 'B' }],
          p2: [{ choice: 'move x', label: 'X' }, { choice: 'move y', label: 'Y' }],
          rootValue: 0,
          rootEnded: false,
        };
      },
      async evalCells(jobs: EvalCellJob[]) {
        return jobs.map(job => ({ i: job.i, j: job.j, value: values[`${job.i},${job.j}`], ended: false }));
      },
      async subSearch(job: EvalSubSearchJob): Promise<EvalResult> {
        subSearches.push(job);
        return {
          score: values[`${job.i},${job.j}`],
          interval: 0,
          depthCompleted: job.settings.depth,
          perSide: {
            p1: [{ choice: 'move next', label: 'Next', worstCase: 0, expected: 0, ev: 0, punishedBy: null }],
            p2: [{ choice: 'move reply', label: 'Reply', worstCase: 0, expected: 0, ev: 0, punishedBy: null }],
          },
        };
      },
      async prove() {
        return null;
      },
    };

    const result = await searchOrchestrated(executor, { depth: 2, samples: 1 });
    expect(result.depthCompleted).toBe(2);
    expect(result.perSide.p1[0].choice).toBe('move a'); // maximin: worst(a)=0.2 > worst(b)=-0.5
    expect(result.perSide.p1[0].line).toEqual([{ p1: 'Next', p2: 'Reply' }]);
    expect(subSearches.length).toBeGreaterThan(0);
    expect(result.interval).toBeCloseTo(0.1, 10);
  });
});

describe('the trend probe over the base draws', () => {
  const SETTINGS = { depth: 1, samples: 3, tera: false, prove: false } as const;

  function tiedExecutor(draws: number, trend?: (index: number) => number) {
    const probes: EvalSubSearchJob[] = [];
    const executor: SearchExecutor = {
      async choices() {
        return {
          p1: [{ choice: 'move a', label: 'A' }, { choice: 'move b', label: 'B' }],
          p2: [{ choice: 'move x', label: 'X' }, { choice: 'move y', label: 'Y' }],
          rootValue: 0, rootEnded: false,
        };
      },
      async evalCells(jobs: EvalCellJob[]) {
        const baseDraws = Array.from({ length: draws }, (_, index) => ({ index }));
        return jobs.map(job => ({ i: job.i, j: job.j, value: 0.2, ended: false, ...(draws > 1 ? { baseDraws } : {}) }));
      },
      async subSearch(job: EvalSubSearchJob): Promise<EvalResult> {
        probes.push(job);
        const answer = trend && job.draw ? { trend: trend(job.draw.index) } : {};
        return { score: 1.1, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] }, ...answer };
      },
      async prove() {
        return null;
      },
    };
    return { executor, probes };
  }
  const drawsByCell = (probes: EvalSubSearchJob[]) => {
    const cells = new Map<string, (number | undefined)[]>();
    for (const job of probes) cells.set(`${job.i},${job.j}`, [...(cells.get(`${job.i},${job.j}`) ?? []), job.draw?.index]);
    return [...cells.values()].map(indices => indices.sort());
  };
  const moved = (result: EvalResult) => ({
    p1: result.perSide.p1.map(row => row.ev - 0.2),
    p2: result.perSide.p2.map(row => -0.2 - row.ev),
  });
  const SHIFT = 0.5;

  test('one probe per base draw of each decisive cell; the booked trend is the mean of the answers', async () => {
    const { executor, probes } = tiedExecutor(3, index => [0.9, 0.3, 0.0][index]);
    const result = await searchOrchestrated(executor, SETTINGS);
    const cells = drawsByCell(probes);
    expect(cells.length).toBeGreaterThan(0);
    for (const indices of cells) expect(indices).toEqual([0, 1, 2]);
    // The mean of 0.9, 0.3 and 0.0 is 0.4 in every probed cell: every tied row moves by 0.5 x 0.4.
    for (const amount of [...moved(result).p1, ...moved(result).p2]) expect(amount).toBeCloseTo(SHIFT * 0.4, 10);
  });

  test('a cell of one draw is probed as before: one job on its first child, no draw named, booked against the cell', async () => {
    const { executor, probes } = tiedExecutor(1, () => 0.1);
    const result = await searchOrchestrated(executor, SETTINGS);
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.every(job => job.draw === undefined)).toBe(true);
    // The score 1.1 against the cell's 0.2: the trend is 0.9, whatever a draw would have answered.
    for (const amount of [...moved(result).p1, ...moved(result).p2]) expect(amount).toBeCloseTo(SHIFT * 0.9, 10);
  });

  test('an executor that answers no trend is booked as before: the child\'s score against the cell, per draw', async () => {
    const { executor, probes } = tiedExecutor(3);
    const result = await searchOrchestrated(executor, SETTINGS);
    expect(probes.length).toBeGreaterThan(0);
    for (const indices of drawsByCell(probes)) expect(indices).toEqual([0, 1, 2]);
    for (const amount of [...moved(result).p1, ...moved(result).p2]) expect(amount).toBeCloseTo(SHIFT * 0.9, 10);
  });

  const twinScene = () => {
    const evs = { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 };
    const set = (species: string, moves: string[]): PokemonSet => ({ ...makeSet(species, species, moves, 100), evs });
    return serialize(makeBattle(
      [set('Gengar', ['Focus Blast', 'Substitute'])],
      [set('Magikarp', ['Splash']), set('Skarmory', ['Roost', 'Brave Bird']), set('Skarmory', ['Roost', 'Brave Bird'])],
    ));
  };

  test('parity: both paths probe a rolling cell from every base draw and book the same trend', async () => {
    const root = twinScene();
    const settings = { depth: 1, samples: 3, tera: false } as const;
    const sync = searchPosition(root, settings);
    const local = createLocalExecutor(root);
    const probes: EvalSubSearchJob[] = [];
    const logged: SearchExecutor = { ...local, subSearch: job => { if (job.draw) probes.push(job); return local.subSearch(job); } };
    const orchestrated = await searchOrchestrated(logged, settings);
    expect(orchestrated).toEqual(sync);
    expect(drawsByCell(probes)).toEqual([[0, 1, 2], [0, 1, 2]]);
  });

  test('parity holds at one draw per cell too: the probe of the first child, on both paths', async () => {
    const root = twinScene();
    const settings = { depth: 1, samples: 1, tera: false } as const;
    const local = createLocalExecutor(root);
    const probes: EvalSubSearchJob[] = [];
    const logged: SearchExecutor = { ...local, subSearch: job => { probes.push(job); return local.subSearch(job); } };
    expect(await searchOrchestrated(logged, settings)).toEqual(searchPosition(root, settings));
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.every(job => job.draw === undefined)).toBe(true);
  });
});

describe('depth-matched played outcome', () => {
  test('routes the played pair to the same estimator as the sweep cells', async () => {
    const { playedOutcomeSettings } = await import('../../src/lib/eval/worker-client');
    expect(playedOutcomeSettings({ depth: 1, samples: 3, tera: false })).toBeNull();
    expect(playedOutcomeSettings({ depth: 2, samples: 3, tera: true }))
      .toEqual({ depth: 1, samples: 1, tera: true, mode: 'matrix' });
    expect(playedOutcomeSettings({ depth: 3, samples: 1, tera: false }))
      .toEqual({ depth: 2, samples: 1, tera: false, mode: 'matrix' });
    expect(playedOutcomeSettings({ depth: 1, samples: 1, tera: false, mode: 'mcts' }))
      .toEqual({ depth: 1, samples: 1, tera: false, mode: 'matrix' });
    expect(playedOutcomeSettings({ depth: 2, samples: 1, tera: false, keepPlayed: { p1Slots: [] } })?.keepPlayed)
      .toBeUndefined();
  });
});
