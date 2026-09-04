import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { analyzeTurn, matchPlayedChoice } from '../src/analysis';
import { mctsSearch, mctsTreeSearch, MCTS_ITERATIONS } from '../src/mcts';
import { mergeMctsTrees, MCTS_TREES, starvedSupportCells } from '../src/mcts-merge';
import { createLocalExecutor, searchPosition } from '../src/search';
import { cellKey } from '../src/rank';
import type { EvalResult, SearchProgress } from '../src/types';

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

// Machamp's Hydro Pump always kills a lvl-30 Pikachu (killFraction 1) but
// carries the 80% accuracy roll — a priceable boundary event with
// pKill 0.8 < 1, so koOddsForOptions emits it. Seismic Toss is the
// deterministic KO: no event, no odds. The Eevee bench gives p2 switch rows.
const gambleRoot = () => serialize(makeBattle(
  [makeSet('Machamp', 'Machamp', ['Hydro Pump', 'Seismic Toss'], 100)],
  [
    makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30),
    makeSet('Eevee', 'Eevee', ['Tackle', 'Growl'], 30),
  ],
));

// Round-6 mutual-OHKO cell (see eval-cell-blend.spec.ts): the 1-HP
// Deoxys-Speed's 80% Hydro Pump kills on a hit (+1); on a miss the
// surviving Pikachu's Tackle kills the attacker (−1). Analytic value
// 0.8·1 + 0.2·(−1) = 0.6 exactly — and BOTH classes end the game, so the
// cell is ended in every tree that expands it.
const mutualRoot = () => {
  const battle = makeBattle(
    [makeSet('Deo', 'Deoxys-Speed', ['Hydro Pump', 'Seismic Toss'], 100)],
    [makeSet('Pika', 'Pikachu', ['Tackle', 'Growl'], 30)],
  );
  battle.sides[0].active[0]!.hp = 1;
  return serialize(battle);
};

