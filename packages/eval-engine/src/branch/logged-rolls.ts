import { PRNG } from '@pkmn/sim';
import type { Battle, PRNGSeed } from '@pkmn/sim';
import { serializeBattleStable } from '../forward-model.ts';
import { forkBattleWithPrng } from '../forward/position.ts';
import { applyChoice, resolveForcedSwitches } from '../forward/switches.ts';
import { buildForcedSwitchChoice, hasForceSwitch } from './corrections.ts';

/**
 * Round 73 (T232): the logged dice of every action in a branch's first turn. The arrival plays its turn under the seed whose
 * rolls reproduce the log (arrival-dice.ts), but the actions draw from ONE stream in order: when the user changes the faster
 * action's move, the number of draws before the slower action changes, and the slower action rolls other numbers than the log
 * has. A recorder plays the logged choices once on a copy and writes down, per action (side, slot and move in flight), the
 * numbers the sim drew for it; the branch's own PRNG answers an action that is still in the log with those numbers.
 *
 * Every draw is a call of PRNG#random: randomChance (accuracy, crit, secondary effects, paralysis, thaw), sample, shuffle and
 * the damage roll all reach it, so one mechanism covers the damage roll and the secondary effect. A changed action (another
 * move, another slot) has no record and draws from the seed. Draws outside any action (speed ties, residual rolls) are never
 * replaced. The underlying stream advances on every call, answered or not, so a turn whose actions all stay as logged draws
 * exactly the numbers the plain seed gives (nothing moves for the search or the replay), and a replaced answer moves no later
 * draw of the stream.
 */

interface Draw { from: number | undefined; to: number | undefined; value: number }

/** The draws of each logged action, in order, keyed by `actionKey`. */
export type LoggedRolls = ReadonlyMap<string, readonly Draw[]>;

/** `${slot}:${move id}` of the move in flight (the slot names the side: p1a, p2b), or null outside an action. */
export function actionKey(battle: Pick<Battle, 'activeMove' | 'activePokemon'> | null): string | null {
  const move = battle?.activeMove;
  const pokemon = battle?.activePokemon;
  return move && pokemon ? `${pokemon.getSlot()}:${move.id}` : null;
}

/** Writes down the draws of every action while a copy of the battle plays the logged choices. */
class RollRecorder extends PRNG {
  readonly rolls = new Map<string, Draw[]>();
  private battle: Battle | null = null;

  attach(battle: Battle): void {
    this.battle = battle;
  }

  override random(from?: number, to?: number): number {
    const value = super.random(from, to);
    const key = actionKey(this.battle);
    if (key === null) return value;
    const draws = this.rolls.get(key);
    if (draws) draws.push({ from, to, value });
    else this.rolls.set(key, [{ from, to, value }]);
    return value;
  }
}

/**
 * The branch's dice for its first turn: the plain seed stream, except that an action the log has plays its logged draws.
 * `turn` is the turn the position stands at; from the next turn on this is the plain PRNG again.
 */
export class LoggedRollPRNG extends PRNG {
  private battle: Battle | null = null;
  private readonly logged: LoggedRolls;
  private readonly turn: number;
  private readonly cursors = new Map<string, number>();

  constructor(seed: PRNGSeed, logged: LoggedRolls, turn: number) {
    super(seed);
    this.logged = logged;
    this.turn = turn;
  }

  attach(battle: Battle): void {
    this.battle = battle;
  }

  override random(from?: number, to?: number): number {
    const natural = super.random(from, to);
    const battle = this.battle;
    if (!battle || battle.turn !== this.turn) return natural;
    const key = actionKey(battle);
    const draws = key === null ? undefined : this.logged.get(key);
    if (!key || !draws) return natural;
    const cursor = this.cursors.get(key) ?? 0;
    const next = draws[cursor];
    // The next logged draw of this action must be the same kind of draw; a branch that took another road inside the action
    // (a target that fainted, a secondary the log did not reach) falls back to the seed instead of misreading a roll.
    if (!next || next.from !== from || next.to !== to) return natural;
    this.cursors.set(key, cursor + 1);
    return next.value;
  }
}

/**
 * The draws of the logged turn: the block's choices (and its forced replacements, answered from the log) played under the
 * aligned seed on a copy of the position. Null when the copy cannot play them; the caller keeps the plain seed then.
 */
export function recordLoggedRolls(
  battle: Battle, seed: PRNGSeed, p1Choice: string, p2Choice: string, forced: { p1: string[]; p2: string[] },
): LoggedRolls | null {
  try {
    const recorder = new RollRecorder(seed);
    const copy = forkBattleWithPrng({ serialized: serializeBattleStable(battle) }, recorder);
    applyChoice(copy, 'p1', p1Choice);
    applyChoice(copy, 'p2', p2Choice);
    const cursors = { p1: { current: 0 }, p2: { current: 0 } };
    for (let guard = 0; guard < 6 && !copy.ended; guard++) {
      const answers = (['p1', 'p2'] as const).flatMap((side, index) => {
        const choice = hasForceSwitch(copy, index) ? buildForcedSwitchChoice(copy, index, forced[side], cursors[side]) : null;
        return choice ? [{ side, choice }] : [];
      });
      if (answers.length === 0) break;
      for (const { side, choice } of answers) if (!copy.choose(side, choice)) return null;
    }
    resolveForcedSwitches(copy, seed);
    return recorder.rolls;
  } catch {
    return null;
  }
}
