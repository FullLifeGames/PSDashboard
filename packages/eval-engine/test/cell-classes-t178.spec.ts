import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { analyzeTurn } from '../src/analysis';
import { foldClassWeights, planCellEvents } from '../src/cell-blend';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees } from '../src/mcts-merge';
import { cellKey } from '../src/rank';
import { summarizeTurn } from '../src/summary';
import type { PlayedTurn } from '../src/played';
import type { EvalMatrix, EvalResult, MctsTreeStats, PlannedCell, RankedChoice } from '../src/types';

/**
 * Round 69 (T178, spec decision 24): the result carries the planner's answer for each matrix cell (none, events,
 * fail) and the outcome classes of a rolled cell, next to the visits and the verified flag of T64. The classes come
 * from planCellEvents and foldClassWeights (read only); the merge stays sim-free and copies what the offset-0 tree
 * shipped. A turn without its protocol takes "rolled" from the played cell's classes; a doubles cell without a plan answer
 * (the tree plans only the played row and column since round 70, T217: pair-root-plan-t217.spec.ts) keeps the log reading.
 */

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
