import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { createBranchStateFromBattle } from '../src/branch/state';
import { calcSingleDamageRange } from '../src/damage-calc';
import { positionBattle, type SimPosition } from '../src/forward-model';
import { boundaryEvent, critRate } from '../src/ko-odds';
import { pairKoOdds } from '../src/pair/odds';
import { checkedRolls, drawTurn, rollSet as set, rootOf } from './calc-roll-oracle';
import { killing, simDamages } from './sim-rolls';

/**
 * Round 69, lane D (T152 point 2): which foes a move hits is the simulator's
 * to say after the click and the field have had their say. Terapagos-Stellar's
 * Tera Starstorm and Expanding Force in Psychic Terrain (a grounded user) take
 * every adjacent foe (their onModifyMove in the Dex), so the doubles headline
 * names all of them; the calc forces the spread target for both, so with one
 * foe alive its 0.75 spread factor sits on a hit the simulator does not
 * spread, and the kill table must not carry it. The oracle is the simulator's
 * own damage (the dice recorded at the roll; calc-roll-oracle.ts).
 */

const terapagos = (): PokemonSet => set('Terapagos', ['Tera Starstorm', 'Splash'], { ability: 'Tera Shift', teraType: 'Stellar' });
const hatterene = (): PokemonSet => set('Hatterene', ['Expanding Force', 'Splash']);
const wall = (species = 'Blissey'): PokemonSet => set(species, ['Splash'], { evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 252, spe: 0 } });
const psychic = (battle: Battle) => { battle.field.setTerrain('psychicterrain', 'debug'); };

const STARSTORM = 'move terastarstorm 1 terastallize, move splash';
const FORCE = 'move expandingforce 1, move splash';
const IDLE = 'move splash, move splash';
const IDLE_ALONE = 'move splash, pass';

/** A doubles battle; `alone` leaves the first foe the only one alive (the second of its two fainted). */
const doubles = (p1: PokemonSet[], foes: PokemonSet[], setup?: (battle: Battle) => void, alone = false): SimPosition =>
  rootOf('gen9doublescustomgame', p1, foes, battle => {
    if (alone) {
      battle.sides[1].active[1]!.faint();
      battle.resolveFaints();
    }
    setup?.(battle);
  });

function holds(root: SimPosition, p1Choice: string, idle = IDLE): { rolls: number; allHold: boolean } {
  const checked = checkedRolls(drawTurn(root, p1Choice, idle));
  return { rolls: checked.length, allHold: checked.every(entry => entry.holds) };
}

describe('doubles: the kill table of the hit the simulator plays', () => {
  test('Tera Starstorm after the click into two foes: one table per foe, both the simulator\'s', () => {
    const root = doubles([terapagos(), wall('Snorlax')], [wall(), wall('Chansey')]);
    expect(holds(root, STARSTORM)).toEqual({ rolls: 2, allHold: true });
  });

  test('Tera Starstorm after the click into one foe carries no spread factor', () => {
    const root = doubles([terapagos(), wall('Snorlax')], [wall(), wall('Chansey')], undefined, true);
    expect(holds(root, STARSTORM, IDLE_ALONE)).toEqual({ rolls: 1, allHold: true });
  });

  test('Expanding Force of a grounded user in Psychic Terrain: two foes spread, one foe does not', () => {
    expect(holds(doubles([hatterene(), wall('Snorlax')], [wall(), wall('Chansey')], psychic), FORCE)).toEqual({ rolls: 2, allHold: true });
    expect(holds(doubles([hatterene(), wall('Snorlax')], [wall(), wall('Chansey')], psychic, true), FORCE, IDLE_ALONE)).toEqual({ rolls: 1, allHold: true });
  });

  test('Expanding Force outside the terrain hits the one foe it names', () => {
    expect(holds(doubles([hatterene(), wall('Snorlax')], [wall(), wall('Chansey')]), FORCE)).toEqual({ rolls: 1, allHold: true });
  });
});

/** A foe HP at which about half of the simulator's normal rolls kill. */
function halfKilling(damages: readonly number[]): number {
  const hp = [...damages].sort((a, b) => a - b)[8];
  expect(killing(damages, hp)).toBeGreaterThan(0);
  expect(killing(damages, hp)).toBeLessThan(16);
  return hp;
}

