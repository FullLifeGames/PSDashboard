import { describe, expect, test } from 'vitest';
import { offeredDice, serializeLiveBattle } from '@fulllifegames/eval-engine';
import { pickerFromSerialized, pickerStateFromSerialized } from '../../../src/lib/picker-state';
import { diceBattle, setOf } from '../fixtures/dice-battle';

/**
 * Round 82 (forced dice), step A7b: a stored exact position keeps its deserialized battle for the offers of the dice chips.
 * Before, `pickerStateFromSerialized` read the state off the battle and dropped it, so a viewed replay position had no battle to
 * ask which dice a move draws.
 */
const BOARDS = {
  singles: { p1: [setOf('Noivern', ['airslash', 'splash'])], p2: [setOf('Snorlax', ['splash'])] },
  doubles: {
    p1: [setOf('Noivern', ['airslash', 'splash']), setOf('Pikachu', ['thunderbolt', 'splash'])],
    p2: [setOf('Snorlax', ['splash']), setOf('Chansey', ['splash'])],
    format: 'gen9doublescustomgame',
  },
};

describe.each(Object.entries(BOARDS))('pickerFromSerialized, %s', (_, board) => {
  test('gives the state of pickerStateFromSerialized and the battle the state was read from', async () => {
    const serialized = serializeLiveBattle(diceBattle(board));
    const { state, battle } = await pickerFromSerialized(serialized);
    expect(state).toEqual(await pickerStateFromSerialized(serialized));
    expect(battle.turn).toBe(state.turnNumber);
    expect(battle.sides[0].active[0]?.name).toBe('Noivern');
  });

  test('the battle answers the dice a move draws, as the live battle does', async () => {
    const live = diceBattle(board);
    const { battle } = await pickerFromSerialized(serializeLiveBattle(live));
    const choice = { kind: 'move' as const, moveId: 'airslash', moveName: 'Air Slash', ...(board.format ? { targetLoc: 1 } : {}) };
    const kinds = (offers: ReturnType<typeof offeredDice>) => offers.map(offer => offer.name.kind).sort();
    expect(kinds(offeredDice(battle, 'p1a', choice))).toEqual(kinds(offeredDice(live, 'p1a', choice)));
    expect(offeredDice(battle, 'p1a', choice).some(offer => offer.name.kind === 'secondary' && offer.name.effectId === 'flinch')).toBe(true);
  });
});
