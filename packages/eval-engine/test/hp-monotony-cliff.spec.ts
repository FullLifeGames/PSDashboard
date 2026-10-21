import { describe, expect, test } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { createMatchupCache, evaluatePosition, type StaticRuleset } from '../src/eval-function';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * T248 (round 73), the race flip: a stage that "made the difference" in the 1v1 race of boostsBiting started or stopped
 * counting at one HP point, so a hit you take could raise your grade (own HP down) and a hit you land could lower it
 * (foe HP down), by up to 0.15 in singles (gen8ou-573756 turn 73, Kyurem 322 to 321 of 405). Each board here is scanned
 * one HP point at a time over the whole range of the body, and the largest step the wrong way is held to the 1e-3 of
 * the round's design gate (2a). The tables that weigh boostsBiting are the ones read: standard singles, VGC doubles and
 * the Champions tables (Doubles OU weighs `boosts` and not the race; its stage rule is the relation of T249).
 */

await loadSimMods('gen9championscustomgame');

const JUMP = 1e-3;
const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);

interface Mode { name: string; format: string; ruleset: StaticRuleset; doubles: boolean }
const MODES: Mode[] = [
  { name: 'Gen 9 singles', format: 'gen9customgame', ruleset: 'standard', doubles: false },
  { name: 'Champions singles', format: 'gen9championscustomgame', ruleset: 'champions', doubles: false },
  { name: 'VGC doubles', format: 'gen9doublescustomgame', ruleset: 'vgc', doubles: true },
  { name: 'Champions doubles', format: 'gen9championsdoublescustomgame', ruleset: 'champions', doubles: true },
];

interface Board { battle: Battle; holder: Pokemon; foe: Pokemon }

/** A Choice Scarf Garchomp (it moves first) against a Snorlax; in doubles each side brings a Splashing partner. */
function board(mode: Mode, foeMoves: string[]): Board {
  const mine = [set('Garchomp', ['crunch', 'splash'], { item: 'Choice Scarf' }), ...(mode.doubles ? [splash('Clefable')] : [])];
  const theirs = [set('Snorlax', [...foeMoves, 'splash']), ...(mode.doubles ? [splash('Clefable')] : [])];
  const battle = battleOf(mode.format, mine, theirs);
  return { battle, holder: battle.sides[0].active[0]!, foe: battle.sides[1].active[0]! };
}

/**
 * The largest step the wrong way when the body goes down one HP point at a time from its maximum: the score of p1 rises
 * as p1's body loses HP (`own`), or falls as p2's body loses HP.
 */
function worstStep(mode: Mode, battle: Battle, body: Pokemon, own: boolean): { size: number; at: number } {
  const scoreAt = (hp: number): number => {
    body.sethp(hp);
    return evaluatePosition(battle, createMatchupCache(mode.ruleset));
  };
  let previous = scoreAt(body.maxhp);
  let worst = { size: 0, at: body.maxhp };
  for (let hp = body.maxhp - 1; hp >= 1; hp--) {
    const score = scoreAt(hp);
    const size = own ? score - previous : previous - score;
    if (size > worst.size) worst = { size, at: hp };
    previous = score;
  }
  return worst;
}

describe.each(MODES)('$name', mode => {
  /** +2 Defense on the holder against a Snorlax whose Crunch it lives through for a while: the stage decides the race in a range of HP only. */
  function defense(): Board {
    const made = board(mode, ['crunch']);
    made.holder.boosts.def = 2;
    made.foe.sethp(Math.floor(made.foe.maxhp * 0.3));
    return made;
  }

  /** +2 Attack on the holder against a Snorlax that only splashes: the stage shortens the Crunch's clock while the Snorlax stands high. */
  function attack(): Board {
    const made = board(mode, []);
    made.holder.boosts.atk = 2;
    return made;
  }

  test('the simulator: the staged Crunch takes a part of the holder, so there is a range of HP in which the stage decides', () => {
    const { battle, holder } = defense();
    const doubles = battle.gameType === 'doubles';
    battle.choose('p1', doubles ? 'move 2, move 1' : 'move 2');
    battle.choose('p2', doubles ? 'move 1 1, move 1' : 'move 1');
    const taken = holder.maxhp - holder.hp;
    expect(taken).toBeGreaterThan(0);
    expect(taken).toBeLessThan(holder.maxhp / 2);
  });

  test('own HP down never raises the score by more than 1e-3, one HP point at a time (the stage that decides the race)', () => {
    const { battle, holder } = defense();
    expect(worstStep(mode, battle, holder, true).size).toBeLessThanOrEqual(JUMP);
  });

  test('foe HP down never lowers the score by more than 1e-3, one HP point at a time (the stage that shortens the clock)', () => {
    const { battle, foe } = attack();
    expect(worstStep(mode, battle, foe, false).size).toBeLessThanOrEqual(JUMP);
  });
});
