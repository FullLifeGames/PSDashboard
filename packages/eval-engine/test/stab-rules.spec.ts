import { test, expect, describe } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { singleMoveFraction } from '../src/score/threat';
import { landedMove } from '../src/score/move-facts';
import { ScriptedPRNG } from '../src/forward/scripted-prng';
import { active, set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 63 (T81 step 4, T71): STAB by the game's rules after a Tera click,
 * held against the damage the simulator deals (modifyDamage: an old type or
 * the Tera type 1.5, both 2.0, Stellar 2.0 on an old type and 1.2 elsewhere
 * on the first use of a type, Adaptability through its own handler; getDamage:
 * a Tera-typed move under 60 power hits as 60). The rule was built in round
 * 54 (d8eb0a3) and parked; it lands with T81 without a refit (decision 4).
 */

const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);

/**
 * Plays the turns (p1's choices; p2 Splashes), the roll of p1's move pinned to the maximum, a sure hit and no
 * crit, and before each turn reads our fraction of that move in HP. Returns [ours, the simulator's damage].
 */
function turns(format: string, attacker: PokemonSet, defender: PokemonSet, id: string, choices: string[]): [number, number][] {
  const battle = battleOf(format, [attacker], [defender]);
  const prng = new ScriptedPRNG([1, 2, 3, 4], new Map([[`p1:${id}`, { hit: true, crit: false, roll: 0 }]]));
  prng.attach(battle);
  battle.prng = prng;
  return choices.map(choice => {
    const [user, target] = [active(battle, 0), active(battle, 1)];
    if (choice.endsWith('terastallize')) user.terastallized = user.teraType;
    const ours = singleMoveFraction(user, target, id, battle) * target.maxhp;
    if (choice.endsWith('terastallize')) user.terastallized = undefined as never;
    const before = target.hp;
    battle.choose('p1', choice);
    battle.choose('p2', 'move 1');
    const dealt = before - target.hp;
    target.hp = target.maxhp;
    return [ours, dealt];
  });
}

function expectNear([ours, sim]: [number, number], label: string) {
  expect(Math.abs(ours - sim) / sim, `${label}: ours ${ours.toFixed(1)} against the sim's ${sim}`).toBeLessThan(0.03);
}

// Level 50: Blissey survives every hit, so the HP it loses is the whole damage.
const chomp = (teraType: string, move: string) => set('Garchomp', [move], { teraType, level: 50 });

describe('STAB by the rules after a Tera click (round 63, T81)', () => {
  test.each([
    ['Ground', 'earthquake', 'an old type that is also the Tera type: 2.0'],
    ['Fire', 'firefang', 'the Tera type alone: 1.5'],
    ['Fire', 'earthquake', 'an old type under another Tera type: 1.5'],
    ['Fire', 'icefang', 'neither: 1.0'],
  ])('Tera %s, %s (%s)', (teraType, move, label) => {
    for (const row of turns('gen9customgame', chomp(teraType, move), splash('Blissey'), move, ['move 1', 'move 1 terastallize', 'move 1'])) {
      expectNear(row, label);
    }
  });

  test('Stellar: 2.0 on an old type and 1.2 elsewhere on the first use of a type, the plain rate after it', () => {
    for (const move of ['earthquake', 'firefang']) {
      for (const row of turns('gen9customgame', chomp('Stellar', move), splash('Blissey'), move, ['move 1 terastallize', 'move 1'])) {
        expectNear(row, `Stellar ${move}`);
      }
    }
  });

  test('Adaptability asks its own handler: 2.0, 2.25 on the Tera type, nothing for an old type under another Tera type', () => {
    // Toxapex takes Normal and Ghost moves neutrally and survives them from a level-50 Porygon-Z.
    const zee = (teraType: string, move: string) => set('Porygon-Z', [move], { ability: 'Adaptability', teraType, level: 50 });
    for (const [teraType, move] of [['Normal', 'hypervoice'], ['Ghost', 'hypervoice'], ['Ghost', 'shadowball']]) {
      for (const row of turns('gen9customgame', zee(teraType, move), splash('Toxapex'), move, ['move 1', 'move 1 terastallize'])) {
        expectNear(row, `Adaptability Tera ${teraType} ${move}`);
      }
    }
  });

  test('a Tera-typed move under 60 power hits as 60 after the click, not a priority or multi-hit move', () => {
    for (const [teraType, move] of [['Fire', 'flamecharge'], ['Normal', 'quickattack']]) {
      const rows = turns('gen9customgame', chomp(teraType, move), splash('Blissey'), move, ['move 1', 'move 1 terastallize']);
      rows.forEach(row => expectNear(row, `Tera ${teraType} ${move}`));
    }
    // A multi-hit move: the first hit's damage (its roll pinned) against ours per hit.
    const battle = battleOf('gen9customgame', [chomp('Water', 'watershuriken')], [splash('Blissey')]);
    const prng = new ScriptedPRNG([1, 2, 3, 4], new Map([['p1:watershuriken', { hit: true, crit: false, roll: 0 }]]));
    prng.attach(battle);
    battle.prng = prng;
    const [user, target] = [active(battle, 0), active(battle, 1)];
    user.terastallized = user.teraType;
    const perHit = singleMoveFraction(user, target, 'watershuriken', battle) * target.maxhp /
      landedHits(battle, user, target, 'watershuriken');
    user.terastallized = undefined as never;
    const from = battle.log.length;
    battle.choose('p1', 'move 1 terastallize');
    battle.choose('p2', 'move 1');
    const firstHit = battle.log.slice(from).find(line => line.startsWith('|-damage|p2a'))!;
    // A hit of a few HP: the sim's integer steps weigh more than 3 %, the 60 floor would read four times as much.
    expect(Math.abs(perHit - (target.maxhp - Number(firstHit.split('|')[3].split('/')[0])))).toBeLessThan(2);
  });

  test('doubles: Tera Ground High Horsepower into one foe of two', () => {
    const battle = battleOf('gen9doublescustomgame',
      [set('Garchomp', ['highhorsepower'], { teraType: 'Ground', level: 50 }), splash('Pikachu')], [splash('Blissey'), splash('Chansey')]);
    const prng = new ScriptedPRNG([1, 2, 3, 4], new Map([['p1:highhorsepower', { hit: true, crit: false, roll: 0 }]]));
    prng.attach(battle);
    battle.prng = prng;
    const [user, target] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    user.terastallized = user.teraType;
    const ours = singleMoveFraction(user, target, 'highhorsepower', battle) * target.maxhp;
    user.terastallized = undefined as never;
    const before = target.hp;
    battle.choose('p1', 'move 1 1 terastallize, move 1');
    battle.choose('p2', 'move 1, move 1');
    expectNear([ours, before - target.hp], 'doubles Tera Ground High Horsepower');
  });
});

function landedHits(battle: Battle, user: Pokemon, target: Pokemon, id: string): number {
  return landedMove(user, target, battle.dex.moves.get(id), battle).landing ?? 1;
}
