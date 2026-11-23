import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID, type PokemonSet } from '@pkmn/sim';
import {
  classifyChild,
  foldClassWeights,
  observeOrder,
  planCellEvents,
  koOddsForOptions,
  BOUNDARY_DRAW_BUDGET,
  type CellEvent,
} from '../src/cell-blend';
import { reblendValue, cellKey } from '../src/rank';
import { advancePositionWithLog, createRootPosition, positionBattle, type SimPosition } from '../src/forward-model';
import { createLocalExecutor, searchPosition } from '../src/search';
import { sampleCell } from '../src/search/cell-sampler';
import { createMatchupCache } from '../src/eval-function';
import { searchOrchestrated } from '../src/orchestrator';
import { analyzeTurn } from '../src/analysis';
import { mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees } from '../src/mcts-merge';
import { summarizeTurn } from '../src/summary';
import type { PlayedTurn } from '../src/played';
import type { EvalMatrix, EvalResult, MctsTreeStats, PlannedCell, RankedChoice } from '../src/types';
import { SEARCH_BUDGET_DEFAULT } from '../src/search/budget';
import { cellContribution } from '../src/search/merge-pool';
import { treeSeed } from '../src/search/leaf';
import { doublesRoot, pairSet, anchorRoot, PLAYED, QUIET } from './pair-battles';

