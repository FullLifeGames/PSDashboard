import { describe, expect, test } from 'vitest';
import { flipTurn, recordTurn, type FlipTurn } from '../src/dice/flip';
import { tieName, type ForcedDie } from '../src/dice/types';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { chancesCalled, liveState, turnOf } from './flip-turn-support';

/**
 * Round 89 (A6-2, ruling 24, #145): the tie path of the plain endgame children plays each speed-tie order apart and prices the
 * dice inside it. `recordTurn` and `flipTurn` take the ties a turn is held to (`FlipTurn.ties`, the forcing PRNG's tie die by
 * pair), and `recordTurn` lists the pairs the natural turn tied (`ties`, the slots of every shuffle that held two move actions).
 * Held to an order, the turn plays that order in the recording and in every flip, and the live board stays as it was.
 */
await loadSimMods('gen9championsou');

const tied = () => battleOf(
  'gen9doublescustomgame',
  [set('Snorlax', ['thunder', 'tackle'], { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } }), set('Blissey', ['splash'])],
  [set('Snorlax', ['tackle'], { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } }), set('Blissey', ['splash'])],
);
const clicks = { p1: 'move 1 1, move 1', p2: 'move 1 1, move 1' };

const firstMover = (battle: ReturnType<typeof tied>, start: number): string =>
  battle.log.slice(start).find(line => line.startsWith('|move|') && !line.includes('Splash'))!.split('|')[2].slice(0, 3);

/** The tie of the leading pair, held to one side going first. */
const heldTo = (first: 'p1a' | 'p2a'): ForcedDie[] => [{ name: tieName('p1a', 'p2a'), result: { first } }];

describe('a recorded turn lists the speed ties it drew', () => {
  test('the natural turn of two bodies at one speed tied the leading pair, and the live board stands', () => {
    const board = tied();
    const before = liveState(board);
    const recorded = recordTurn(turnOf(board, clicks));
    expect(recorded.ties.some(slots => slots.includes('p1a') && slots.includes('p2a'))).toBe(true);
    expect(liveState(board)).toBe(before);
  });
});

describe.each(['p1a', 'p2a'] as const)('a turn held to %s going first', first => {
  test('the recording and every flip play that order; the die is the accuracy of the first body', () => {
    const board = tied();
    const before = liveState(board);
    const turn: FlipTurn = { ...turnOf(board, clicks), ties: heldTo(first) };
    const recorded = recordTurn(turn);
    expect(firstMover(recorded.battle, recorded.logStart)).toBe(first);
    const accuracy = recorded.dice.filter(die => die.name.kind === 'accuracy' && die.name.slot === 'p1a');
    expect(accuracy.length, 'the dice of the held turn are recorded').toBeGreaterThan(0);
    for (const die of accuracy) {
      const flipped = flipTurn(turn, recorded, die);
      expect(flipped.took).toBe(true);
      expect(firstMover(flipped.battle, flipped.logStart), `${die.key} keeps the order`).toBe(first);
      const called = chancesCalled(board, clicks);
      expect(called.some(entry => Math.abs(entry.chance - die.chance) < 1e-12)).toBe(true);
    }
    expect(liveState(board)).toBe(before);
  });
});
