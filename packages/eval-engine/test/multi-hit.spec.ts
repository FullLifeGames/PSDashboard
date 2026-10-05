import { test, expect, describe } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { landedMove } from '../src/score/move-facts';
import { singleMoveFraction } from '../src/score/threat';
import { ScriptedPRNG } from '../src/forward/scripted-prng';
import { active, set } from './move-oracle';
import { battleOf, fingerprint, powerInTurn } from './power-oracle';

/**
 * Round 63 (T81 step 2): a multi-hit move prices every hit, a sure crit its
 * crit. The hit counts are the simulator's: a fixed count from the Dex, the
 * 2-to-5 distribution the hit loop samples, Skill Link and Loaded Dice, the
 * per-hit power and accuracy chain of Triple Axel, and Dragon Darts' one hit
 * per foe in doubles.
 */

const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const ours = (battle: Battle, id: string, slot = 0) =>
  landedMove(active(battle, 0), battle.sides[1].active[slot], battle.dex.moves.get(id), battle);
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** BasePower events of one turn: one per hit and target. */
function hitsInTurn(format: string, attacker: PokemonSet, defender: PokemonSet, id: string, seed: string): number {
  return powerInTurn(battleOf(format, [attacker], [defender], seed), { p1: 'move 1', p2: 'move 1' }, id).length;
}