function makeSet(name: string, species: string, moves: string[], level = 50, item = '', ability = 'No Ability'): PokemonSet {
  return {
    name, species, item, ability, moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[], formatid = 'gen9customgame'): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
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

const event = (side: 'p1' | 'p2', accuracy: number, killFraction: number, defenderIdent: string): CellEvent => ({
  side, moveId: 'testmove', defenderIdent,
  event: { accuracy, killFraction, pKill: accuracy * killFraction, normalKillRolls: Math.round(killFraction * 16), critKillRolls: Math.round(killFraction * 16) },
});

describe('foldClassWeights', () => {
  test('the t23 shape: kill truncates the second actor', () => {
    // p1 Scald: 100% acc, 43% kill. p2 HJK: 90% acc, 100% kill. p1 first.
    const events = [event('p1', 1, 0.43, 'p2a: Medicham'), event('p2', 0.9, 1, 'p1a: Keldeo')];
    const weights = foldClassWeights(events, 'p1');
    expect(weights.get('hit-kill|none')).toBeCloseTo(0.43, 9);
    expect(weights.get('hit-nokill|hit-kill')).toBeCloseTo(0.57 * 0.9, 9);
    expect(weights.get('hit-nokill|miss')).toBeCloseTo(0.57 * 0.1, 9);
    expect([...weights.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  test('a single accuracy-only event splits hit/miss', () => {
    const weights = foldClassWeights([event('p1', 0.9, 0, 'p2a: Snorlax')], 'p1');
    expect(weights.get('miss')).toBeCloseTo(0.1, 9);
    expect(weights.get('hit-nokill')).toBeCloseTo(0.9, 9);
    expect(weights.has('hit-kill')).toBe(false);
  });
});

describe('classifyChild', () => {
  const events = [event('p1', 1, 0.43, 'p2a: Medicham'), event('p2', 0.9, 1, 'p1a: Keldeo')];
  test('kill before the second move classifies as truncation', () => {
    const key = classifyChild([
      '|move|p1a: Keldeo|Scald|p2a: Medicham',
      '|-damage|p2a: Medicham|0 fnt',
      '|faint|p2a: Medicham',
    ], events);
    expect(key).toBe('hit-kill|none');
  });
  test('survive then hit-kill back', () => {
    const key = classifyChild([
      '|move|p1a: Keldeo|Scald|p2a: Medicham',
      '|-damage|p2a: Medicham|20/100',
      '|move|p2a: Medicham|High Jump Kick|p1a: Keldeo',
      '|-damage|p1a: Keldeo|0 fnt',
      '|faint|p1a: Keldeo',
    ], events);
    expect(key).toBe('hit-nokill|hit-kill');
  });
  test('a miss classifies as miss', () => {
    const key = classifyChild([
      '|move|p1a: Keldeo|Scald|p2a: Medicham',
      '|-damage|p2a: Medicham|20/100',
      '|move|p2a: Medicham|High Jump Kick|p1a: Keldeo',
      '|-miss|p2a: Medicham|p1a: Keldeo',
      '|-damage|p2a: Medicham|1/100',
    ], events);
    expect(key).toBe('hit-nokill|miss');
  });
  test('an unmodeled skip (cant) fails closed', () => {
    expect(classifyChild([
      '|move|p1a: Keldeo|Scald|p2a: Medicham',
      '|-damage|p2a: Medicham|20/100',
      '|cant|p2a: Medicham|par',
    ], events)).toBeNull();
  });
});

describe('observeOrder', () => {
  const events = [event('p1', 1, 0.43, 'p2a: B'), event('p2', 0.9, 1, 'p1a: A')];
  test('a lone mover votes as first (kill truncation)', () => {
    expect(observeOrder([
      ['|move|p1a: A|Scald|p2a: B', '|faint|p2a: B'],
      ['|move|p1a: A|Scald|p2a: B', '|move|p2a: B|HJK|p1a: A'],
    ], events)).toBe('p1');
  });
  test('disagreeing orders fail closed', () => {
    expect(observeOrder([
      ['|move|p1a: A|Scald|p2a: B'],
      ['|move|p2a: B|HJK|p1a: A', '|move|p1a: A|Scald|p2a: B'],
    ], events)).toBeNull();
  });
});

test('reblendValue swaps the first leaf inside its class only', () => {
  const blend = {
    firstLeaf: 1,
    classes: [
      { key: 'hit-nokill', weight: 0.43, leafSum: 2, count: 2, hasFirst: true, ended: false },   // leaves 1, 1
      { key: 'hit-kill', weight: 0.57, leafSum: -1, count: 1, hasFirst: false, ended: true },
    ],
  };
  // Deepened first child: 0.5 → class mean (0.5 + 1)/2 = 0.75.
  expect(reblendValue(blend, 0.5)).toBeCloseTo(0.43 * 0.75 + 0.57 * -1, 9);
});

describe('planCellEvents guards', () => {
  test('a paralyzed attacker fails closed', () => {
    const battle = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Hydro Pump'], 100)],
      [makeSet('Snorlax', 'Snorlax', ['Tackle'], 50)],
    );
    battle.sides[0].active[0]!.status = 'par' as never;
    expect(planCellEvents(battle, 'move hydropump', 'move tackle').kind).toBe('fail');
  });
  test('protect in the pair fails closed', () => {
    const battle = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Hydro Pump'], 100)],
      [makeSet('Snorlax', 'Snorlax', ['Protect'], 50)],
    );
    expect(planCellEvents(battle, 'move hydropump', 'move protect').kind).toBe('fail');
  });
  test('an 80% move yields a plan with one event', () => {
    const battle = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Hydro Pump'], 100)],
      [makeSet('Pikachu', 'Pikachu', ['Tackle'], 30)],
    );
    const plan = planCellEvents(battle, 'move hydropump', 'move tackle');
    expect(plan.kind).toBe('events');
    if (plan.kind === 'events') {
      expect(plan.events).toHaveLength(1);
      expect(plan.events[0].event.accuracy).toBeCloseTo(0.8, 5);
    }
  });
  test('all-deterministic pairs plan none', () => {
    const battle = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Seismic Toss'], 100)],
      [makeSet('Blissey', 'Blissey', ['Seismic Toss'], 100)],
    );
    expect(planCellEvents(battle, 'move seismictoss', 'move seismictoss').kind).toBe('none');
  });
});

test('advancePositionWithLog returns exactly this advance\'s lines', () => {
  const battle = makeBattle(
    [makeSet('Machamp', 'Machamp', ['Seismic Toss'], 100)],
    [makeSet('Pikachu', 'Pikachu', ['Tackle'], 30)],
  );
  const root = createRootPosition(serialize(battle));
  const { log } = advancePositionWithLog(root, 'move seismictoss', 'move tackle', '1,2,3,4');
  expect(log.some(line => line.startsWith('|move|p1a:'))).toBe(true);
  expect(log.some(line => line.startsWith('|start'))).toBe(false); // pre-advance lines excluded
});

test('koOddsForOptions prices the stay-column headline', () => {
  const battle = makeBattle(
    [makeSet('Machamp', 'Machamp', ['Hydro Pump', 'Seismic Toss'], 100)],
    [makeSet('Pikachu', 'Pikachu', ['Tackle'], 30)],
  );
  const [pump, toss] = koOddsForOptions(battle, 'p1', ['move hydropump', 'move seismictoss']);
  expect(pump).toEqual({ accuracy: expect.closeTo(0.8, 5), killFraction: 1, attacker: expect.any(Object) });
  expect(toss).toBeNull(); // fully deterministic — no event
});

// The old probe seeds live in seed-streams.ts; leaf.spec.ts holds their count (eleven) to the lists.
test('the boundary cell draws at most sixteen times', () => {
  expect(BOUNDARY_DRAW_BUDGET).toBe(16);
});

describe('root-cell blend integration', () => {
  // Mutual-OHKO cell with exact ±1 leaves: p1's 80% Hydro Pump always kills
  // on a hit (+1); on a miss the surviving Pikachu's Tackle kills the 1-HP
  // attacker (−1). Analytic value = 0.8·1 + 0.2·(−1) = 0.6 exactly. The
  // fixed base seeds hit only 3/5 (frequency mean 0.2) — the assertion can
  // only pass when the analytic weights price the cell.
  const mutualRoot = () => {
    const battle = makeBattle(
      [makeSet('Deo', 'Deoxys-Speed', ['Hydro Pump', 'Seismic Toss'], 100)],
      [makeSet('Pika', 'Pikachu', ['Tackle', 'Growl'], 30)],
    );
    battle.sides[0].active[0]!.hp = 1;
    return serialize(battle);
  };
  // Full-HP variant: miss children stay alive (non-ended), exercising the
  // deepening re-blend path in both engines.
  const machampRoot = () => serialize(makeBattle(
    [makeSet('Machamp', 'Machamp', ['Hydro Pump', 'Seismic Toss'], 100)],
    [makeSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], 30)],
  ));

  test('the blend classes carry the fold keys (round 33)', () => {
    // The merge pools MCTS trees per outcome class by these keys.
    const battle = makeBattle(
      [makeSet('Deo', 'Deoxys-Speed', ['Hydro Pump', 'Seismic Toss'], 100)],
      [makeSet('Pika', 'Pikachu', ['Tackle', 'Growl'], 30)],
    );
    battle.sides[0].active[0]!.hp = 1;
    const sample = sampleCell(createRootPosition(serialize(battle)), 0, 'move hydropump', 'move tackle', 3, createMatchupCache(), true);
    const plan = planCellEvents(battle, 'move hydropump', 'move tackle');
    expect(plan.kind).toBe('events');
    const expected = foldClassWeights((plan as { events: CellEvent[] }).events, 'p1');
    const keys = sample.blend!.classes.map(cls => cls.key).sort();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect([...expected.keys()]).toContain(key);
  });

  test('a boundary cell prices at analytic weights, not seed frequency', () => {
    const result = searchPosition(mutualRoot(), { depth: 1, samples: 5 });
    const matrix = result.matrix!;
    const i = matrix.p1Choices!.indexOf('move hydropump');
    const j = matrix.p2Choices!.indexOf('move tackle');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThanOrEqual(0);
    expect(matrix.values[i][j]).toBeCloseTo(0.6, 9);
    // Seismic Toss (deterministic KO) still prices as the certain line and
    // outranks the 80% gamble on floor.
    const toss = result.perSide.p1.find(row => row.choice === 'move seismictoss')!;
    const pump = result.perSide.p1.find(row => row.choice === 'move hydropump')!;
    expect(toss.worstCase).toBeCloseTo(1, 9);
    expect(toss.worstCase).toBeGreaterThan(pump.worstCase);
  });

  test('samples:1 still blends at the root (the blend path draws what it needs)', () => {
    const result = searchPosition(mutualRoot(), { depth: 1, samples: 1 });
    const matrix = result.matrix!;
    const i = matrix.p1Choices!.indexOf('move hydropump');
    const j = matrix.p2Choices!.indexOf('move tackle');
    // One base draw hits (+1); the probe chase must find the missing miss
    // class and fold it at its analytic 0.2 — not the 1/3 of a 3-draw mean.
    expect(matrix.values[i][j]).toBeCloseTo(0.6, 9);
    const toss = result.perSide.p1.find(row => row.choice === 'move seismictoss')!;
    const pump = result.perSide.p1.find(row => row.choice === 'move hydropump')!;
    expect(toss.worstCase).toBeGreaterThan(pump.worstCase);
  });

  test('orchestrated parity: the executor path produces the same blended matrix', async () => {
    const serialized = machampRoot();
    const sync = searchPosition(serialized, { depth: 2, samples: 3 });
    const orchestrated = await searchOrchestrated(createLocalExecutor(serialized), { depth: 2, samples: 3 });
    expect(orchestrated.score).toBeCloseTo(sync.score, 9);
    expect(orchestrated.matrix!.values).toEqual(sync.matrix!.values);
    expect(orchestrated.perSide.p1.map(r => [r.choice, r.ev])).toEqual(sync.perSide.p1.map(r => [r.choice, r.ev]));
    expect(orchestrated.koDiagnostics ?? null).toEqual(sync.koDiagnostics ?? null);
  });

  test('ranked options carry koOdds for real boundary events only', () => {
    const result = searchPosition(machampRoot(), { depth: 1, samples: 3 });
    const pump = result.perSide.p1.find(row => row.choice === 'move hydropump')!;
    const toss = result.perSide.p1.find(row => row.choice === 'move seismictoss')!;
    expect(pump.koOdds).toEqual({ accuracy: expect.closeTo(0.8, 5), killFraction: 1, attacker: expect.any(Object) });
    expect(toss.koOdds).toBeUndefined();
  });

  test('the orchestrated path attaches identical koOdds', async () => {
    const orchestrated = await searchOrchestrated(createLocalExecutor(machampRoot()), { depth: 1, samples: 3 });
    const pump = orchestrated.perSide.p1.find(row => row.choice === 'move hydropump')!;
    expect(pump.koOdds).toEqual({ accuracy: expect.closeTo(0.8, 5), killFraction: 1, attacker: expect.any(Object) });
  });
});

