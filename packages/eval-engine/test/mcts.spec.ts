import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { analyzeTurn, matchPlayedChoice } from '../src/analysis';
import { mctsSearch, mctsTreeSearch, MCTS_ITERATIONS, mctsRoot } from '../src/mcts';
import { mergeMctsTrees, starvedSupportCells } from '../src/mcts-merge';
import { searchBudget } from '../src/search/budget';
import { createLocalExecutor, searchPosition } from '../src/search';
import { cellKey } from '../src/rank';
import type { EvalResult, SearchProgress } from '../src/types';
import { advancePositionWithLog, createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import type { Node } from '../src/search/mcts-node';
import { readFileSync } from 'node:fs';
import {
  buildTeamsFromReplay,
  formatEnforcesSleepClause,
  getBranchSimulatorFormat,
  parseReplayLogWithObservations,
} from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';

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
// carries the 80% accuracy roll: a priceable boundary event with
// pKill 0.8 < 1, so koOddsForOptions emits it. Seismic Toss is the
// deterministic KO: no event, no odds. The Eevee bench gives p2 switch rows.
const gambleRoot = () => serialize(makeBattle(
  [makeSet('Machamp', 'Machamp', ['Hydro Pump', 'Seismic Toss'], 100)],
  [
    makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30),
    makeSet('Eevee', 'Eevee', ['Tackle', 'Growl'], 30),
  ],
));

// Mutual-OHKO cell (see cell-blend.spec.ts): the 1-HP
// Deoxys-Speed's 80% Hydro Pump kills on a hit (+1); on a miss the
// surviving Pikachu's Tackle kills the attacker (−1). Analytic value
// 0.8·1 + 0.2·(−1) = 0.6 exactly, and BOTH classes end the game, so the
// cell is ended in every tree that expands it.
const mutualRoot = () => {
  const battle = makeBattle(
    [makeSet('Deo', 'Deoxys-Speed', ['Hydro Pump', 'Seismic Toss'], 100)],
    [makeSet('Pika', 'Pikachu', ['Tackle', 'Growl'], 30)],
  );
  battle.sides[0].active[0]!.hp = 1;
  return serialize(battle);
};

