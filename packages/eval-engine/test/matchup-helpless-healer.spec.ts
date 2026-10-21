import { describe, expect, test } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { createMatchupCache, evaluatePosition, type StaticRuleset } from '../src/eval-function';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * T248 (round 73), the matchup jump (gen8ou-573756 turn 73, Toxapex 282 to 281 of 303: 0.017 in the grade): a healer
 * that the faster foe takes down in one hit never gets to heal, but the race priced its Recover PP as a wall as soon as
 * the hit left one point of HP over the KO, and as a lost race one point lower. A hit you take must not raise your
 * grade, and a hit you land must not lower it, so each board here is scanned one HP point at a time from the full HP of
 * the healer down to a fifth of it, and the largest step the wrong way is held to the 1e-3 of the round's design gate (2a). The healer stands in front, or on the bench behind fillers; Scarlet/Violet and Champions,
 * singles and doubles.
 */

await loadSimMods('gen9championscustomgame');

const JUMP = 1e-3;

/** `attack` and `strikerHp` set the striker so that its hit stays under the healer's HP: the Champions stat table hits harder. */
interface Mode { name: string; format: string; ruleset: StaticRuleset; doubles: boolean; attack: number; strikerHp: number }
const MODES: Mode[] = [
  { name: 'Gen 9 singles', format: 'gen9customgame', ruleset: 'standard', doubles: false, attack: 0, strikerHp: 0.5 },
  { name: 'Champions singles', format: 'gen9championscustomgame', ruleset: 'champions', doubles: false, attack: -2, strikerHp: 0.9 },
  { name: 'VGC doubles', format: 'gen9doublescustomgame', ruleset: 'vgc', doubles: true, attack: 0, strikerHp: 0.5 },
  { name: 'Champions doubles', format: 'gen9championsdoublescustomgame', ruleset: 'champions', doubles: true, attack: -2, strikerHp: 0.9 },
];

const healer = () => set('Toxapex', ['recover', 'slackoff', 'scald', 'splash']);
/** A Choice Scarf Garchomp: it moves first and takes most of a Toxapex with its High Horsepower. */
const striker = () => set('Garchomp', ['highhorsepower', 'splash'], { item: 'Choice Scarf' });
const partner = () => set('Clefable', ['splash']);

interface Board { battle: Battle; healer: Pokemon; striker: Pokemon }

/**
 * The healer on side `healerSide` against the striker, a poisoned Garchomp (at half HP in Scarlet/Violet: the healer's Scald and the poison
 * finish it in two turns while the healer holds, in four when it only takes the poison). Every other mon Splashes: a
 * Clefable beside them in doubles. `benched` puts the healer behind fillers, so it fights from the bench.
 */
function board(mode: Mode, healerSide: 0 | 1, benched = false): Board {
  const fillers = Array.from({ length: (mode.doubles ? 2 : 1) - (benched ? 0 : 1) }, partner);
  const withHealer = benched ? [...fillers, healer()] : [healer(), ...fillers];
  const withStriker = [striker(), ...(mode.doubles ? [partner()] : [])];
  const battle = battleOf(mode.format, healerSide === 0 ? withHealer : withStriker, healerSide === 0 ? withStriker : withHealer);
  const found = (side: 0 | 1, species: string) => battle.sides[side].pokemon.find(mon => mon.species.name === species)!;
  const made = { battle, healer: found(healerSide, 'Toxapex'), striker: found(1 - healerSide as 0 | 1, 'Garchomp') };
  made.striker.sethp(Math.floor(made.striker.maxhp * mode.strikerHp));
  made.striker.setStatus('psn');
  made.striker.boosts.atk = mode.attack;
  return made;
}

/**
 * The largest step the wrong way when the body goes down one HP point at a time from its maximum to a fifth of it: the
 * score of p1 rises as p1's body loses HP (`own`), or falls as p2's body loses HP.
 */
function worstStep(mode: Mode, battle: Battle, body: Pokemon, own: boolean): number {
  const scoreAt = (hp: number): number => {
    body.sethp(hp);
    return evaluatePosition(battle, createMatchupCache(mode.ruleset));
  };
  let previous = scoreAt(body.maxhp);
  let worst = 0;
  for (let hp = body.maxhp - 1; hp >= Math.ceil(body.maxhp / 5); hp--) {
    const score = scoreAt(hp);
    worst = Math.max(worst, own ? score - previous : previous - score);
    previous = score;
  }
  return worst;
}

describe.each(MODES)('$name', mode => {
  test('the simulator: the striker takes most of the healer in one hit, so there is a KO threshold inside its HP', () => {
    const { battle, healer: toxapex } = board(mode, 0);
    battle.choose('p1', mode.doubles ? 'move 4, move 1' : 'move 4');
    battle.choose('p2', mode.doubles ? 'move 1 1, move 1' : 'move 1');
    const taken = toxapex.maxhp - toxapex.hp;
    expect(taken).toBeGreaterThan(toxapex.maxhp / 2);
    expect(taken).toBeLessThan(toxapex.maxhp);
  });

  describe.each([{ place: 'in front', benched: false }, { place: 'on the bench', benched: true }])('the healer $place', ({ benched }) => {
    test('own HP down never raises the score by more than 1e-3, one HP point at a time', () => {
      const { battle, healer: toxapex } = board(mode, 0, benched);
      expect(worstStep(mode, battle, toxapex, true)).toBeLessThanOrEqual(JUMP);
    });

    test('foe HP down never lowers the score by more than 1e-3, one HP point at a time', () => {
      const { battle, healer: toxapex } = board(mode, 1, benched);
      expect(worstStep(mode, battle, toxapex, false)).toBeLessThanOrEqual(JUMP);
    });
  });
});