const options = (choices: string[]) => choices.map(choice => ({ choice, label: choice }));
const emptyResult: EvalResult = { score: 0, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } };
const mk = (p1: string[], p2: string[], cells: MctsTreeStats['cells'], extra: Partial<MctsTreeStats> = {}): MctsTreeStats => ({
  p1Options: options(p1), p2Options: options(p2),
  p1N: p1.map(() => 5), p1W: p1.map(() => 1), p2N: p2.map(() => 5), p2W: p2.map(() => 1),
  visits: 10, depth: 2, rootValue: 0.1, cells, result: emptyResult, ...extra,
});
const cell = (i: number, j: number, visits: number) => ({ key: cellKey(i, j), visits, total: 0.1 * visits, value: 0.1, ended: false });

describe('the merge copies the planner answer of the offset-0 tree into the matrix cells', () => {
  const planned: PlannedCell[] = [
    { key: cellKey(0, 0), plan: 'events', classes: [{ key: 'hit-nokill', weight: 0.7 }, { key: 'miss', weight: 0.3 }] },
    { key: cellKey(0, 1), plan: 'none' },
    // (1, 0) is missing from the list: the planner failed there.
    { key: cellKey(1, 1), plan: 'none' },
  ];

  test('singles: events carry classes summing to 1, none carries none, a missing cell reads fail', () => {
    const p1 = ['move thunder', 'switch 2'];
    const p2 = ['move seismictoss', 'switch 2'];
    const t1 = mk(p1, p2, [cell(0, 0, 8), cell(0, 1, 6), cell(1, 0, 4), cell(1, 1, 3)], { boundaryCells: [cellKey(0, 0)], plannedCells: planned });
    const t2 = mk(p1, p2, [cell(0, 0, 8), cell(0, 1, 6), cell(1, 0, 4), cell(1, 1, 3)], { boundaryCells: [] });
    const cells = mergeMctsTrees([t1, t2]).matrix!.cells!;
    expect(cells[0][0]).toMatchObject({ visits: 16, plan: 'events' });
    expect(cells[0][0].classes!.map(entry => entry.key)).toEqual(['hit-nokill', 'miss']);
    expect(cells[0][0].classes!.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1, 12);
    expect(cells[0][1].plan).toBe('none');
    expect(cells[0][1].classes).toBeUndefined();
    expect(cells[1][0].plan).toBe('fail');
    expect(cells[1][0].classes).toBeUndefined();
    expect(cells[1][1].plan).toBe('none');
  });

  test('doubles: a tree that ships no list leaves plan and classes off the cells (the plan gives up there)', () => {
    const p1 = ['move a 1, move b', 'switch 3, move b'];
    const p2 = ['move x, move y 2', 'move x, switch 3'];
    const t1 = mk(p1, p2, [cell(0, 0, 8), cell(1, 1, 3)]);
    const t2 = mk(p1, p2, [cell(0, 0, 4)]);
    const cells = mergeMctsTrees([t1, t2]).matrix!.cells!;
    for (const entry of cells.flat()) {
      expect(entry.plan).toBeUndefined();
      expect(entry.classes).toBeUndefined();
    }
    expect(cells[0][0].visits).toBe(12);
  });
});