describe('DUCT-MCTS search', () => {
  test('finds the winning line and prefers it', () => {
    const result = mctsSearch(threeTurnWin(), { depth: 1, samples: 1, tera: false, mode: 'mcts' });
    expect(result.perSide.p1[0].choice).toBe('move seismictoss');
    expect(result.score).toBeGreaterThan(0.3);
    expect(result.depthCompleted).toBeGreaterThan(1);
  });

  test('sees deeper than the static depth-1 matrix', () => {
    // The forced-win bar lifts both to the proven mass; the
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
    const trees = Array.from({ length: searchBudget().trees }, (_, offset) => mctsTreeSearch(root, settings, offset));

    for (const tree of trees) {
      expect(tree.p1Options).toEqual(trees[0].p1Options);
      expect(tree.p1N).toHaveLength(tree.p1Options.length);
    }

    const merged = mergeMctsTrees(trees);
    expect(merged.perSide.p1[0].choice).toBe('move seismictoss');
    expect(merged.score).toBeGreaterThan(0.3);
    const totalTopVisits = trees.reduce((sum, tree) => sum + tree.visits, 0);
    expect(totalTopVisits).toBe(searchBudget().trees * MCTS_ITERATIONS);
    expect(mergeMctsTrees(trees.map(tree => ({ ...tree })))).toEqual(merged);
    expect(mergeMctsTrees([trees[0]])).toEqual(trees[0].result);
  });

  test('attaches the solved matrix for the Read lens', () => {
    // The Read lens reads EvalResult.matrix: MCTS mode must attach it too,
    // or reads silently vanish whenever the engine mode is 'mcts'.
    const result = mctsSearch(threeTurnWin(), { depth: 1, samples: 1, tera: false, mode: 'mcts' });
    expect(result.matrix).toBeTruthy();
    expect(result.matrix!.p1Labels).toContain('Seismic Toss');
    const sum = (mix: number[]) => mix.reduce((total, p) => total + p, 0);
    expect(sum(result.matrix!.mixes.p1)).toBeCloseTo(1, 6);
    expect(sum(result.matrix!.mixes.p2)).toBeCloseTo(1, 6);

    const trees = Array.from({ length: searchBudget().trees }, (_, offset) =>
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

describe('MCTS koOdds payload (round 7)', () => {
  const settings = { depth: 1, samples: 1, tera: false, mode: 'mcts' } as const;

  test('sync results carry analytic koOdds on boundary rows only', () => {
    const result = mctsSearch(gambleRoot(), settings);
    const pump = result.perSide.p1.find(row => row.choice === 'move hydropump')!;
    const toss = result.perSide.p1.find(row => row.choice === 'move seismictoss')!;
    expect(pump.koOdds).toEqual({ accuracy: expect.closeTo(0.8, 5), killFraction: 1, attacker: expect.any(Object) });
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
    expect(pump.koOdds).toEqual({ accuracy: expect.closeTo(0.8, 5), killFraction: 1, attacker: expect.any(Object) });
  });

  test('root cells carry their outcome classes on boundary cells only, deterministically (rounds 33 and 43)', () => {
    const root = gambleRoot();
    const tree = mctsTreeSearch(root, settings, 1);
    const i = tree.p1Options.findIndex(option => option.choice === 'move hydropump');
    const toss = tree.p1Options.findIndex(option => option.choice === 'move seismictoss');
    const j = tree.p2Options.findIndex(option => option.choice === 'move tackle');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThanOrEqual(0);
    const pump = tree.cells.find(cell => cell.key === cellKey(i, j));
    expect(pump).toBeTruthy();
    // A root boundary cell keeps the class its draw showed as classKey; the tree holds no chance nodes.
    expect(['miss', 'hit-kill', 'hit-nokill']).toContain(pump!.classKey);
    expect(pump!.classes).toBeUndefined();
    const certain = tree.cells.find(cell => cell.key === cellKey(toss, j));
    expect(certain?.classKey).toBeUndefined();
    expect(certain?.classes).toBeUndefined();
    const again = mctsTreeSearch(root, settings, 1);
    const keysOf = (cells: typeof tree.cells) => cells.map(cell => [cell.key, cell.classKey, cell.classes?.map(cls => cls.key)]);
    expect(keysOf(again.cells)).toEqual(keysOf(tree.cells));
  });

  test('only the offset-0 tree pays the boundary-flag scan (the merge reads trees[0])', () => {
    const root = gambleRoot();
    const tree0 = mctsTreeSearch(root, settings, 0);
    const tree1 = mctsTreeSearch(root, settings, 1);
    expect(tree0.boundaryCells?.length ?? 0).toBeGreaterThan(0);
    expect(tree1.boundaryCells).toEqual([]);
  });

  test('doubles rows carry labeled koOdds on uncertain kills only (round 56; fail-closed before)', () => {
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
    const odds = (choice: string) => result.perSide.p1.find(row => row.choice === choice)!.koOdds;
    // the doubles cell plan: a pair option names the slot its odds belong to
    expect(odds('move rockslide, move protect')).toEqual({ accuracy: 0.9, killFraction: 1, label: 'Rock Slide→Pikachu', attacker: expect.any(Object) });
    expect(odds('move karatechop 1, move tackle 2')).toEqual({ accuracy: 1, killFraction: expect.closeTo(1 / 24, 12), label: 'Tackle→Eevee', attacker: expect.any(Object) });
    // Karate Chop kills Eevee on every roll: the Tackle's crit kill on the same Eevee is no headline.
    expect(odds('move karatechop 2, move tackle 2')).toBeUndefined();
    for (const row of result.perSide.p2) expect(row.koOdds).toBeUndefined();
  });

  test('a uniform-outcome mutual-kill cell re-prices to the analytic blend end-to-end', async () => {
    const root = mutualRoot();
    const trees = Array.from({ length: 2 }, (_, offset) => mctsTreeSearch(root, settings, offset));
    const merged = mergeMctsTrees(trees);
    const jobs = starvedSupportCells(trees, merged);
    // Every draw of this cell ends the game: only the boundary bypass
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

describe('eval-mcts-forced-switch', () => {
  function makeSet(name: string, species: string, moves: string[], level = 50): PokemonSet {
    return {
      name, species, item: '', ability: 'No Ability', moves,
      nature: 'Hardy',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level, gender: '',
    };
  }

  function makeBattle(formatid: string, p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
    const battle = new Battle({
      formatid: toID(formatid),
      seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
      p2: { name: 'Beta', team: Teams.pack(p2Sets) },
    });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
      battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
    }
    return battle;
  }

  const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));

  /** Electrode explodes into Snorlax: a certain knock-out of p1's active, bench Pichu and Blissey. */
  const explosionRoot = () => createRootPosition(serialize(makeBattle('gen9customgame',
    [
      makeSet('Electrode', 'Electrode', ['Explosion']),
      makeSet('Pichu', 'Pichu', ['Protect']),
      makeSet('Blissey', 'Blissey', ['Protect']),
    ],
    [makeSet('Snorlax', 'Snorlax', ['Protect', 'Substitute'])],
  )));

  describe('forward model: stop at the forced-switch request (round 42)', () => {
    test('a knock-out halts at the request; the greedy default still reaches the boundary', () => {
      const root = explosionRoot();
      const stopped = advancePositionWithLog(root, 'move explosion', 'move substitute', '1,2,3,4', { stopAtForcedSwitch: true });
      expect(stopped.pendingSwitch).toBe(true);
      expect(stopped.log.some(line => line.startsWith('|faint|p1a'))).toBe(true);
      expect(legalChoices(stopped.child, 'p1').map(option => option.choice)).toEqual(['switch 2', 'switch 3']);
      expect(legalChoices(stopped.child, 'p2')).toEqual([{ choice: 'wait', label: '(waiting)' }]);

      const greedy = advancePositionWithLog(root, 'move explosion', 'move substitute', '1,2,3,4');
      expect(greedy.pendingSwitch).toBe(false);
      expect(positionBattle(greedy.child).turn).toBe(2);

      const resumed = advancePositionWithLog(stopped.child, 'switch 3', 'wait', '1,2,3,4', { stopAtForcedSwitch: true });
      expect(resumed.pendingSwitch).toBe(false);
      const resumedBattle = positionBattle(resumed.child);
      expect(resumedBattle.turn).toBe(2);
      expect(resumedBattle.sides[0].active[0]!.name).toBe('Blissey');
      expect(resumedBattle.sides.every(side => side.requestState === 'move')).toBe(true);
    });

    test('a pivot follow-up is answered before the stop; the knocked-out target then becomes the node', () => {
      const quiet = createRootPosition(serialize(makeBattle('gen9customgame',
        [makeSet('Scyther', 'Scyther', ['U-turn']), makeSet('Pichu', 'Pichu', ['Protect'])],
        [makeSet('Snorlax', 'Snorlax', ['Protect', 'Substitute'])],
      )));
      const quietStep = advancePositionWithLog(quiet, 'move uturn > switch 2', 'move substitute', '1,2,3,4', { stopAtForcedSwitch: true });
      expect(quietStep.pendingSwitch).toBe(false);
      expect(positionBattle(quietStep.child).sides[0].active[0]!.name).toBe('Pichu');
      expect(positionBattle(quietStep.child).turn).toBe(2);

      // Knock-out: the sim asks the pivot side first (answered by the follow-up),
      // then the fallen side; that request stays open as the node.
      const lethal = createRootPosition(serialize(makeBattle('gen9customgame',
        [makeSet('Scyther', 'Scyther', ['U-turn'], 100), makeSet('Pichu', 'Pichu', ['Protect'], 100)],
        [makeSet('Pikachu', 'Pikachu', ['Tackle'], 5), makeSet('Eevee', 'Eevee', ['Tackle'], 5)],
      )));
      const lethalStep = advancePositionWithLog(lethal, 'move uturn > switch 2', 'move tackle', '1,2,3,4', { stopAtForcedSwitch: true });
      expect(lethalStep.pendingSwitch).toBe(true);
      const mid = positionBattle(lethalStep.child);
      expect(mid.sides[0].active[0]!.name).toBe('Pichu');
      expect(legalChoices(lethalStep.child, 'p1')).toEqual([{ choice: 'wait', label: '(waiting)' }]);
      expect(legalChoices(lethalStep.child, 'p2').map(option => option.choice)).toEqual(['switch 2']);
      const done = advancePositionWithLog(lethalStep.child, 'wait', 'switch 2', '1,2,3,4', { stopAtForcedSwitch: true });
      expect(done.pendingSwitch).toBe(false);
      expect(positionBattle(done.child).sides[1].active[0]!.name).toBe('Eevee');
    });
  });

  /** Doubles: Machamp and Snorlax knock out both p2 actives; the bench holds `benchNames`. */
  const doubleKoRoot = (benchNames: string[]) => createRootPosition(serialize(makeBattle('gen9doublescustomgame',
    [
      makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100),
      makeSet('Snorlax', 'Snorlax', ['Seismic Toss', 'Protect'], 100),
    ],
    [
      makeSet('Pikachu', 'Pikachu', ['Tackle'], 30),
      makeSet('Vulpix', 'Vulpix', ['Tackle'], 30),
      ...benchNames.map(name => makeSet(name, name, ['Tackle'], 30)),
    ],
  )));
  const DOUBLE_KO = 'move seismictoss 1, move seismictoss 2';
  const TACKLES = 'move tackle 1, move tackle 1';

  describe('doubles forced switches in the option lists (round 42)', () => {
    test('two forced slots with one replacement offer both pass assignments', () => {
      const stopped = advancePositionWithLog(doubleKoRoot(['Eevee']), DOUBLE_KO, TACKLES, '1,2,3,4', { stopAtForcedSwitch: true });
      expect(stopped.pendingSwitch).toBe(true);
      expect(legalChoices(stopped.child, 'p1')).toEqual([{ choice: 'wait', label: '(waiting)' }]);
      expect(legalChoices(stopped.child, 'p2')).toEqual([
        { choice: 'switch 3, pass', label: '→ Eevee + pass' },
        { choice: 'pass, switch 3', label: 'pass + → Eevee' },
      ]);
      for (const option of legalChoices(stopped.child, 'p2')) {
        const next = advancePositionWithLog(stopped.child, 'wait', option.choice, '1,2,3,4', { stopAtForcedSwitch: true });
        expect(next.pendingSwitch).toBe(false);
        expect(positionBattle(next.child).turn).toBe(2);
      }
    });

    test('two forced slots with two replacements keep the ordered pairs', () => {
      const stopped = advancePositionWithLog(doubleKoRoot(['Eevee', 'Growlithe']), DOUBLE_KO, TACKLES, '1,2,3,4', { stopAtForcedSwitch: true });
      expect(legalChoices(stopped.child, 'p2').map(option => option.choice)).toEqual(['switch 3, switch 4', 'switch 4, switch 3']);
    });

    test('one forced slot beside a living partner still offers the bare switch', () => {
      const root = createRootPosition(serialize(makeBattle('gen9doublescustomgame',
        [makeSet('Machamp', 'Machamp', ['Seismic Toss', 'Protect'], 100), makeSet('Snorlax', 'Snorlax', ['Protect'], 100)],
        [makeSet('Pikachu', 'Pikachu', ['Tackle'], 30), makeSet('Eevee', 'Eevee', ['Tackle'], 30), makeSet('Vulpix', 'Vulpix', ['Tackle'], 30)],
      )));
      const stopped = advancePositionWithLog(root, 'move seismictoss 1, move protect', TACKLES, '1,2,3,4', { stopAtForcedSwitch: true });
      expect(stopped.pendingSwitch).toBe(true);
      expect(legalChoices(stopped.child, 'p2').map(option => option.choice)).toEqual(['switch 3']);
    });
  });

  const SETTINGS = { depth: 1 as const, samples: 1 as const, tera: false as const };

  /** Depth in turns: boundary nodes on the deepest root-to-leaf path (the root counts as one). */
  function boundaryDepth(node: Node): number {
    let deepest = 0;
    for (const child of node.children.values()) deepest = Math.max(deepest, boundaryDepth(child));
    return (node.boundary ? 1 : 0) + deepest;
  }

  function cellChild(root: Node, p1Choice: string, p2Choice: string): Node | undefined {
    const i = root.p1Options.findIndex(option => option.choice === p1Choice);
    const j = root.p2Options.findIndex(option => option.choice === p2Choice);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThanOrEqual(0);
    return root.children.get(cellKey(i, j));
  }

  describe('MCTS: forced switches are decision nodes (round 42)', () => {
    test('singles: the knock-out cell is a mid-turn node with the bench against wait; its children are boundaries', () => {
      const root = mctsRoot(explosionRoot().serialized, SETTINGS);
      expect(root.boundary).toBe(true);
      const mid = cellChild(root, 'move explosion', 'move substitute');
      expect(mid).toBeDefined();
      expect(mid!.boundary).toBe(false);
      expect(mid!.p1Options.map(option => option.choice)).toEqual(['switch 2', 'switch 3']);
      expect(mid!.p2Options).toEqual([{ choice: 'wait', label: '(waiting)' }]);
      expect(mid!.children.size).toBeGreaterThan(0);
      for (const child of mid!.children.values()) expect(child.boundary).toBe(true);
    });

    test('depth counts turns, not plies, and the search is deterministic', () => {
      const serialized = explosionRoot().serialized;
      const stats = mctsTreeSearch(serialized, { ...SETTINGS, mode: 'mcts' }, 0);
      const root = mctsRoot(serialized, { ...SETTINGS, mode: 'mcts' }, 0);
      expect(stats.depth).toBe(boundaryDepth(root));
      const again = mctsRoot(serialized, { ...SETTINGS, mode: 'mcts' }, 0);
      expect({ n: again.p1N, w: again.p1W, n2: again.p2N, w2: again.p2W, visits: again.visits })
        .toEqual({ n: root.p1N, w: root.p1W, n2: root.p2N, w2: root.p2W, visits: root.visits });
    });

    test('doubles: the double knock-out cell is a mid-turn node over the pass assignments', () => {
      const root = mctsRoot(doubleKoRoot(['Eevee']).serialized, SETTINGS);
      const mid = cellChild(root, DOUBLE_KO, TACKLES);
      expect(mid).toBeDefined();
      expect(mid!.boundary).toBe(false);
      expect(mid!.p1Options).toEqual([{ choice: 'wait', label: '(waiting)' }]);
      expect(mid!.p2Options.map(option => option.choice)).toEqual(['switch 3, pass', 'pass, switch 3']);
      for (const child of mid!.children.values()) expect(child.boundary).toBe(true);
    });

    test('root-parallel trees over mid-turn children still merge and rank every root row', () => {
      const serialized = explosionRoot().serialized;
      const trees = [0, 1, 2, 3].map(offset => mctsTreeSearch(serialized, { ...SETTINGS, mode: 'mcts' }, offset));
      const explosionRow = trees[0].p1Options.findIndex(option => option.choice === 'move explosion');
      const explosionCells = trees[0].cells.filter(cell => Math.floor(cell.key / 10_000) === explosionRow);
      expect(explosionCells.length).toBeGreaterThan(0);
      expect(explosionCells.every(cell => cell.ended === false)).toBe(true);
      const merged = mergeMctsTrees(trees);
      expect(merged.perSide.p1.map(row => row.choice).sort()).toEqual(trees[0].p1Options.map(option => option.choice).sort());
      expect(merged.perSide.p2.map(row => row.choice).sort()).toEqual(trees[0].p2Options.map(option => option.choice).sort());
    });
  });
});

describe('mcts starved-support verification (draft t56)', () => {
  test('verification demotes the chance-phantom sack and restores the real punisher order', { timeout: 600000 }, async () => {
    const replay = JSON.parse(readFileSync(new URL('./fixtures/draft-replay.json', import.meta.url), 'utf-8')) as {
      id: string; format: string; formatid?: string; players: string[]; log: string;
    };
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });

    // The app's branch path heals divergence with per-turn snapshot
    // corrections: the same route the user took to stand at turn 56.
    let serialized: string | null = null;
    await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay),
      p1Team, p2Team,
      replayLog: replay.log,
      targetTurn: 57,
      snapshot: snapshots[Math.min(56, snapshots.length - 1)],
      capturePositions: {
        snapshotFor: turn => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null,
        onPosition: (turn, battle) => {
          if (turn === 56 && !battle.ended) serialized = JSON.stringify(State.serializeBattle(battle));
        },
      },
    });
    expect(serialized).toBeTruthy();

    const sleepClause = formatEnforcesSleepClause(getBranchSimulatorFormat(replay));
    const settings = { depth: 1 as const, samples: 1 as const, tera: false, sleepClause, mode: 'mcts' as const };
    const trees = Array.from({ length: searchBudget().trees }, (_, offset) => mctsTreeSearch(serialized!, settings, offset));
    const merged = mergeMctsTrees(trees);

    // The selection must fire here: the support cells carry at most four
    // independent chance outcomes and the Draco column disagrees.
    const jobs = starvedSupportCells(trees, merged);
    expect(jobs.length).toBeGreaterThan(0);

    const values = await createLocalExecutor(serialized!).evalCells(jobs);
    const verified = mergeMctsTrees(trees, new Map(values.map(value => [cellKey(value.i, value.j), value])));

    // The sack is out of the auto-opponent's top picks (unverified it sat
    // second at three thousandths behind the top).
    const p1Top3 = verified.perSide.p1.slice(0, 3).map(entry => entry.label);
    expect(p1Top3).not.toContain('→ Mienshao');

    // p2's phantom Draco inflation stays out: Shadow Ball outranks Draco
    // Meteor (matrix d2s3 reference: 0.535 vs 0.208).
    const p2Labels = verified.perSide.p2.map(entry => entry.label);
    expect(p2Labels.indexOf('Shadow Ball')).toBeLessThan(p2Labels.indexOf('Draco Meteor'));

    expect(verified.score).toBeCloseTo(merged.score, 10);
  });
});
