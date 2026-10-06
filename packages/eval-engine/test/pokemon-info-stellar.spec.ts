import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { createBranchStateFromBattle } from '../src/branch/state';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * T124 point 5: the picker state carries the types a Stellar Pokémon has
 * already spent its one-time boost on, read from the simulator
 * (Pokemon.stellarBoostedTypes), so the preview knows which use is a first one.
 */

const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const stellar = () => set('Garchomp', ['earthquake', 'stoneedge'], { teraType: 'Stellar' });

describe('the picker state carries the spent Stellar types (T124 point 5)', () => {
  test('singles: none before the Tera turn, the move\'s type after it', () => {
    const battle = battleOf('gen9customgame', [stellar()], [splash('Snorlax')]);
    expect(createBranchStateFromBattle(battle, [], {}).p1ActiveSlots[0]?.stellarBoostedTypes).toEqual([]);
    battle.choose('p1', 'move earthquake terastallize');
    battle.choose('p2', 'move splash');
    const [garchomp] = createBranchStateFromBattle(battle, [], {}).p1ActiveSlots;
    expect(garchomp?.teraType).toBe('Stellar');
    expect(garchomp?.stellarBoostedTypes).toEqual(['Ground']);
    expect(garchomp?.stellarBoostedTypes).not.toBe(battle.sides[0].active[0].stellarBoostedTypes);
  });

  test('doubles: the slot that terastallized carries its spent type, its partner none', () => {
    const battle = battleOf('gen9doublescustomgame', [stellar(), splash('Corviknight')], [splash('Snorlax'), splash('Blissey')]);
    battle.choose('p1', 'move earthquake terastallize, move splash');
    battle.choose('p2', 'move splash, move splash');
    const [garchomp, corviknight] = createBranchStateFromBattle(battle, [], {}).p1ActiveSlots;
    // The simulator records the type once per target the boosted use hit: the copy keeps its list as it is.
    expect(garchomp?.stellarBoostedTypes).toEqual(['Ground', 'Ground']);
    expect(garchomp?.stellarBoostedTypes).toEqual(battle.sides[0].active[0].stellarBoostedTypes);
    expect(corviknight?.stellarBoostedTypes).toEqual([]);
  });
});