describe('multi-hit and sure crits in the static (round 63, T81)', () => {
  test('a fixed hit count multiplies the power: Double Hit, Surging Strikes, Triple Dive, Dragon Darts into a lone foe', () => {
    for (const id of ['doublehit', 'surgingstrikes', 'tripledive', 'dragondarts']) {
      const battle = battleOf('gen9customgame', [set('Garchomp', [id])], [splash('Snorlax')]);
      const power = ours(battle, id);
      const crit = battle.dex.moves.get(id).willCrit ? 1.5 : 1;
      const hits = powerInTurn(battle, { p1: 'move 1', p2: 'move 1' }, id).length;
      expect(power.landing, id).toBe(hits * crit);
    }
  });

  test("2 to 5 hits price at the mean of the simulator's own distribution, gen 9 and gen 4", () => {
    for (const format of ['gen9customgame', 'gen4customgame']) {
      const battle = battleOf(format, [set('Breloom', ['bulletseed'])], [splash('Snorlax')]);
      const sampled: number[][] = [];
      const sample = battle.sample.bind(battle);
      battle.sample = <T>(items: readonly T[]): T => {
        sampled.push(items as unknown as number[]);
        return sample(items);
      };
      const power = ours(battle, 'bulletseed');
      powerInTurn(battle, { p1: 'move 1', p2: 'move 1' }, 'bulletseed');
      expect(sampled.length, format).toBe(1);
      expect(power.landing, format).toBeCloseTo(mean(sampled[0]), 10);
    }
  });

  test("Skill Link takes the top count, Loaded Dice the simulator's 4-or-5 rule and Population Bomb's 4 to 10", () => {
    const link = battleOf('gen9customgame', [set('Cinccino', ['bulletseed'], { ability: 'Skill Link' })], [splash('Snorlax')]);
    expect(ours(link, 'bulletseed').landing).toBe(powerInTurn(link, { p1: 'move 1', p2: 'move 1' }, 'bulletseed').length);
    const seeds = Array.from({ length: 200 }, (_, index) => `${index + 1},2,3,4`);
    const dice = (id: string) => set('Maushold', [id], { item: 'Loaded Dice' });
    // Shuckle outlasts ten hits, so every turn counts its hits to the end; a turn whose first hit
    // misses counts no hit, and the static never prices that roll (no move's accuracy enters it).
    const diceBattle = (id: string) => battleOf('gen9customgame', [dice(id)], [splash('Shuckle')]);
    for (const id of ['bulletseed', 'populationbomb']) {
      const counted = mean(seeds.map(seed => hitsInTurn('gen9customgame', dice(id), splash('Shuckle'), id, seed)).filter(hits => hits > 0));
      expect(ours(diceBattle(id), id).landing, id).toBeCloseTo(counted, 0);
    }
    expect(ours(diceBattle('bulletseed'), 'bulletseed').landing).toBe(4.5);
    expect(ours(diceBattle('populationbomb'), 'populationbomb').landing).toBe(7);
  });

  test("Triple Axel sums the per-hit power the simulator's callback gives, each later hit at the move's accuracy", () => {
    // A seed on which all three hits land, to read the per-hit power from the turn.
    let powers: number[] = [];
    for (let seed = 1; powers.length < 3; seed++) {
      const battle = battleOf('gen9customgame', [set('Weavile', ['tripleaxel'])], [splash('Snorlax')], `${seed},2,3,4`);
      powers = powerInTurn(battle, { p1: 'move 1', p2: 'move 1' }, 'tripleaxel').map(seen => seen.basePower);
    }
    expect(powers).toEqual([20, 40, 60]);
    const battle = battleOf('gen9customgame', [set('Weavile', ['tripleaxel'])], [splash('Snorlax')]);
    const accuracy = Number(battle.dex.moves.get('tripleaxel').accuracy) / 100;
    const power = ours(battle, 'tripleaxel');
    expect(power.basePower * (power.landing ?? 1)).toBeCloseTo(powers.reduce((sum, hit, index) => sum + hit * accuracy ** index, 0), 10);
    // Population Bomb: ten hits at 20, the chain of its 90 % accuracy.
    const bomb = ours(battleOf('gen9customgame', [set('Maushold', ['populationbomb'])], [splash('Snorlax')]), 'populationbomb');
    expect(bomb.basePower * (bomb.landing ?? 1)).toBeCloseTo(20 * Array.from({ length: 10 }, (_, index) => 0.9 ** index).reduce((a, b) => a + b, 0), 10);
  });

  test('asking the per-hit power and the crit leaves a debug-mode battle untouched', () => {
    const battle = battleOf('gen9customgame', [set('Weavile', ['splash'])], [splash('Snorlax', { ability: 'Battle Armor' })]);
    for (const id of ['tripleaxel', 'triplekick', 'surgingstrikes', 'stormthrow', 'bulletseed', 'populationbomb']) {
      const before = fingerprint(battle, [active(battle, 0), active(battle, 1)], id);
      for (let i = 0; i < 1100; i++) ours(battle, id);
      expect(fingerprint(battle, [active(battle, 0), active(battle, 1)], id), id).toBe(before);
    }
  });

  test('Dragon Darts hits each of two foes once in doubles, twice into a lone foe', () => {
    const two = battleOf('gen9doublescustomgame', [set('Dragapult', ['dragondarts']), splash('Pikachu')], [splash('Snorlax'), splash('Garchomp')]);
    expect([ours(two, 'dragondarts', 0).landing, ours(two, 'dragondarts', 1).landing]).toEqual([undefined, undefined]);
    const seen = powerInTurn(two, { p1: 'move 1 1, move 1', p2: 'move 1, move 1' }, 'dragondarts');
    expect(seen.map(hit => hit.target)).toEqual(['Snorlax', 'Garchomp']);
    // The partner fainted with nobody left to replace it: one foe on the field.
    const lone = battleOf('gen9doublescustomgame', [set('Dragapult', ['dragondarts']), splash('Pikachu')], [splash('Snorlax'), splash('Garchomp')]);
    lone.sides[1].active[1].faint();
    lone.faintMessages();
    expect(ours(lone, 'dragondarts', 0).landing).toBe(2);
    expect(powerInTurn(lone, { p1: 'move 1 1, move 1', p2: 'move 1, pass' }, 'dragondarts').length).toBe(2);
  });

  test('a sure crit prices the crit multiplier of its generation; Battle Armor blocks it', () => {
    for (const [format, crit] of [['gen9customgame', 1.5], ['gen6customgame', 1.5], ['gen5customgame', 2]] as const) {
      const damage = (ability: string) => {
        const battle = battleOf(format, [set('Throh', ['stormthrow'])], [splash('Snorlax', { ability })]);
        const prng = new ScriptedPRNG([1, 2, 3, 4], new Map([['p1:stormthrow', { hit: true, roll: 0 }]]));
        prng.attach(battle);
        battle.prng = prng;
        const before = active(battle, 1).hp;
        battle.choose('p1', 'move 1');
        battle.choose('p2', 'move 1');
        return before - active(battle, 1).hp;
      };
      expect(damage('No Ability') / damage('Battle Armor'), format).toBeCloseTo(crit, 1);
      const sure = battleOf(format, [set('Throh', ['stormthrow'])], [splash('Snorlax')]);
      const armored = battleOf(format, [set('Throh', ['stormthrow'])], [splash('Snorlax', { ability: 'Battle Armor' })]);
      expect(ours(sure, 'stormthrow').landing, format).toBe(crit);
      expect(ours(armored, 'stormthrow').landing, format).toBeUndefined();
      expect(singleMoveFraction(active(sure, 0), active(sure, 1), 'stormthrow', sure))
        .toBeCloseTo(crit * singleMoveFraction(active(armored, 0), active(armored, 1), 'stormthrow', armored), 10);
    }
  });
});
