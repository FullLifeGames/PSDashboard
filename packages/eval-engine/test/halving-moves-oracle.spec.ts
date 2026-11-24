import { describe, expect, test } from 'vitest';
import { HALVING_MOVES } from '../src/score/threat';
import { ALL_VIEWS, battleIn, mon } from './sim-views';

// The Dex marks ten moves with a `damageCallback`; halving is one of its results, so no field says it.

describe('HALVING_MOVES is held to the simulator', () => {
  describe.each(ALL_VIEWS)('$name', view => {
    const withCallback = view.dex.moves.all()
      .filter(move => move.exists && move.category !== 'Status' && (move as unknown as { damageCallback?: unknown }).damageCallback)
      .map(move => move.id);

    function damageAt(moveId: string, targetHp: number): unknown {
      const battle = battleIn(view, [mon('Blissey', ['splash']), mon('Blissey', ['splash'])], [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
      const user = battle.sides[0].active[0];
      const target = battle.sides[1].active[0];
      user.hp = 300;
      target.hp = targetHp;
      return battle.actions.getDamage(user, target, moveId);
    }

    test('the moves that deal half the target\'s current HP are the listed ones', () => {
      expect(withCallback.length).toBeGreaterThan(0);
      const halving = withCallback.filter(id => damageAt(id, 500) === 250 && damageAt(id, 401) === 200);
      const listed = [...HALVING_MOVES].filter(id => view.dex.moves.get(id).exists);
      expect(halving.length).toBeGreaterThan(0);
      expect(halving.sort()).toEqual(listed.sort());
    });
  });
});
