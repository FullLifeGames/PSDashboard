import { PRNG } from '@pkmn/sim';
import type { Battle, PRNGSeed } from '@pkmn/sim';
import { serializeBattleStable } from '../forward-model.ts';
import { forkBattleWithPrng } from '../forward/position.ts';
import { submittableChoice } from '../forward/request-moves.ts';
import { applyChoice, resolveForcedSwitches } from '../forward/switches.ts';
import { sideIndex } from '@fulllifegames/replay-core';
import { playBlockPart } from '../dice/logged-block.ts';
import type { ForcedDie } from '../dice/types.ts';
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
  /** Round 86 (T306): while a forced part plays, its own observer writes the answers down and this stream stays silent. */
  muted = false;

  attach(battle: Battle): void {
    this.battle = battle;
  }

  override random(from?: number, to?: number): number {
    const value = super.random(from, to);
    if (!this.muted) this.record(from, to, value);
    return value;
  }

  record(from: number | undefined, to: number | undefined, value: number): void {
    const key = actionKey(this.battle);
    if (key === null) return;
    const draws = this.rolls.get(key);
    if (draws) draws.push({ from, to, value });
    else this.rolls.set(key, [{ from, to, value }]);
  }
}

/**
 * Round 82 (forced dice): the logged turn a branch opens on, as the first turn of the branch has to read it: the block's lines
 * (the log's own results) and the commands the log's players sent. The dice module joins the log's results to the dice the user
 * forces (gate answer 19a) and finds the actions the user changed by comparing the commands.
 */
export interface LoggedTurn {
  turn: number;
  lines: readonly string[];
  choices: { p1: string; p2: string };
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

  /** The logged turn the position stands at (round 82); null for a stream built without it. */
  readonly loggedTurn: LoggedTurn | null;

  constructor(seed: PRNGSeed, logged: LoggedRolls, turn: number, loggedTurn?: Omit<LoggedTurn, 'turn'>) {
    super(seed);
    this.logged = logged;
    this.turn = turn;
    this.loggedTurn = loggedTurn ? { turn, ...loggedTurn } : null;
  }

  attach(battle: Battle): void {
    this.battle = battle;
  }

  /**
   * Round 82 (forced dice): a second stream at this one's place, with the same logged dice and the cursors where they stand.
   * The copy of a battle plays the natural turn on it while the original stays where it is. It is not attached: the caller
   * attaches it to the battle it plays on.
   */
  fork(): LoggedRollPRNG {
    const copy = new LoggedRollPRNG(this.getSeed(), this.logged, this.turn, this.loggedTurn ?? undefined);
    for (const [key, cursor] of this.cursors) copy.cursors.set(key, cursor);
    return copy;
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

/**
 * Round 86 (the log's dice, T306): the draws of the logged turn as the reconstruction plays it now: the block's choices under the hidden
 * dice of `seed` with the log's dice forced (`dice`), part by part (the choices, then every forced replacement the log answers), so an action
 * the user leaves as logged rolls what the rebuilt position rolled, damage roll included. The draws the forced parts take are the answers
 * the module gave, not the stream's values: the same die forced again reads the same. Null when the copy cannot play the turn; the caller
 * falls back to the seed search then.
 */
export function recordForcedRolls(
  battle: Battle, dice: readonly ForcedDie[], seed: PRNGSeed, p1Choice: string, p2Choice: string, forced: { p1: string[]; p2: string[] },
): LoggedRolls | null {
  try {
    const recorder = new RollRecorder(seed);
    const copy = forkBattleWithPrng({ serialized: serializeBattleStable(battle) }, recorder);
    const part = (choices: { side: 'p1' | 'p2'; choice: string }[]): void => {
      const commands = choices.map(({ side, choice }) => ({ side, command: submittable(copy, side, choice) }));
      recorder.muted = true;
      try {
        playBlockPart({
          live: copy, dice, commands, observe: (from, to, value) => recorder.record(from, to, value),
          write: () => { for (const { side, choice } of choices) applyChoice(copy, side, choice); },
        });
      } finally {
        recorder.muted = false;
      }
    };
    part([{ side: 'p1', choice: p1Choice }, { side: 'p2', choice: p2Choice }]);
    const cursors = { p1: { current: 0 }, p2: { current: 0 } };
    for (let guard = 0; guard < 6 && !copy.ended; guard++) {
      const answers = (['p1', 'p2'] as const).flatMap((side, index) => {
        const choice = hasForceSwitch(copy, index) ? buildForcedSwitchChoice(copy, index, forced[side], cursors[side]) : null;
        return choice ? [{ side, choice }] : [];
      });
      if (answers.length === 0) break;
      part(answers);
    }
    resolveForcedSwitches(copy, seed);
    return recorder.rolls;
  } catch {
    return null;
  }
}

/** The choice as `applyChoice` submits it, so the natural turn's copy takes the same command the live copy does. */
function submittable(battle: Battle, side: 'p1' | 'p2', choice: string): string {
  const [first] = choice.split(' > ');
  return submittableChoice(battle.sides[sideIndex(side)], first);
}
