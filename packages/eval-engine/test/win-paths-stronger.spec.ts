import { describe, expect, test } from 'vitest';
import { proveForcedWin } from '../src/endgame/prover';
import { strongerStep } from '../src/endgame/win-paths/stronger';
import { mon, playLine, REQUEST, serializedBoard, won, type Board } from './win-paths-support';

/**
 * Round 89 (#130), step G7a: a stronger play. The side that lost may pick any choice at the turn; the opponent answers with its best
 * reply (every legal choice). The step reads the mass the prover proves for each own choice (the share of the dice that win within
 * the turns asked, whatever the opponent answers), against the mass of the choice that was played. Boards are small custom games:
 * every number is one the simulator shows there.
 */

/**
 * A faster Pikachu at 1 HP against a Snorlax at 30 HP whose Tackle never misses: only Seismic Toss (fixed 50) wins, this turn, before the
 * Tackle; any other choice loses at once, so no later turn can rescue the first three candidates.
 */
const FOURTH: Board = {
  format: 'gen9customgame',
  p1: [mon('Pikachu', ['Splash', 'Growl', 'Harden', 'Seismic Toss'])],
  p2: [mon('Snorlax', ['Tackle'])],
  prepare: battle => { battle.sides[0].pokemon[0].hp = 1; battle.sides[1].pokemon[0].hp = 30; },
};
const RANKING = ['move splash', 'move growl', 'move harden', 'move seismictoss'];

/** High Jump Kick (90) against a faster Hydro Pump (80), both at 1 HP: the proof's mass is the chance the foe misses first. */
const COIN: Board = {
  format: 'gen9customgame',
  p1: [mon('Snorlax', ['High Jump Kick'])],
  p2: [mon('Pikachu', ['Hydro Pump'])],
  prepare: battle => { battle.sides[0].pokemon[0].hp = 1; battle.sides[1].pokemon[0].hp = 1; },
};

const proof = (serialized: string, rootOrder: string[]) => proveForcedWin(serialized, { side: 'p1', rootOrder, tera: false });

describe('a stronger play, singles', () => {
  test('a winner the ranking lists fourth is found: the production prover tries three', async () => {
    const { serialized } = await serializedBoard(FOURTH);
    expect(proof(serialized, RANKING).mass, 'today: the first three candidates never win').toBe(0);
    const step = strongerStep(serialized, REQUEST('p1', { rootOrder: RANKING, played: 'move splash' }));
    expect(step.status).toBe('found');
    expect(step.chance).toBe(1);
    expect(step.played).toBe(0);
    expect(step.line!.choice).toBe('move seismictoss');
    expect(step.line!.label).toBe('Seismic Toss');
  }, 120_000);

  test('the played choice that is already the best leaves nothing stronger', async () => {
    const { serialized } = await serializedBoard(FOURTH);
    const step = strongerStep(serialized, REQUEST('p1', { rootOrder: RANKING, played: 'move seismictoss' }));
    expect(step.status).toBe('none');
    expect(step.played).toBe(1);
    expect(step.chance).toBe(1);
  }, 120_000);

  test('a best choice under one half reads its mass: today the prover reads 0 below the floor', async () => {
    const { serialized } = await serializedBoard(COIN);
    expect(proof(serialized, ['move highjumpkick']).mass, 'today: a mass below one half reads 0').toBe(0);
    const step = strongerStep(serialized, REQUEST('p1', { rootOrder: ['move highjumpkick'] }));
    expect(step.status).toBe('found');
    // the foe misses (one in five) and High Jump Kick hits (nine in ten), and again on the later turns the path may take
    expect(step.chance).toBeGreaterThanOrEqual(0.2 * 0.9 - 1e-9);
    expect(step.chance).toBeLessThan(0.2);
    expect(step.played).toBeUndefined();
  }, 120_000);

  test('the line follows the proof and plays to the win under two seeds', async () => {
    for (const board of [FOURTH, COIN]) {
      const { serialized } = await serializedBoard(board);
      const step = strongerStep(serialized, REQUEST('p1', { rootOrder: board === FOURTH ? RANKING : ['move highjumpkick'] }));
      expect(step.status).toBe('found');
      expect(step.line, 'the proof comes with a line').toBeDefined();
      for (const seed of ['1,2,3,4', '905,17,333,4096']) expect(won(await playLine(board, step.line!, seed), 'p1')).toBe(true);
    }
  }, 120_000);

  test('a budget the proof cannot finish in stops it', async () => {
    const { serialized } = await serializedBoard(FOURTH);
    const step = strongerStep(serialized, REQUEST('p1', { rootOrder: RANKING, budget: { cells: 1 } }));
    expect(step.status).toBe('stopped');
    expect(step.spent.cells).toBeGreaterThanOrEqual(0);
  }, 120_000);
});

describe('a stronger play, doubles', () => {
  /**
   * Earthquake (spread) against two Pikachu at 1 HP that may Splash or Growl: the proof answers every legal reply of the foe (four pairs),
   * and the winner is the one choice that damages. (A board with Protect proves less than it should in doubles: the prover reads a
   * repeated Protect as unpriced there, a rest of lane A's prover, not of this step.)
   */
  const DOUBLES: Board = {
    format: 'gen9doublescustomgame',
    p1: [mon('Pikachu', ['Splash', 'Earthquake']), mon('Pidgeot', ['Splash'])],
    p2: [mon('Pikachu', ['Splash', 'Growl']), mon('Pikachu', ['Splash', 'Growl'])],
    prepare: battle => { battle.sides[1].pokemon[0].hp = 1; battle.sides[1].pokemon[1].hp = 1; },
  };

  test('against every legal reply: the winner is the damaging pair, and the line plays to the win', async () => {
    const { serialized } = await serializedBoard(DOUBLES);
    const order = ['move splash, move splash', 'move earthquake, move splash'];
    expect(proof(serialized, order).mass, 'the production prover sees the same win').toBe(1);
    const step = strongerStep(serialized, REQUEST('p1', { rootOrder: order, played: order[0] }));
    expect(step.status).toBe('found');
    expect(step.chance).toBe(1);
    expect(step.played).toBe(0);
    expect(step.line!.choice).toBe('move earthquake, move splash');
    // every legal reply of the foe was answered: four pairs of Splash and Growl
    expect(step.spent.cells).toBeGreaterThanOrEqual(4);
    expect(step.line!.steps[0].p2.choice).toMatch(/^move (splash|growl), move (splash|growl)$/);
    for (const seed of ['1,2,3,4', '905,17,333,4096']) expect(won(await playLine(DOUBLES, step.line!, seed), 'p1')).toBe(true);
  }, 240_000);
});
