import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { bodyOf } from '../src/calc/body';
import { teraClicked } from '../src/calc/tera-click';
import { clickTera, set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 67, lane A (T100, T84): the body a Tera click makes comes from the
 * simulator. teraClicked must equal what the simulator's own terastallize
 * leaves on a twin of the battle: forme, ability, stages and HP.
 */
const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);

/** The first p1 active of a fresh twin, clicked by the simulator itself, read as a body. */
function simClicked(make: () => Battle) {
  const twin = make();
  const mon = twin.sides[0].active[0];
  twin.actions.terastallize(mon);
  return bodyOf(twin, mon);
}

/** The first p1 active of the battle, read as a body that clicks its Tera type. */
function armed(battle: Battle) {
  const mon = battle.sides[0].active[0];
  return { ...bodyOf(battle, mon), tera: mon.teraType };
}

describe('the Tera click as the simulator makes it', () => {
  test('Terapagos-Terastal becomes Terapagos-Stellar, with Teraform Zero and its HP, damage kept', () => {
    const make = () => {
      const battle = battleOf('gen9customgame', [set('Terapagos', ['terastarstorm'], { ability: 'Tera Shift', teraType: 'Stellar' })], [splash('Snorlax')]);
      battle.sides[0].active[0].sethp(100);
      return battle;
    };
    const battle = make();
    expect(battle.sides[0].active[0].species.name).toBe('Terapagos-Terastal');
    const clicked = teraClicked(9, armed(battle));
    expect(clicked.species).toBe('Terapagos-Stellar');
    expect(clicked.maxhp).toBeGreaterThan(battle.sides[0].active[0].maxhp);
    expect(clicked).toEqual(simClicked(make));
  });

  test('Ogerpon-Hearthflame becomes Ogerpon-Hearthflame-Tera, whose Embody Aspect raises Attack', () => {
    const make = () => battleOf('gen9customgame',
      [set('Ogerpon-Hearthflame', ['ivycudgel'], { ability: 'Mold Breaker', item: 'Hearthflame Mask', teraType: 'Fire' })], [splash('Snorlax')]);
    const clicked = teraClicked(9, armed(make()));
    expect(clicked.species).toBe('Ogerpon-Hearthflame-Tera');
    expect(clicked.boosts.atk).toBe(1);
    expect(clicked).toEqual(simClicked(make));
  });

  test('a body the click leaves in its forme changes its types only, and a clicked Ogerpon-*-Tera gets no second stage', () => {
    const chomp = battleOf('gen9customgame', [set('Garchomp', ['earthquake'], { teraType: 'Steel' })], [splash('Snorlax')]);
    expect(teraClicked(9, armed(chomp))).toEqual({ ...bodyOf(chomp, chomp.sides[0].active[0]), tera: 'Steel' });

    const ogerpon = battleOf('gen9customgame',
      [set('Ogerpon-Wellspring', ['splash'], { ability: 'Water Absorb', item: 'Wellspring Mask', teraType: 'Water' })], [splash('Snorlax')]);
    clickTera(ogerpon, 0);
    const body = bodyOf(ogerpon, ogerpon.sides[0].active[0]);
    expect(body.species).toBe('Ogerpon-Wellspring-Tera');
    expect(body.boosts.spd).toBe(1);
    expect(teraClicked(9, body)).toBe(body);
  });

  test('before gen 9 there is no click', () => {
    const battle = battleOf('gen8customgame', [set('Garchomp', ['earthquake'])], [splash('Snorlax')]);
    const body = { ...bodyOf(battle, battle.sides[0].active[0]), tera: 'Steel' };
    expect(teraClicked(8, body)).toBe(body);
  });
});