describe('a real singles search ships the planner answer of every root cell', () => {
  const set = (name: string, species: string, moves: string[]): PokemonSet => ({
    name, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
  });
  const serialized = (): string => {
    const sim = new Battle({
      formatid: toID('gen9customgame'), seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack([set('Jolt', 'Jolteon', ['Thunder', 'Thunderbolt']), set('Lax', 'Snorlax', ['Body Slam'])]) },
      p2: { name: 'Beta', team: Teams.pack([set('Champ', 'Machamp', ['Seismic Toss', 'Dynamic Punch']), set('Egg', 'Chansey', ['Soft-Boiled'])]) },
    });
    if (sim.sides.some(side => side.requestState === 'teampreview')) { sim.choose('p1', 'team 12'); sim.choose('p2', 'team 12'); }
    return JSON.stringify(State.serializeBattle(sim));
  };

  test('plan and classes of each cell equal what planCellEvents and foldClassWeights answer', () => {
    const state = serialized();
    const stats = mctsTreeSearch(state, { depth: 1, samples: 1, tera: false, mode: 'mcts', prove: false }, 0);
    const battle = positionBattle(createRootPosition(state));
    const cells = mergeMctsTrees([stats]).matrix!.cells!;
    const seen = { none: 0, events: 0, fail: 0, twoEvents: 0 };
    for (let i = 0; i < stats.p1Options.length; i++) {
      for (let j = 0; j < stats.p2Options.length; j++) {
        const plan = planCellEvents(battle, stats.p1Options[i].choice, stats.p2Options[j].choice);
        expect(cells[i][j].plan).toBe(plan.kind);
        seen[plan.kind]++;
        if (plan.kind !== 'events') {
          expect(cells[i][j].classes).toBeUndefined();
          continue;
        }
        const wanted = (first: 'p1' | 'p2') => [...foldClassWeights(plan.events, first)]
          .map(([key, weight]) => ({ key, weight })).sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : 1));
        const got = cells[i][j].classes!;
        expect(got.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1, 12);
        if (plan.events.length === 1) {
          expect(got).toEqual(wanted(plan.events[0].side));
        } else {
          seen.twoEvents++;
          // Two events fold in the order the simulator showed: one of the two orders is the answer.
          expect([wanted('p1'), wanted('p2')]).toContainEqual(got);
        }
      }
    }
    // The position has a rolled cell, a two-event cell and deterministic cells, or the test proves nothing.
    expect(seen.events).toBeGreaterThan(0);
    expect(seen.twoEvents).toBeGreaterThan(0);
    expect(seen.none).toBeGreaterThan(0);
  });
});

