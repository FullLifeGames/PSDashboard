import { describe, expect, test } from 'vitest';
import type { BranchMoveOption } from '../src/branch-engine';
import { makePokemonInfo } from '../src/branch/pokemon-info';
import { calcSingleDamageRange } from '../src/damage-calc';
import { positionBattle } from '../src/forward-model';
import { boundaryEvent } from '../src/ko-odds';
import { killCount } from '../src/pair/kill-table';
import { checkedRolls, drawTurn, rollSet as set, rootOf } from './calc-roll-oracle';

/**
 * Round 67, lane A (T83): the slot "Hidden Power" reaches the calc with the
 * simulator's type (hpType), and before gen 6 with its power (hpPower); the
 * calc reads the bare name as a Normal move of power 60 (0 before gen 6).
 * The scene: 648453 turn 13, Hidden Power Ice into a Landorus-Therian at
 * 83 HP is a sure KO, the bare name priced it at about 6 %.
 */

const option = (name: string): BranchMoveOption =>
  ({ name, activeSlot: 0, slot: 1, pp: 15, maxpp: 15, disabled: false, type: 'Normal', targetType: 'normal', requiresTarget: false, targetOptions: [] });

describe('Hidden Power goes to the calc typed (T83)', () => {
  test('singles gen 6: Hidden Power Ice into Landorus-Therian at 83 HP is the sure KO the simulator deals', () => {
    const root = rootOf('gen6customgame', [set('Starmie', ['Hidden Power Ice'])],
      [set('Landorus-Therian', ['Splash'], { ability: 'Battle Armor' })], battle => { battle.sides[1].active[0].sethp(83); });
    const battle = positionBattle(root);
    expect(battle.sides[0].active[0].hpType).toBe('Ice');
    const [hit] = checkedRolls(drawTurn(root, 'move hiddenpower', 'move splash'));
    expect(hit.holds).toBe(true);
    const event = boundaryEvent(battle, battle.sides[0].active[0], battle.sides[1].active[0], 'hiddenpower')!;
    expect(event.killFraction).toBe(1);
    expect(event.normalKillRolls).toBe(killCount(hit.table!.normal, 83));
  });

  test('singles gen 3: Hidden Power at the power the IVs give (30), not the typed name\'s 70', () => {
    const ivs = { hp: 29, atk: 29, def: 29, spa: 29, spd: 29, spe: 29 };
    const root = rootOf('gen3customgame', [set('Gengar', ['Hidden Power Fire'], { ivs })], [set('Snorlax', ['Splash'], { ivs })]);
    const gengar = positionBattle(root).sides[0].active[0];
    expect([gengar.hpType, gengar.hpPower]).toEqual(['Fire', 30]);
    const hits = checkedRolls(drawTurn(root, 'move hiddenpower', 'move splash'));
    expect(hits.length).toBe(1);
    expect(hits[0].holds).toBe(true);
  });

  test('doubles gen 7: a Hidden Power hit lands on its kill table at the drawn roll', () => {
    const root = rootOf('gen7doublescustomgame',
      [set('Magnezone', ['Hidden Power Fire']), set('Corviknight', ['Roost'])],
      [set('Ferrothorn', ['Splash'], { ability: 'Battle Armor' }), set('Blissey', ['Soft-Boiled'], { ability: 'Battle Armor' })]);
    const hits = checkedRolls(drawTurn(root, 'move hiddenpower 1, move roost', 'move splash, move softboiled'));
    expect(hits.length).toBe(1);
    expect(hits[0].holds).toBe(true);
  });

  test('the picker\'s state carries the type and power, and the preview prices the slot as its type', () => {
    for (const format of ['gen6customgame', 'gen7doublescustomgame'] as const) {
      const doubles = format === 'gen7doublescustomgame';
      const root = rootOf(format, [set('Starmie', ['Hidden Power Ice']), ...(doubles ? [set('Corviknight', ['Roost'])] : [])],
        [set('Landorus-Therian', ['Splash']), ...(doubles ? [set('Blissey', ['Soft-Boiled'])] : [])]);
      const battle = positionBattle(root);
      const starmie = makePokemonInfo(battle.sides[0].active[0] as never, true, 0);
      const lando = makePokemonInfo(battle.sides[1].active[0] as never, true, 0);
      expect([starmie.hpType, starmie.hpPower], format).toEqual(['Ice', 60]);
      const context = { gen: battle.gen, gameType: doubles ? 'Doubles' as const : 'Singles' as const };
      expect(calcSingleDamageRange(starmie, lando, option('Hidden Power'), context).range, format)
        .toBe(calcSingleDamageRange(starmie, lando, option('Hidden Power Ice'), context).range);
    }
  });
});
