import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { bodyOf } from '../src/calc/body';
import { positionBattle, type SimPosition } from '../src/forward-model';
import { boundaryEvent } from '../src/ko-odds';
import { pairKoOdds } from '../src/pair/odds';
import { checkedRolls, drawTurn, rollSet as set, rootOf } from './calc-roll-oracle';
import { killing, simDamages } from './sim-rolls';

/**
 * Round 69, lane D (T152 point 3): a Stellar Tera body's first use of each
 * type hits harder (a 1.2 times boost, or 2 times STAB on its own types, and
 * a base power floor of 60), and the simulator lists the types it spent
 * (stellarBoostedTypes). The odds of the singles event and the doubles kill
 * table read the first use from that list, so the table of a first use and of
 * a second use of the same type equal the simulator's rolls; a body that is
 * not Stellar reads as before.
 */

const garchomp = (tera: string): PokemonSet => set('Garchomp', ['Earthquake', 'Stone Edge', 'Flamethrower', 'Splash'], { teraType: tera });
const wall = (species = 'Blissey'): PokemonSet => set(species, ['Splash'], { evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 252, spe: 0 } });

/** The battle after the click turn: Garchomp has terastallized and spent its type, the foes are healed so no roll is cut short. */
const afterClick = (choice: string, idle: string) => (battle: Battle) => {
  battle.choose('p1', choice);
  battle.choose('p2', idle);
  for (const mon of battle.sides[1].active) mon?.sethp(mon.maxhp);
};

describe('singles: the odds read the first use from the spent types', () => {
  const key = { script: 'p1a:earthquake>p2a', target: { side: 1 as const, slot: 0 } };
  const rootOfTurn = (tera: string, setup?: (battle: Battle) => void, hp?: number) => rootOf('gen9customgame', [garchomp(tera)], [wall()], battle => {
    setup?.(battle);
    if (hp) battle.sides[1].active[0]!.sethp(hp);
  });

  function expectRolls(root: SimPosition, choice: string, clicks: boolean, hp: number, damages: { normal: number[]; crit: number[] }): void {
    const battle = positionBattle(root);
    const event = boundaryEvent(battle, battle.sides[0].active[0], battle.sides[1].active[0], choice, { attacker: clicks })!;
    expect(event.normalKillRolls).toBe(killing(damages.normal, hp));
    expect(event.critKillRolls).toBe(killing(damages.crit, hp));
  }

  test.each(['earthquake', 'flamethrower'])('%s: the click turn is a first use, the next turn a second one, each as the simulator rolls it', move => {
    const script = { ...key, script: `p1a:${move}>p2a` };
    const first = simDamages(rootOfTurn('Stellar'), `move ${move} terastallize`, 'move splash', script);
    const hpFirst = [...first.normal].sort((a, b) => a - b)[8];
    expect(killing(first.normal, hpFirst)).toBeGreaterThan(0);
    expect(killing(first.normal, hpFirst)).toBeLessThan(16);
    expectRolls(rootOfTurn('Stellar', undefined, hpFirst), move, true, hpFirst, first);

    // After the click turn the type is spent: the same move hits without the boost.
    const spent = afterClick(`move ${move} terastallize`, 'move splash');
    const second = simDamages(rootOfTurn('Stellar', spent), `move ${move}`, 'move splash', script);
    const hpSecond = [...second.normal].sort((a, b) => a - b)[8];
    expect(Math.max(...second.normal)).toBeLessThan(Math.max(...first.normal));
    expect(killing(second.normal, hpSecond)).toBeGreaterThan(0);
    expect(killing(second.normal, hpSecond)).toBeLessThan(16);
    expectRolls(rootOfTurn('Stellar', spent, hpSecond), move, false, hpSecond, second);
    // The body carries the type it spent.
    const after = positionBattle(rootOfTurn('Stellar', spent));
    expect(bodyOf(after, after.sides[0].active[0]).stellarBoostedTypes).toEqual([move === 'earthquake' ? 'Ground' : 'Fire']);
  });

  test('a body whose Tera type is not Stellar reads as before: the table is the simulator\'s', () => {
    const first = simDamages(rootOfTurn('Fire'), 'move earthquake terastallize', 'move splash', key);
    const hp = [...first.normal].sort((a, b) => a - b)[8];
    expectRolls(rootOfTurn('Fire', undefined, hp), 'earthquake', true, hp, first);
  });
});

describe('doubles: the kill table of a Stellar hit holds the simulator\'s rolls', () => {
  const STONE_EDGE = 'move stoneedge 1 terastallize, move splash';
  const NEXT = 'move stoneedge 1, move splash';
  const IDLE = 'move splash, move splash';
  const doubles = (tera: string, setup?: (battle: Battle) => void) => rootOf('gen9doublescustomgame', [garchomp(tera), wall('Snorlax')], [wall(), wall('Chansey')], setup);

  test('the click turn: a first use of Rock', () => {
    const checked = checkedRolls(drawTurn(doubles('Stellar'), STONE_EDGE, IDLE));
    expect(checked.length).toBe(1);
    expect(checked.every(entry => entry.holds)).toBe(true);
    expect(checked[0].roll.snapshot.attacker.stellarBoostedTypes).toEqual([]);
  });

  test('the next turn: Rock is spent, a second use hits without the boost', () => {
    const root = doubles('Stellar', afterClick(STONE_EDGE, IDLE));
    const checked = checkedRolls(drawTurn(root, NEXT, IDLE));
    expect(checked.length).toBe(1);
    expect(checked.every(entry => entry.holds)).toBe(true);
    expect(checked[0].roll.snapshot.attacker.stellarBoostedTypes).toContain('Rock');
  });

  test('a first use of another type after the click is boosted again', () => {
    const root = doubles('Stellar', afterClick(STONE_EDGE, IDLE));
    const checked = checkedRolls(drawTurn(root, 'move flamethrower 1, move splash', IDLE));
    expect(checked.length).toBe(1);
    expect(checked.every(entry => entry.holds)).toBe(true);
  });

  test('the option\'s headline equals the simulator on the click turn', () => {
    const key = { script: 'p1a:stoneedge>p2a', target: { side: 1 as const, slot: 0 } };
    const make = (hp?: number) => doubles('Stellar', battle => { if (hp) battle.sides[1].active[0]!.sethp(hp); });
    const damages = simDamages(make(), STONE_EDGE, IDLE, key);
    const hp = [...damages.normal].sort((a, b) => a - b)[8];
    const [odds] = pairKoOdds(positionBattle(make(hp)), 'p1', [STONE_EDGE]);
    // Stone Edge crits more often (a ratio of 2 reads 1/8).
    const crit = 1 / 8;
    expect(odds?.killFraction).toBeCloseTo((1 - crit) * killing(damages.normal, hp) / 16 + crit * killing(damages.crit, hp) / 16, 10);
  });
});
