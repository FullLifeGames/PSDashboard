import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/dex';
import { logRules } from '@fulllifegames/replay-core';
import { toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { analyzeTurn } from '../src/analysis';
import { rolledFromCell } from '../src/turn-analysis/luck';
import { summarizeTurn } from '../src/summary';
import type { PlayedTurn } from '../src/played';
import type { EvalMatrix, EvalResult, RankedChoice } from '../src/types';
import { battleOf } from './power-oracle';

/**
 * Round 70 (T217, review finding 4 of round 69): a cell the planner calls "none" has no PRICED roll. The planner prices the
 * accuracy and the kill range of a hit; Body Slam's paralysis, Scald's burn, Earth Power's drop and every other secondary
 * effect with a chance under 100 sit in a "none" cell and may have rolled. A turn without its protocol used to read such a cell
 * as "nothing rolled" and the card said the engine re-read the position. Now the cell reads "no priced roll" when a move of the
 * played pair carries such an effect: no answer, so the sentences keep their ungated wording. The chance is read from the Dex.
 */

const row = (choice: string, label: string, ev: number): RankedChoice => ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: null });
const names: [string, string] = ['Alpha', 'Beta'];

type Cell = NonNullable<EvalMatrix['cells']>[number][number];
const NONE: Cell = { visits: 20, verified: false, plan: 'none' };
const ONE_CLASS: Cell = { visits: 20, verified: false, plan: 'events', classes: [{ key: 'hit-nokill', weight: 1 }] };
const ROLL: Cell = { visits: 20, verified: false, plan: 'events', classes: [{ key: 'hit-nokill', weight: 0.7 }, { key: 'miss', weight: 0.3 }] };

/** A one-row singles turn: p1 clicked `p1Move`, p2 clicked `p2Move`, the played cell is `cell`. */
function singlesTurn(p1Move: string, p2Move: string, cell: Cell) {
  const p1Id = `move ${toID(p1Move)}`;
  const p2Id = `move ${toID(p2Move)}`;
  const result: EvalResult = {
    score: 0.05, interval: 0.02, depthCompleted: 1,
    perSide: { p1: [row(p1Id, p1Move, 0.05)], p2: [row(p2Id, p2Move, -0.05)] },
    matrix: { p1Labels: [p1Move], p2Labels: [p2Move], p1Choices: [p1Id], p2Choices: [p2Id], values: [[0.05]], mixes: { p1: [1], p2: [1] }, cells: [[cell]] },
  };
  const played: PlayedTurn = { p1: { kind: 'move', name: p1Move, tera: false }, p2: { kind: 'move', name: p2Move, tera: false } };
  return analyzeTurn({ turn: 4, result, played, playedOutcome: 0.05, scoreBefore: 0.05, scoreAfter: 0.3, actives: { p1: null, p2: null, gen: 9 } });
}

/** The doubles twin: both sides click two moves (`p1Moves`, `p2Moves`), the played cell is `cell`. */
function doublesTurn(p1Moves: [string, string], p2Moves: [string, string], cell: Cell) {
  const id = (moves: [string, string]) => moves.map(move => `move ${toID(move)}`).join(', ');
  const label = (moves: [string, string]) => moves.join(' + ');
  const result: EvalResult = {
    score: 0.05, interval: 0.02, depthCompleted: 1,
    perSide: { p1: [row(id(p1Moves), label(p1Moves), 0.05)], p2: [row(id(p2Moves), label(p2Moves), -0.05)] },
    matrix: {
      p1Labels: [label(p1Moves)], p2Labels: [label(p2Moves)], p1Choices: [id(p1Moves)], p2Choices: [id(p2Moves)],
      values: [[0.05]], mixes: { p1: [1], p2: [1] }, cells: [[cell]],
    },
  };
  const slots = (moves: [string, string]) => moves.map(name => ({ kind: 'move' as const, name, targetLoc: null }));
  const played: PlayedTurn = { p1: null, p2: null, p1Slots: slots(p1Moves), p2Slots: slots(p2Moves) };
  return analyzeTurn({ turn: 4, result, played, playedOutcome: 0.05, scoreBefore: 0.05, scoreAfter: 0.3, actives: { p1: null, p2: null, gen: 9 } });
}

