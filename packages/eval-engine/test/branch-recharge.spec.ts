import { describe, expect, test } from 'vitest';
import { resolveSideChoices } from '../src/branch/execute';
import { createBranchStateFromBattle } from '../src/branch/state';
import { FORMATS, moveCommand, setOf, sideId, startBattle } from './branch-rule-battles';

/**
 * Round 77 (acceptance of the fix wave): on a recharge turn the simulator's request lists one entry, "Recharge", which
 * the Dex does not know, so since A-1 the picker showed every move disabled and no button at all; before A-1 the moves
 * were clickable and Execute failed. The turn could not be played by hand. Every Dex move that forces a recharge,
 * in singles and doubles, on either side: the next turn offers exactly one enabled button, and it executes.
 */
const RECHARGE_MOVES = (() => {
  const battle = startBattle('gen9customgame', [setOf('Snorlax', ['Splash'])], [setOf('Snorlax', ['Splash'])]);
  return battle.dex.moves.all()
    .filter(move => move.self?.volatileStatus === 'mustrecharge' && !move.isNonstandard)
    .map(move => move.name);
})();

describe('a recharge turn can be played by hand (round 77)', () => {
  test('the Dex has recharge moves to sweep', () => {
    expect(RECHARGE_MOVES).toEqual(expect.arrayContaining(['Hyper Beam', 'Giga Impact']));
  });

  for (const format of FORMATS) {
    for (const victimSide of [0, 1]) {
      test.each(RECHARGE_MOVES)(`${format.name}, ${sideId(victimSide)}: %s, then the recharge turn`, move => {
        const user = setOf('Snorlax', [move, 'Splash'], { ability: 'No Guard' });
        const foe = setOf('Blissey', ['Splash'], { evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 252, spe: 0 } });
        const partner = setOf('Chansey', ['Splash']);
        const team = (lead: ReturnType<typeof setOf>) => (format.doubles ? [lead, partner] : [lead]);
        const battle = startBattle(format.id, victimSide === 0 ? team(user) : team(foe), victimSide === 0 ? team(foe) : team(user));
        const victim = sideId(victimSide);
        battle.choose(victim, moveCommand(battle, move, format.doubles));
        battle.choose(sideId(1 - victimSide), format.doubles ? 'move Splash, move Splash' : 'move Splash');
        expect(battle.sides[victimSide].active[0].volatiles['mustrecharge']).toBeTruthy();

        const state = createBranchStateFromBattle(battle, [], {});
        const slots = (victimSide === 0 ? state.p1MovesBySlot : state.p2MovesBySlot)[0];
        const enabled = slots.filter(option => !option.disabled);
        expect(enabled.map(option => option.name)).toEqual(['Recharge']);
        const partnerPick = { kind: 'move', moveId: 'splash', moveName: 'Splash' } as const;
        const resolved = resolveSideChoices(battle, victim, [
          { kind: 'move', moveId: 'recharge', moveName: enabled[0].name }, ...(format.doubles ? [partnerPick] : []),
        ], format.doubles ? [true, true] : [true]);
        expect(resolved).toMatchObject({ ok: true });
        if (resolved.ok) expect(battle.choose(victim, resolved.command)).toBe(true);
      });
    }
  }
});