test.describe('DUCT-MCTS search', () => {
  test('finds the winning line and prefers it', () => {
    const result = mctsSearch(threeTurnWin(), { depth: 1, samples: 1, tera: false, mode: 'mcts' });
    expect(result.perSide.p1[0].choice).toBe('move seismictoss');
    expect(result.score).toBeGreaterThan(0.3);
    // The tree reached beyond one turn.
    expect(result.depthCompleted).toBeGreaterThan(1);
  });

  test('sees deeper than the static depth-1 matrix', () => {
    // Round 35: the forced-win bar lifts both to the proven mass; the
    // engines' own scores (before the bar) still tell the depths apart.
    const matrix = searchPosition(threeTurnWin(), { depth: 1, samples: 1, tera: false });
    const mcts = mctsSearch(threeTurnWin(), { depth: 1, samples: 1, tera: false, mode: 'mcts' });
    expect(mcts.forcedWin?.engineScore ?? mcts.score).toBeGreaterThan(matrix.forcedWin?.engineScore ?? matrix.score);
  });

  test('is deterministic and reports progress', () => {
    const progress: SearchProgress[] = [];
    const partials: EvalResult[] = [];
    const first = mctsSearch(threeTurnWin(), { depth: 1, samples: 1, tera: false, mode: 'mcts' }, {
      onProgress: p => progress.push(p),
      onPartial: r => partials.push(r),
    });
    const second = mctsSearch(threeTurnWin(), { depth: 1, samples: 1, tera: false, mode: 'mcts' });
    expect(first).toEqual(second);
    expect(progress[progress.length - 1].done).toBe(MCTS_ITERATIONS);
    expect(partials.length).toBeGreaterThan(0);
  });

  test('feeds the played-vs-best turn analysis (graph sweeps in MCTS mode)', () => {
    const result = mctsSearch(threeTurnWin(), { depth: 1, samples: 1, tera: false, mode: 'mcts' });
    // Even a clearly bad option gets visits (unvisited-first UCB), so a
    // sweep's played-action matching works on visit-ranked results too.
    expect(matchPlayedChoice(result, 'p1', { kind: 'move', name: 'Protect', tera: false })?.choice).toBe('move protect');
    const analysis = analyzeTurn({
      turn: 1,
      result,
      played: {
        p1: { kind: 'move', name: 'Protect', tera: false },
        p2: { kind: 'move', name: 'Tackle', tera: false },
      },
      playedOutcome: result.score - 0.1,
      scoreBefore: result.score,
      scoreAfter: result.score - 0.15,
    });
    expect(analysis.p1.best?.choice).toBe('move seismictoss');
    expect(analysis.p1.played?.label).toBe('Protect');
    expect(analysis.p2.played?.choice).toBe('move tackle');
    expect(analysis.p1.regret).toBeGreaterThan(0);
  });

  test('runs on a doubles position over restricted combined choices', () => {
    const battle = new Battle({
      formatid: toID('gen9doublescustomgame'),
      seed: '1,2,3,4',
      p1: {
        name: 'Alpha',
        team: Teams.pack([
          makeSet('Machamp', 'Machamp', ['Rock Slide', 'Karate Chop']),
          makeSet('Snorlax', 'Snorlax', ['Tackle', 'Protect']),
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
      battle.choose('p1', 'team 12');
      battle.choose('p2', 'team 12');
    }
    const root = serialize(battle);
    const result = mctsSearch(root, { depth: 1, samples: 1, tera: false, mode: 'mcts' });
    expect(result.perSide.p1.length).toBeGreaterThan(0);
    expect(result.perSide.p1.length).toBeLessThanOrEqual(12);
    expect(result.perSide.p1[0].choice).toContain(','); // combined two-slot choice
    expect(mctsSearch(root, { depth: 1, samples: 1, tera: false, mode: 'mcts' })).toEqual(result);
  });

  test('root-parallel trees merge deterministically and agree on the win', () => {
    const root = threeTurnWin();
    const settings = { depth: 1, samples: 1, tera: false, mode: 'mcts' } as const;
    const trees = Array.from({ length: MCTS_TREES }, (_, offset) => mctsTreeSearch(root, settings, offset));

    // All trees rank the same option lists (a hard merge precondition).
    for (const tree of trees) {
      expect(tree.p1Options).toEqual(trees[0].p1Options);
      expect(tree.p1N).toHaveLength(tree.p1Options.length);
    }

    const merged = mergeMctsTrees(trees);
    expect(merged.perSide.p1[0].choice).toBe('move seismictoss');
    expect(merged.score).toBeGreaterThan(0.3);
    // Merged visits cover every tree's iterations.
    const totalTopVisits = trees.reduce((sum, tree) => sum + tree.visits, 0);
    expect(totalTopVisits).toBe(MCTS_TREES * MCTS_ITERATIONS);
    // Deterministic: same trees, same merge.
    expect(mergeMctsTrees(trees.map(tree => ({ ...tree })))).toEqual(merged);
    // A single tree merges to exactly its own result.
    expect(mergeMctsTrees([trees[0]])).toEqual(trees[0].result);
  });

  test('attaches the solved matrix for the Read lens', () => {
    // The Read lens reads EvalResult.matrix — MCTS mode must attach it too,
    // or reads silently vanish whenever the engine mode is 'mcts'.
    const result = mctsSearch(threeTurnWin(), { depth: 1, samples: 1, tera: false, mode: 'mcts' });
    expect(result.matrix).toBeTruthy();
    expect(result.matrix!.p1Labels).toContain('Seismic Toss');
    const sum = (mix: number[]) => mix.reduce((total, p) => total + p, 0);
    expect(sum(result.matrix!.mixes.p1)).toBeCloseTo(1, 6);
    expect(sum(result.matrix!.mixes.p2)).toBeCloseTo(1, 6);

    const trees = Array.from({ length: MCTS_TREES }, (_, offset) =>
      mctsTreeSearch(threeTurnWin(), { depth: 1, samples: 1, tera: false, mode: 'mcts' }, offset));
    expect(mergeMctsTrees(trees).matrix).toBeTruthy();
  });

  test('an ended position returns its exact value', () => {
    const battle = makeBattle(
      [makeSet('A', 'Snorlax', ['Protect'])],
      [makeSet('B', 'Chansey', ['Protect'])],
    );
    battle.win(battle.sides[0]);
    const result = mctsSearch(serialize(battle), { depth: 1, samples: 1, mode: 'mcts' });
    expect(result.score).toBe(1);
    expect(result.perSide.p1).toHaveLength(0);
  });
});

test.describe('MCTS koOdds payload (round 7)', () => {
  const settings = { depth: 1, samples: 1, tera: false, mode: 'mcts' } as const;

  test('sync results carry analytic koOdds on boundary rows only', () => {
    const result = mctsSearch(gambleRoot(), settings);
    const pump = result.perSide.p1.find(row => row.choice === 'move hydropump')!;
    const toss = result.perSide.p1.find(row => row.choice === 'move seismictoss')!;
    expect(pump.koOdds).toEqual({ accuracy: expect.closeTo(0.8, 5), killFraction: 1 });
    expect(toss.koOdds).toBeUndefined();
    const bench = result.perSide.p2.find(row => row.choice.startsWith('switch'));
    expect(bench).toBeTruthy();
    expect(bench!.koOdds).toBeUndefined();
  });

  test('merged parallel trees carry the same koOdds (partials path)', () => {
    const trees = Array.from({ length: 2 }, (_, offset) => mctsTreeSearch(gambleRoot(), settings, offset));
    expect(trees[0].koOdds?.p1.some(Boolean)).toBe(true);
    const merged = mergeMctsTrees(trees);
    const pump = merged.perSide.p1.find(row => row.choice === 'move hydropump')!;
    expect(pump.koOdds).toEqual({ accuracy: expect.closeTo(0.8, 5), killFraction: 1 });
  });

  test('root cells carry their drawn outcome class on boundary cells only, deterministically (round 33)', () => {
    const root = gambleRoot();
    const tree = mctsTreeSearch(root, settings, 1);
    const i = tree.p1Options.findIndex(option => option.choice === 'move hydropump');
    const toss = tree.p1Options.findIndex(option => option.choice === 'move seismictoss');
    const j = tree.p2Options.findIndex(option => option.choice === 'move tackle');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThanOrEqual(0);
    const pump = tree.cells.find(cell => cell.key === cellKey(i, j));
    expect(pump).toBeTruthy();
    expect(['miss', 'hit-kill', 'hit-nokill']).toContain(pump!.classKey);
    const certain = tree.cells.find(cell => cell.key === cellKey(toss, j));
    expect(certain?.classKey).toBeUndefined();
    // Same offset, same draws, same keys.
    const again = mctsTreeSearch(root, settings, 1);
    expect(again.cells.map(cell => [cell.key, cell.classKey])).toEqual(tree.cells.map(cell => [cell.key, cell.classKey]));
  });

  test('only the offset-0 tree pays the boundary-flag scan (the merge reads trees[0])', () => {
    const root = gambleRoot();
    const tree0 = mctsTreeSearch(root, settings, 0);
    const tree1 = mctsTreeSearch(root, settings, 1);
    expect(tree0.boundaryCells?.length ?? 0).toBeGreaterThan(0);
    expect(tree1.boundaryCells).toEqual([]);
  });

  test('doubles results carry no koOdds (fail-closed)', () => {
    const battle = new Battle({
      formatid: toID('gen9doublescustomgame'),
      seed: '1,2,3,4',
      p1: {
        name: 'Alpha',
        team: Teams.pack([
          makeSet('Machamp', 'Machamp', ['Rock Slide', 'Karate Chop']),
          makeSet('Snorlax', 'Snorlax', ['Tackle', 'Protect']),
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
      battle.choose('p1', 'team 12');
      battle.choose('p2', 'team 12');
    }
    const result = mctsSearch(serialize(battle), settings);
    for (const row of [...result.perSide.p1, ...result.perSide.p2]) {
      expect(row.koOdds).toBeUndefined();
    }
  });

  test('a uniform-outcome mutual-kill cell re-prices to the analytic blend end-to-end', async () => {
    const root = mutualRoot();
    const trees = Array.from({ length: 2 }, (_, offset) => mctsTreeSearch(root, settings, offset));
    const merged = mergeMctsTrees(trees);
    const jobs = starvedSupportCells(trees, merged);
    // Every draw of this cell ends the game — only the boundary bypass
    // can emit it for verification.
    const cell = jobs.find(job => job.p1Choice === 'move hydropump' && job.p2Choice === 'move tackle');
    expect(cell).toBeTruthy();
    const values = await createLocalExecutor(root).evalCells(jobs);
    const verified = mergeMctsTrees(trees, new Map(values.map(value => [cellKey(value.i, value.j), value])));
    const matrix = verified.matrix!;
    const i = matrix.p1Choices!.indexOf('move hydropump');
    const j = matrix.p2Choices!.indexOf('move tackle');
    expect(matrix.values[i][j]).toBeCloseTo(0.6, 9);
    // HYBRID: verification refines rankings, never the score line.
    expect(verified.score).toBeCloseTo(merged.score, 10);
  });
});