describe('singles: a plain cell with an unpriced secondary effect is "no priced roll", not "nothing rolled"', () => {
  test('Body Slam and Scald (30% paralysis, 30% burn) in a plain cell give no answer (red before: nothing rolled)', () => {
    for (const move of ['Body Slam', 'Scald']) {
      expect(singlesTurn(move, 'Seismic Toss', NONE).rolledFor).toBeUndefined();
      // The opposing click counts as much as the own one.
      expect(singlesTurn('Seismic Toss', move, NONE).rolledFor).toBeUndefined();
    }
  });

  test('the card keeps its ungated wording there, and names the engine\'s re-read where the pair holds no such effect', () => {
    const undecided = summarizeTurn(singlesTurn('Body Slam', 'Seismic Toss', NONE), names);
    expect(undecided).toContain('how the turn rolled');
    expect(undecided).not.toContain('the engine re-read the position');
    const plain = singlesTurn('Hydro Pump', 'Seismic Toss', NONE);
    expect(plain.rolledFor).toEqual({ p1: false, p2: false });
    expect(summarizeTurn(plain, names)).toContain('the engine re-read the position');
  });

  test('a secondary at 100% is no roll (Power-Up Punch, Flame Charge): the plain cell still rolled nothing', () => {
    for (const move of ['Power-Up Punch', 'Flame Charge']) {
      expect(singlesTurn(move, 'Seismic Toss', NONE).rolledFor).toEqual({ p1: false, p2: false });
    }
  });

  test('a one-class cell holding such a move gives no answer; a cell with a priced roll says the turn rolled either way', () => {
    expect(singlesTurn('Body Slam', 'Seismic Toss', ONE_CLASS).rolledFor).toBeUndefined();
    expect(singlesTurn('Hydro Pump', 'Seismic Toss', ONE_CLASS).rolledFor).toEqual({ p1: false, p2: false });
    expect(singlesTurn('Body Slam', 'Seismic Toss', ROLL).rolledFor).toEqual({ p1: true, p2: true });
  });

  test('a switch holds no move: the plain cell of a switch against Seismic Toss rolled nothing', () => {
    const result: EvalResult = {
      score: 0.05, interval: 0.02, depthCompleted: 1,
      perSide: { p1: [row('switch 2', '→ Clefable', 0.05)], p2: [row('move seismictoss', 'Seismic Toss', -0.05)] },
      matrix: { p1Labels: ['→ Clefable'], p2Labels: ['Seismic Toss'], p1Choices: ['switch 2'], p2Choices: ['move seismictoss'], values: [[0.05]], mixes: { p1: [1], p2: [1] }, cells: [[NONE]] },
    };
    const played: PlayedTurn = { p1: { kind: 'switch', name: 'Clefable', species: 'Clefable' }, p2: { kind: 'move', name: 'Seismic Toss', tera: false } };
    expect(analyzeTurn({ turn: 4, result, played, playedOutcome: 0.05, scoreBefore: 0.05, scoreAfter: 0.3, actives: { p1: null, p2: null, gen: 9 } }).rolledFor).toEqual({ p1: false, p2: false });
  });
});

describe('doubles: the same reading per slot', () => {
  test('a plain cell of a pair holding Body Slam or Scald gives no answer, a pair without such a move rolled nothing', () => {
    expect(doublesTurn(['Body Slam', 'Protect'], ['Seismic Toss', 'Protect'], NONE).rolledFor).toBeUndefined();
    expect(doublesTurn(['Protect', 'Protect'], ['Seismic Toss', 'Scald'], NONE).rolledFor).toBeUndefined();
    expect(doublesTurn(['Hydro Pump', 'Protect'], ['Seismic Toss', 'Protect'], NONE).rolledFor).toEqual({ p1: false, p2: false });
  });

  test('a cell with a priced roll says the turn rolled', () => {
    expect(doublesTurn(['Body Slam', 'Protect'], ['Seismic Toss', 'Protect'], ROLL).rolledFor).toEqual({ p1: true, p2: true });
  });
});

describe('the chance is read from the Dex, and the Dex agrees with the simulator', () => {
  const unpriced = (moveId: string): boolean => rolledFromCell(NONE, [moveId], logRules('')) === undefined;

  test('every Dex move with a secondary effect under 100% is unpriced, every move without one is not (a sweep, no names)', () => {
    const moves = Dex.moves.all().filter(move => move.exists && !move.isMax && !move.isZ && move.gen <= 9);
    const chancy = (move: (typeof moves)[number]) => (move.secondaries ?? (move.secondary ? [move.secondary] : [])).some(effect => (effect.chance ?? 100) < 100);
    expect(moves.filter(chancy).length).toBeGreaterThan(100);
    for (const move of moves) expect(`${move.id} ${unpriced(move.id)}`).toBe(`${move.id} ${chancy(move)}`);
  });

  /** Over 40 seeds a Snorlax uses `moveId` on a Blissey: whether the target got the status in some seeds and not in others. */
  function statusSeeds(moveId: string): number {
    const set = (species: string, moves: string[]): PokemonSet => ({
      name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
      evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
    });
    let hits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const battle = battleOf('gen9customgame', [set('Snorlax', [moveId, 'splash'])], [set('Blissey', ['splash'])], `${seed},2,3,4`);
      battle.choose('p1', 'move 1');
      battle.choose('p2', 'move 1');
      if (battle.sides[1].active[0]!.status) hits++;
    }
    return hits;
  }

  test.each(['bodyslam', 'scald', 'thunder'])('%s: the simulator gives the status in some seeds and not in others', moveId => {
    expect(unpriced(moveId)).toBe(true);
    const hits = statusSeeds(moveId);
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(40);
  });

  test('a move that never rolls an effect gives it in none or in every seed', () => {
    expect(unpriced('earthquake')).toBe(false);
    expect(statusSeeds('earthquake')).toBe(0);
  });
});
