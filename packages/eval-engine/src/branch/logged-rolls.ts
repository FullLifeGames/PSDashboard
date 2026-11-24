import { PRNG } from '@pkmn/sim';
import type { Battle, PRNGSeed } from '@pkmn/sim';
import { serializeBattleStable } from '../forward-model.ts';
import { forkBattleWithPrng } from '../forward/position.ts';
import { applyChoice, resolveForcedSwitches } from '../forward/switches.ts';
import { playBlockOnCopy } from '../dice/logged-block.ts';
import type { ForcedDie } from '../dice/types.ts';
import { buildForcedSwitchChoice, hasForceSwitch } from './corrections.ts';
import type { ProtocolBench } from './team-order.ts';

// Design: ADR 0022.
// The stream advances on every call, answered or not, so a replaced answer moves no later draw.

interface Draw { from: number | undefined; to: number | undefined; value: number }

export type LoggedRolls = ReadonlyMap<string, readonly Draw[]>;

/** `${slot}:${move id}` of the move in flight (the slot names the side: p1a, p2b), or null outside an action. */
export function actionKey(battle: Pick<Battle, 'activeMove' | 'activePokemon'> | null): string | null {
  const move = battle?.activeMove;
  const pokemon = battle?.activePokemon;
  return move && pokemon ? `${pokemon.getSlot()}:${move.id}` : null;
}

class RollRecorder extends PRNG {
  readonly rolls = new Map<string, Draw[]>();
  private battle: Battle | null = null;
  /** While a forced part plays, its own observer writes the answers down and this stream stays silent. */
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

export interface LoggedTurn {
  turn: number;
  lines: readonly string[];
  choices: { p1: string; p2: string };
}

/** The branch's dice for its first turn: the plain seed stream, but an action the log has plays its logged draws. */
export class LoggedRollPRNG extends PRNG {
  private battle: Battle | null = null;
  private readonly logged: LoggedRolls;
  private readonly turn: number;
  private readonly cursors = new Map<string, number>();

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

  /** A second stream at this one's place, not attached: the caller attaches it to the battle the copy plays on. */
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
    // The next logged draw of this action must be the same kind of draw; a branch that took another road in it
    // (a target that fainted, a secondary the log did not reach) falls back to the seed instead of misreading a roll.
    if (!next || next.from !== from || next.to !== to) return natural;
    this.cursors.set(key, cursor + 1);
    return next.value;
  }
}

/** The logged turn's draws, played under the aligned seed on a copy; null when it cannot play. */
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

// Forced parts record the dice module's answers, not the stream's values: the same die forced again reads the same.
export function recordForcedRolls(
  battle: Battle, dice: readonly ForcedDie[], seed: PRNGSeed, p1Choice: string, p2Choice: string, forced: { p1: string[]; p2: string[] },
  bench?: (side: 'p1' | 'p2') => ProtocolBench | undefined,
): LoggedRolls | null {
  try {
    const recorder = new RollRecorder(seed);
    const copy = forkBattleWithPrng({ serialized: serializeBattleStable(battle) }, recorder);
    playBlockOnCopy({
      copy, dice, choices: { p1: p1Choice, p2: p2Choice }, forced, bench, observe: (from, to, value) => recorder.record(from, to, value),
      around: run => {
        recorder.muted = true;
        try {
          run();
        } finally {
          recorder.muted = false;
        }
      },
    });
    resolveForcedSwitches(copy, seed);
    return recorder.rolls;
  } catch {
    return null;
  }
}