describe('doubles: the option\'s headline names every foe the move hits', () => {
  const crit = critRate(9, 1)!;
  const fraction = (normal: readonly number[], crits: readonly number[], hp: number) => (1 - crit) * killing(normal, hp) / 16 + crit * killing(crits, hp) / 16;

  test('Tera Starstorm into two foes, the named one doomed: the headline is the other foe, with the simulator\'s spread rolls', () => {
    const make = (hp?: number) => doubles([terapagos(), wall('Snorlax')], [wall(), wall('Chansey')], battle => { if (hp) battle.sides[1].active[1]!.sethp(hp); battle.sides[1].active[0]!.sethp(1); });
    const damages = simDamages(make(), STARSTORM, IDLE, { script: 'p1a:terastarstorm>p2b', target: { side: 1, slot: 1 } });
    const hp = halfKilling(damages.normal);
    const [odds] = pairKoOdds(positionBattle(make(hp)), 'p1', [STARSTORM]);
    expect(odds?.label).toBe('Tera Starstorm→Chansey');
    expect(odds?.killFraction).toBeCloseTo(fraction(damages.normal, damages.crit, hp), 10);
  });

  test('Tera Starstorm into one foe: the simulator\'s rolls without the spread factor', () => {
    const make = (hp?: number) => doubles([terapagos(), wall('Snorlax')], [wall(), wall('Chansey')], battle => { if (hp) battle.sides[1].active[0]!.sethp(hp); }, true);
    const damages = simDamages(make(), STARSTORM, IDLE_ALONE, { script: 'p1a:terastarstorm>p2a', target: { side: 1, slot: 0 } });
    const hp = halfKilling(damages.normal);
    const [odds] = pairKoOdds(positionBattle(make(hp)), 'p1', [STARSTORM]);
    expect(odds?.killFraction).toBeCloseTo(fraction(damages.normal, damages.crit, hp), 10);
  });

  test('Expanding Force in Psychic Terrain into two foes names the foe it was not aimed at; outside the terrain it does not', () => {
    const make = (setup?: (battle: Battle) => void) => doubles([hatterene(), wall('Snorlax')], [wall(), wall('Chansey')],
      battle => { setup?.(battle); battle.sides[1].active[0]!.sethp(1); });
    const damages = simDamages(make(psychic), FORCE, IDLE, { script: 'p1a:expandingforce>p2b', target: { side: 1, slot: 1 } });
    const hp = halfKilling(damages.normal);
    const inTerrain = make(battle => { psychic(battle); battle.sides[1].active[1]!.sethp(hp); });
    const [odds] = pairKoOdds(positionBattle(inTerrain), 'p1', [FORCE]);
    expect(odds?.label).toBe('Expanding Force→Chansey');
    expect(odds?.killFraction).toBeCloseTo(fraction(damages.normal, damages.crit, hp), 10);
    // Outside the terrain it hits only the named foe, which is doomed at 1 HP: no uncertain kill to name.
    const outside = make(battle => { battle.sides[1].active[1]!.sethp(hp); });
    expect(pairKoOdds(positionBattle(outside), 'p1', [FORCE])[0]).toBeNull();
  });
});

describe('singles: nothing spreads, the odds stay the simulator\'s', () => {
  test('Tera Starstorm after the click and Expanding Force in Psychic Terrain', () => {
    const cases: [PokemonSet, string, string, (battle: Battle) => void, boolean][] = [
      [terapagos(), 'tera starstorm', 'move terastarstorm terastallize', () => undefined, true],
      [hatterene(), 'expanding force', 'move expandingforce', psychic, false],
    ];
    for (const [attacker, name, choice, setup, clicks] of cases) {
      const id = name.replace(' ', '');
      const make = (hp?: number) => rootOf('gen9customgame', [attacker], [wall()], battle => { setup(battle); if (hp) battle.sides[1].active[0]!.sethp(hp); });
      const damages = simDamages(make(), choice, 'move splash', { script: `p1a:${id}>p2a`, target: { side: 1, slot: 0 } });
      const hp = halfKilling(damages.normal);
      const battle = positionBattle(make(hp));
      const event = boundaryEvent(battle, battle.sides[0].active[0], battle.sides[1].active[0], id, { attacker: clicks })!;
      expect(event.normalKillRolls).toBe(killing(damages.normal, hp));
      expect(event.critKillRolls).toBe(killing(damages.crit, hp));
    }
  });
});

describe('doubles: the preview of a hit on a lone foe', () => {
  test('Tera Starstorm of the armed Terapagos and Expanding Force in Psychic Terrain read the simulator\'s range without the spread factor', () => {
    const cases: [PokemonSet, string, string, string, (battle: Battle) => void][] = [
      [terapagos(), 'Tera Starstorm', 'terastarstorm', STARSTORM, () => undefined],
      [hatterene(), 'Expanding Force', 'expandingforce', FORCE, psychic],
    ];
    for (const [attacker, name, id, choice, setup] of cases) {
      const root = doubles([attacker, wall('Snorlax')], [wall(), wall('Chansey')], setup, true);
      const state = createBranchStateFromBattle(positionBattle(root), [], {});
      const [mon, foe] = [state.p1ActiveSlots[0]!, state.p2ActiveSlots[0]!];
      const option = { name, activeSlot: 0, slot: 1, pp: 8, maxpp: 8, disabled: false, type: 'Normal', targetType: 'normal', requiresTarget: true, targetOptions: [] };
      const damages = simDamages(root, choice, IDLE_ALONE, { script: `p1a:${id}>p2a`, target: { side: 1, slot: 0 } });
      const context = { gen: 9, gameType: 'Doubles' as const, terrain: setup === psychic ? 'psychicterrain' : '', defenderPartner: null, attackerPartnerAlive: true };
      const result = calcSingleDamageRange(id === 'terastarstorm' ? { ...mon, teraType: 'Stellar' } : mon, foe, option as never, context);
      const pct = (damage: number) => Math.round(damage / foe.maxhp * 1000) / 10;
      expect([result.minPercent, result.maxPercent]).toEqual([pct(Math.min(...damages.normal)), pct(Math.max(...damages.normal))]);
    }
  });
});
