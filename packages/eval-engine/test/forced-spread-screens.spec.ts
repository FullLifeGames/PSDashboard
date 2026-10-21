import { describe, expect, test } from 'vitest';
import { createBranchStateFromBattle } from '../src/branch/state';
import { calcSingleDamageRange } from '../src/damage-calc';
import { positionBattle, type SimPosition } from '../src/forward-model';
import { serializeBattleStable } from '../src/forward/serialize';
import { rootOf } from './calc-roll-oracle';
import { doubles, IDLE_ALONE, SCENES, SCREENS, wall, type Scene } from './forced-spread-scenes';
import { simDamages } from './sim-rolls';

/**
 * Round 73 (T202): the calculator forces the spread target for Tera Starstorm of Terapagos-Stellar and Expanding Force in Psychic
 * Terrain. Against a lone foe the simulator plays one target. Round 69 (T152) priced that hit on the Singles game type, which holds
 * the spread factor and the screen factor right only without a screen: a screen is 2732/4096 in Doubles and 2048/4096 in Singles,
 * and neither field prices the hit of a lone foe behind one. The kill table now answers null there, so the pair plan samples the
 * simulator itself, and the preview prices the hit on a copy of the live battle (design gate 3a, integrator ruling 21.10.2026). The
 * oracle is the simulator's own damage.
 */

const optionOf = (scene: Scene) => ({ name: scene.move, activeSlot: 0, slot: 1, pp: 8, maxpp: 8, disabled: false, type: 'Normal', targetType: 'normal', requiresTarget: true, targetOptions: [] });
const pct = (damage: number, maxhp: number) => Math.round(damage / maxhp * 1000) / 10;

/** The preview's result for the first attacker into the first foe, with the live battle of the position when `live`. */
function previewOf(scene: Scene, root: SimPosition, screen: string, live: boolean, battle = positionBattle(root)) {
  const state = createBranchStateFromBattle(battle, [], {});
  const mon = scene.id === 'terastarstorm' ? { ...state.p1ActiveSlots[0]!, teraType: 'Stellar' } : state.p1ActiveSlots[0]!;
  const foe = state.p2ActiveSlots[0]!;
  const context = {
    gen: 9, gameType: 'Doubles' as const, terrain: scene.terrain, defenderSideConditions: screen ? [screen] : [], defenderPartner: null, attackerPartnerAlive: true,
    ...(live ? { liveHit: { battle, attacker: { side: 0 as const, slot: 0 }, defender: { side: 1 as const, slot: 0 }, armed: { attacker: scene.id === 'terastarstorm' } } } : {}),
  };
  return { result: calcSingleDamageRange(mon, foe, optionOf(scene) as never, context), maxhp: foe.maxhp, battle };
}

describe('the preview of a forced spread on a lone foe behind a screen (doubles)', () => {
  for (const scene of SCENES) {
    for (const screen of SCREENS) {
      test(`${scene.title} behind ${screen}: the simulator's range on a copy of the live battle`, () => {
        const root = doubles(scene, screen, true);
        const damages = simDamages(root, scene.choice, IDLE_ALONE, { script: `p1a:${scene.id}>p2a`, target: { side: 1, slot: 0 } });
        const battle = positionBattle(root);
        const before = serializeBattleStable(battle);
        const { result, maxhp } = previewOf(scene, root, screen, true, battle);
        expect([result.minPercent, result.maxPercent]).toEqual([pct(Math.min(...damages.normal), maxhp), pct(Math.max(...damages.normal), maxhp)]);
        // The live battle is read and never written.
        expect(serializeBattleStable(battle), 'the live battle is unchanged').toBe(before);
      });

      test(`${scene.title} behind ${screen}: no live battle, no range`, () => {
        const { result } = previewOf(scene, doubles(scene, screen, true), screen, false);
        expect(result).toMatchObject({ range: '-', minPercent: 0, maxPercent: 0 });
      });
    }

    test(`${scene.title} without a screen: the calc stays exact with or without a live battle`, () => {
      const root = doubles(scene, null, true);
      const damages = simDamages(root, scene.choice, IDLE_ALONE, { script: `p1a:${scene.id}>p2a`, target: { side: 1, slot: 0 } });
      for (const live of [false, true]) {
        const { result, maxhp } = previewOf(scene, root, '', live);
        expect([result.minPercent, result.maxPercent]).toEqual([pct(Math.min(...damages.normal), maxhp), pct(Math.max(...damages.normal), maxhp)]);
      }
    });
  }
});

describe('singles: nothing spreads, the calc prices a screen exactly and needs no live battle', () => {
  for (const scene of SCENES) {
    test(`${scene.title} behind Light Screen`, () => {
      const root = rootOf('gen9customgame', [scene.attacker()], [wall()], battle => {
        scene.field(battle);
        battle.sides[1].addSideCondition('lightscreen', battle.sides[1].active[0]!);
      });
      const choice = scene.choice.replace(' 1', '').replace(', move splash', '');
      const damages = simDamages(root, choice, 'move splash', { script: `p1a:${scene.id}>p2a`, target: { side: 1, slot: 0 } });
      const state = createBranchStateFromBattle(positionBattle(root), [], {});
      const mon = scene.id === 'terastarstorm' ? { ...state.p1ActiveSlots[0]!, teraType: 'Stellar' } : state.p1ActiveSlots[0]!;
      const foe = state.p2ActiveSlots[0]!;
      const result = calcSingleDamageRange(mon, foe, optionOf(scene) as never, { gen: 9, gameType: 'Singles', terrain: scene.terrain, defenderSideConditions: ['lightscreen'] });
      expect([result.minPercent, result.maxPercent]).toEqual([pct(Math.min(...damages.normal), foe.maxhp), pct(Math.max(...damages.normal), foe.maxhp)]);
    });
  }
});
