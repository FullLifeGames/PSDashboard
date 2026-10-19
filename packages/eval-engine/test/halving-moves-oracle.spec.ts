import { describe, expect, test } from 'vitest';
import { HALVING_MOVES } from '../src/score/threat';
import { ALL_VIEWS, battleIn, mon, oracleTagAbove } from './sim-views';

/**
 * Round 72 (T235), plan row 9: `HALVING_MOVES` in score/threat.ts names the moves that deal half the target's current HP
 * (the threat prices them from the defender's live HP). The Dex marks ten moves with a `damageCallback`; halving is one of
 * its results, so a field cannot say it. This spec plays every damaging move that has a damage callback in every view the
 * corpus plays, against a target at two different HP values and an attacker at a third, and keeps the moves whose damage is
 * half the target's HP (rounded down) at both. A new Dex move that halves, or a listed move the simulator stops halving,
 * fails with its id.
 */

describe('HALVING_MOVES is held to the simulator (round 72)', () => {
  test('the list carries its oracle tag', () => {
    expect(oracleTagAbove('packages/eval-engine/src/score/threat.ts', 'const HALVING_MOVES', 'packages/eval-engine/test/halving-moves-oracle.spec.ts')).toBe(true);
  });

  describe.each(ALL_VIEWS)('$name', view => {
    const withCallback = view.dex.moves.all()
      .filter(move => move.exists && move.category !== 'Status' && (move as unknown as { damageCallback?: unknown }).damageCallback)
      .map(move => move.id);

    /** The damage the simulator gives `moveId` when the target stands at `targetHp` and the user at 300. */
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