describe('the report reads the played cell when the turn has no protocol', () => {
  const row = (choice: string, label: string, ev: number): RankedChoice =>
    ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: null });
  const names: [string, string] = ['Alpha', 'Beta'];

  // Round 70 (T217): a plain cell holding a move with a secondary effect under 100% (Thunder's paralysis) gives no answer;
  // these cases keep Hydro Pump, which has none (luck-unpriced-t217.spec.ts pins the rest).
  const single = (cellOf: NonNullable<EvalMatrix['cells']>[number][number]): { result: EvalResult; played: PlayedTurn } => ({
    result: {
      score: 0.05, interval: 0.02, depthCompleted: 1,
      perSide: { p1: [row('move hydropump', 'Hydro Pump', 0.05)], p2: [row('move seismictoss', 'Seismic Toss', -0.05)] },
      matrix: {
        p1Labels: ['Hydro Pump'], p2Labels: ['Seismic Toss'], p1Choices: ['move hydropump'], p2Choices: ['move seismictoss'],
        values: [[0.05]], mixes: { p1: [1], p2: [1] }, cells: [[cellOf]],
      },
    },
    played: { p1: { kind: 'move', name: 'Hydro Pump', tera: false }, p2: { kind: 'move', name: 'Seismic Toss', tera: false } },
  });
  const turn = (result: EvalResult, played: PlayedTurn) => analyzeTurn({
    turn: 4, result, played, playedOutcome: 0.05, scoreBefore: 0.05, scoreAfter: 0.25, actives: { p1: null, p2: null, gen: 9 },
  });
  const ROLL = { visits: 20, verified: false, plan: 'events' as const, classes: [{ key: 'hit-nokill', weight: 0.7 }, { key: 'miss', weight: 0.3 }] };
  const DETERMINISTIC = { visits: 20, verified: false, plan: 'none' as const };

  test('singles: a cell with a priced roll says the turn rolled, a deterministic cell says the estimate moved with no roll behind it', () => {
    const rolled = single(ROLL);
    const reRead = single(DETERMINISTIC);
    const rolledCard = turn(rolled.result, rolled.played);
    const reReadCard = turn(reRead.result, reRead.played);
    expect(rolledCard.rolledFor).toEqual({ p1: true, p2: true });
    expect(reReadCard.rolledFor).toEqual({ p1: false, p2: false });
    expect(summarizeTurn(rolledCard, names)).toContain('how the turn rolled');
    expect(summarizeTurn(reReadCard, names)).toContain('with no roll behind it');
    expect(summarizeTurn(reReadCard, names)).not.toContain('how the turn rolled');
  });

  test('a cell without a plan answer keeps the ungated reading (no rolledFor)', () => {
    for (const cellOf of [{ visits: 20, verified: false }, { visits: 20, verified: false, plan: 'fail' as const }]) {
      const fixture = single(cellOf);
      expect(turn(fixture.result, fixture.played).rolledFor).toBeUndefined();
    }
  });

  test('a one-class cell is no roll', () => {
    const fixture = single({ visits: 20, verified: false, plan: 'events', classes: [{ key: 'hit-nokill', weight: 1 }] });
    expect(turn(fixture.result, fixture.played).rolledFor).toEqual({ p1: false, p2: false });
  });

  test('doubles: a cell without a plan answer keeps the log reading (equal to the result without cells)', () => {
    const doubles = {
      result: {
        score: 0.05, interval: 0.02, depthCompleted: 1,
        perSide: {
          p1: [row('move thunder, move protect', 'Thunder + Protect', 0.05)],
          p2: [row('move seismictoss 1, move protect', 'Seismic Toss→Jolt + Protect', -0.05)],
        },
        matrix: {
          p1Labels: ['Thunder + Protect'], p2Labels: ['Seismic Toss→Jolt + Protect'],
          p1Choices: ['move thunder, move protect'], p2Choices: ['move seismictoss 1, move protect'],
          values: [[0.05]], mixes: { p1: [1], p2: [1] }, cells: [[{ visits: 20, verified: false }]],
        },
      } satisfies EvalResult,
      played: {
        p1: null, p2: null,
        p1Slots: [{ kind: 'move', name: 'Thunder', targetLoc: null }, { kind: 'move', name: 'Protect', targetLoc: null }],
        p2Slots: [{ kind: 'move', name: 'Seismic Toss', targetLoc: 1 }, { kind: 'move', name: 'Protect', targetLoc: null }],
      } satisfies PlayedTurn,
    };
    const withCells = turn(doubles.result, doubles.played);
    const without = turn({ ...doubles.result, matrix: { ...doubles.result.matrix, cells: undefined } }, doubles.played);
    expect(withCells.rolledFor).toBeUndefined();
    expect(summarizeTurn(withCells, names)).toBe(summarizeTurn(without, names));
  });
});

