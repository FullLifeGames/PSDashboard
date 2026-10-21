import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { calcSingleDamageRange, createBranchStateFromBattle, type DamageResult } from '@fulllifegames/eval-engine';
import { computePreviewDamage } from '../src/lib/branch-damage';

/**
 * Round 73 (T202, design gate 3a): the picker's preview of a hit the calculator cannot price. Expanding Force in Psychic Terrain and
 * Tera Starstorm of Terapagos-Stellar take every foe in the calculator; against a lone foe behind a screen the simulator plays one
 * target and neither game type of the calculator holds the screen factor. The preview hands the live battle of the branch to
 * the engine, which plays the hit on a copy of it. Without a live battle (a stored position) the hit shows no range. The oracle is the
 * simulator: it plays the move and the HP the foe lost lies in the previewed range, which is exact at both ends in the unit test
 * (packages/eval-engine/test/forced-spread-screens.spec.ts).
 */
const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

const set = (species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { ...STATS, hp: 252, atk: 252, spa: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: '', ...extra,
});

/** A doubles battle in which the first foe stands alone behind the screens. */
function loneFoe(attacker: PokemonSet, psychicTerrain: boolean, screens: string[]): Battle {
  const p1 = [attacker, set('Snorlax', ['Splash'])];
  const p2 = [set('Blissey', ['Splash']), set('Chansey', ['Splash'])];
  const battle = new Battle({ formatid: toID('gen9doublescustomgame'), seed: [1, 2, 3, 4], p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) } });
  battle.choose('p1', 'team 12');
  battle.choose('p2', 'team 12');
  battle.sides[1].active[1]!.faint();
  battle.faintMessages();
  if (psychicTerrain) battle.field.setTerrain('psychicterrain', 'debug');
  for (const screen of screens) battle.sides[1].addSideCondition(screen, battle.sides[1].active[0]!);
  return battle;
}

/** The first move's preview into the first foe, with the live battle handed over or not. */
function previewed(battle: Battle, live: boolean, tera: string | null): DamageResult {
  const state = createBranchStateFromBattle(battle as never, [], {});
  const result = computePreviewDamage({
    p1ActiveSlots: state.p1ActiveSlots, p2ActiveSlots: state.p2ActiveSlots,
    p1MovesBySlot: state.p1MovesBySlot, p2MovesBySlot: state.p2MovesBySlot,
    fieldState: state.field, gen: battle.gen, teraBySlot: { p1: [tera, null], p2: [null, null] }, ...(live ? { battle } : {}),
  } as Parameters<typeof computePreviewDamage>[0], calcSingleDamageRange);
  return result.p1.targets[0]['1:1'] ?? result.p1.default[0][0];
}

/** The HP the first foe loses when the simulator plays the move. */
function lost(battle: Battle, choice: string): number {
  const foe = battle.sides[1].active[0]!;
  const before = foe.hp;
  battle.choose('p1', `${choice}, move splash`);
  battle.choose('p2', 'move splash, pass');
  return before - foe.hp;
}

const CASES = [
  { title: 'Expanding Force in Psychic Terrain', attacker: () => set('Hatterene', ['Expanding Force', 'Splash']), terrain: true, tera: null, choice: 'move expandingforce 1' },
  { title: 'Tera Starstorm after the armed click', attacker: () => set('Terapagos', ['Tera Starstorm', 'Splash'], { ability: 'Tera Shift', teraType: 'Stellar' }), terrain: false, tera: 'Stellar', choice: 'move terastarstorm 1 terastallize' },
];

describe('doubles: the preview of a forced spread on a lone foe behind a screen', () => {
  for (const scene of CASES) {
    for (const screens of [['reflect'], ['lightscreen'], ['auroraveil'], ['reflect', 'lightscreen']]) {
      test(`${scene.title} behind ${screens.join(' and ')}: the range holds the simulator's damage`, () => {
        const build = () => loneFoe(scene.attacker(), scene.terrain, screens);
        const range = previewed(build(), true, scene.tera);
        const battle = build();
        const damage = lost(battle, scene.choice);
        expect(damage).toBeGreaterThan(0);
        const percent = Math.round(damage / battle.sides[1].active[0]!.maxhp * 1000) / 10;
        expect(range.range).not.toBe('-');
        expect(percent).toBeGreaterThanOrEqual(range.minPercent);
        expect(percent).toBeLessThanOrEqual(range.maxPercent);
      });
    }

    test(`${scene.title}: a position without a live battle shows no range behind a screen`, () => {
      expect(previewed(loneFoe(scene.attacker(), scene.terrain, ['lightscreen']), false, scene.tera).range).toBe('-');
    });

    test(`${scene.title}: without a screen the calc range holds the simulator's damage, live battle or not`, () => {
      for (const live of [false, true]) {
        const range = previewed(loneFoe(scene.attacker(), scene.terrain, []), live, scene.tera);
        const battle = loneFoe(scene.attacker(), scene.terrain, []);
        const percent = Math.round(lost(battle, scene.choice) / battle.sides[1].active[0]!.maxhp * 1000) / 10;
        expect(percent).toBeGreaterThanOrEqual(range.minPercent);
        expect(percent).toBeLessThanOrEqual(range.maxPercent);
      }
    });
  }
});