const cache = createMatchupCache();
const SETTINGS = { depth: 1 as const, samples: 1 as const, tera: false as const, mode: 'mcts' as const, prove: false };

const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
});

/** Two Jolteon at 1 HP and equal speed with a bench each, so no class ends the game. */
function thunderTie(setup: (battle: Battle) => void = () => {}): SimPosition {
  const battle = new Battle({
    formatid: toID('gen9customgame'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack([set('Jolteon', ['Thunder']), set('Snorlax', ['Body Slam'])]) },
    p2: { name: 'Beta', team: Teams.pack([set('Jolteon', ['Thunder']), set('Chansey', ['Soft-Boiled'])]) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 12');
    battle.choose('p2', 'team 12');
  }
  for (const side of battle.sides) side.active[0]!.sethp(1);
  setup(battle);
  return createRootPosition(JSON.stringify(State.serializeBattle(battle)));
}

// Round 86 (T323): a tree's seed hashes (offset, iteration), so the seeds a root cell can draw are the ones of the iterations
// that can first visit it; a board of a few options reaches every cell within these.
const FIRST_VISITS = 40;

/**
 * The keys the simulator gives the cell over the seeds a tree of this offset can draw it with (the iteration that
 * first reaches the cell is not fixed): the first mover's side and the class of the log, as the sampler writes them.
 */
function drawnKeys(root: SimPosition, p1: string, p2: string, offset: number): Set<string> {
  const plan = planCellEvents(positionBattle(root), p1, p2);
  if (plan.kind !== 'events') throw new Error('the cell has no class plan');
  const keys = new Set<string>();
  for (let iteration = 0; iteration < FIRST_VISITS; iteration++) {
    const { log } = advancePositionWithLog(root, p1, p2, treeSeed(iteration, offset));
    const first = log.find(line => line.startsWith('|move|'))!.startsWith('|move|p1a:') ? 'p1' : 'p2';
    keys.add(`${first}:${classifyChild(log, plan.events)}`);
  }
  return keys;
}

describe('tree class keys of a tied cell (T146 c5)', () => {
  test('singles: a tree names the order it drew, and the key is one of the sampler classes', () => {
    const root = thunderTie();
    const [p1, p2] = ['move thunder', 'move thunder'];
    const sampled = sampleCell(root, 0, p1, p2, 3, cache, true).blend!.classes.map(cls => cls.key);
    const orders = new Set<string>();
    for (let offset = 0; offset < 12; offset++) {
      const stats = mctsTreeSearch(root.serialized, SETTINGS, offset);
      const i = stats.p1Options.findIndex(option => option.choice === p1);
      const j = stats.p2Options.findIndex(option => option.choice === p2);
      const cell = stats.cells.find(entry => entry.key === cellKey(i, j))!;
      expect(cell.classKey).toBeDefined();
      // Round 89 (#59): a tree inside the budget's tree count (0 to 3) answers the dice of its root draw by quantile, so the class
      // it books may be one the stream's seeds never show (a 0.09 class in forty iterations); the sampler's classes bound it.
      if (offset >= SEARCH_BUDGET_DEFAULT.trees) expect(drawnKeys(root, p1, p2, offset)).toContain(cell.classKey);
      expect(sampled).toContain(cell.classKey);
      // The merge's pool for the sampler class of that key joins this tree.
      expect(cellContribution(cell, cell.classKey, false)).not.toBeNull();
      orders.add(cell.classKey!.slice(0, 2));
    }
    expect(orders).toEqual(new Set(['p1', 'p2']));
  });

  test('singles: a pair without a tie keeps its bare class key', () => {
    const root = thunderTie(battle => { battle.sides[0].active[0]!.boosts.spe = 1; });
    const [p1, p2] = ['move thunder', 'move thunder'];
    const sampled = sampleCell(root, 0, p1, p2, 3, cache, true).blend!.classes.map(cls => cls.key);
    const stats = mctsTreeSearch(root.serialized, SETTINGS, 0);
    const i = stats.p1Options.findIndex(option => option.choice === p1);
    const j = stats.p2Options.findIndex(option => option.choice === p2);
    const cell = stats.cells.find(entry => entry.key === cellKey(i, j))!;
    expect(cell.classKey).toBeDefined();
    expect(cell.classKey).not.toMatch(/^p[12]:/);
    expect(sampled).toContain(cell.classKey);
  });

  test('doubles: a tied pair has no analytic plan, so the tree records no class key', () => {
    const mon = () => pairSet('Jolt', 'Jolteon', ['Thunder'], { level: 100 });
    const root = doublesRoot([mon(), pairSet('Lax', 'Snorlax', ['Body Slam'])], [mon(), pairSet('Egg', 'Chansey', ['Soft-Boiled'])]);
    const stats = mctsTreeSearch(root.serialized, SETTINGS, 0);
    expect(stats.cells.length).toBeGreaterThan(0);
    expect(stats.cells.every(cell => cell.classKey === undefined)).toBe(true);
  });
});

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

describe('kill odds for doubles options (round 56)', () => {
  test('the played pair names its slot: Play Rough on Incineroar, a 90 % roll that kills', () => {
    const [odds] = koOddsForOptions(positionBattle(anchorRoot()), 'p1', [PLAYED[0]]);
    expect(odds).toEqual({ accuracy: 0.9, killFraction: 1, label: 'Play Rough→Incineroar', attacker: expect.any(Object) });
  });

  test('a foe the partner kills for sure carries no odds for the other slot', () => {
    // Karate Chop kills the level-30 Eevee on every roll, so Snorlax's crit-only Tackle kill on the same
    // Eevee says nothing about whether it lives; next to a Karate Chop on Pikachu the Tackle keeps its odds.
    const root = doublesRoot(
      [pairSet('Machamp', 'Machamp', ['Rock Slide', 'Karate Chop']), pairSet('Snorlax', 'Snorlax', ['Tackle', 'Protect'])],
      [pairSet('Pikachu', 'Pikachu', ['Tackle', 'Growl'], { level: 30 }), pairSet('Eevee', 'Eevee', ['Tackle', 'Growl'], { level: 30 })],
    );
    const [focus, split] = koOddsForOptions(positionBattle(root), 'p1', ['move karatechop 2, move tackle 2', 'move karatechop 1, move tackle 2']);
    expect(focus).toBeNull();
    expect(split).toEqual({ accuracy: 1, killFraction: expect.closeTo(1 / 24, 12), label: 'Tackle→Eevee', attacker: expect.any(Object) });
  });

  test('Earthquake beside a living partner is a spread hit even against one foe (final review, finding 2)', () => {
    // The sim counts Zapdos among Earthquake's targets at the start (spreadHit, 0.75): 91 to 108 against
    // Snorlax's 114 HP, only a crit (136 to 162) kills. Priced single-target, every roll (121 to 144) would.
    const root = doublesRoot(
      [pairSet('Chomp', 'Garchomp', ['Earthquake', 'Protect']), pairSet('Bird', 'Zapdos', ['Roost', 'Protect'])],
      [pairSet('Lax', 'Snorlax', ['Rest', 'Protect']), pairSet('Gone', 'Pikachu', ['Protect'])],
      battle => {
        battle.sides[1].active[1]!.faint();
        battle.resolveFaints();
        battle.sides[1].active[0]!.sethp(114);
      },
    );
    const [quake] = koOddsForOptions(positionBattle(root), 'p1', ['move earthquake, move roost']);
    expect(quake).toEqual({ accuracy: 1, killFraction: expect.closeTo(1 / 24, 12), label: 'Earthquake→Snorlax', attacker: expect.any(Object) });
  });

  test('a pair without an uncertain kill carries no odds', () => {
    const [odds] = koOddsForOptions(positionBattle(anchorRoot()), 'p1', [QUIET[0]]);
    expect(odds).toBeNull();
  });

  test('a singles option keeps its odds without a label', () => {
    const battle = new Battle({
      formatid: toID('gen9customgame'), seed: '1,2,3,4',
      p1: { name: 'A', team: Teams.pack([pairSet('Jolt', 'Jolteon', ['Thunder'])]) },
      p2: { name: 'B', team: Teams.pack([pairSet('Champ', 'Machamp', ['Close Combat'])]) },
    });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', 'team 1');
      battle.choose('p2', 'team 1');
    }
    battle.sides[1].active[0]!.sethp(1);
    const [odds] = koOddsForOptions(positionBattle(createRootPosition(JSON.stringify(State.serializeBattle(battle)))), 'p1', ['move thunder']);
    expect(odds).toEqual({ accuracy: 0.7, killFraction: 1, attacker: expect.any(Object) });
    expect(odds && 'label' in odds).toBe(false);
  });

  test('the true-odds note names the slot the label carries', () => {
    // The singles-shaped result of eval-summary.spec.ts, with a doubles label on the odds: the label replaces the option's name.
    const punished: EvalResult = {
      score: 0.1, interval: 0.05, depthCompleted: 2,
      perSide: {
        p1: [choice('move dracometeor', 'Draco Meteor', 0.2)],
        p2: [
          choice('switch 3', '→ Dragapult', -0.05),
          { ...choice('move scald', 'Scald', -0.3), koOdds: { accuracy: 1, killFraction: 0.43, label: 'Scald→Garchomp' }, punishedBy: 'Draco Meteor' },
        ],
      },
    };
    const summary = summarizeTurn(analyzeTurn({
      turn: 23,
      result: punished,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Scald', tera: false } },
      playedOutcome: 0.0,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    }), ['Alpha', 'Beta']);
    expect(summary).toContain('(True odds: Scald→Garchomp kills ~43% of the time.)');
  });
});
