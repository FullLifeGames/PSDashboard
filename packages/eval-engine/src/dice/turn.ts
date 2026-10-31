import type { Battle } from '@pkmn/sim';
import type { BranchSlotChoice } from '../branch-choices.ts';
import { LoggedRollPRNG } from '../branch/logged-rolls.ts';
import { slotLetter } from '../branch/team-order.ts';
import { loggedDice, mergeLoggedDice, type LoggedOptions } from './logged-results.ts';
import { offeredDice } from './offer.ts';
import { playForcedTurn } from './play.ts';
import { secondariesIn } from './secondaries.ts';
import { dieKey, type DiceReport, type DieReport, type DieTook, type ForcedDie } from './types.ts';

/**
 * Round 82 (forced dice), step A6: the branch's turn through the dice module. `executeBranchChoices` loads this file with a
 * dynamic import when the slot choices carry a forced die (decision D11), so a turn without one never reaches it.
 *
 * - The user's dice come from the slot choices of both sides (`BranchSlotChoice.dice`, ADR 0001).
 * - On the first turn of a branch (the live PRNG is a `LoggedRollPRNG` that knows the logged turn) the dice the log shows for the
 *   actions the user leaves as logged join the user's dice (gate answer 19a), once the user forces a die in that turn. One place
 *   holds this choice: `FIRST_TURN_JOINS_LOG`.
 * - A turn can pause for a switch in the middle (U-turn, Volt Switch, Flip Turn, Parting Shot, Eject Button, Eject Pack, Emergency
 *   Exit, Wimp Out) and go on in a later `choose`. The forced dice span the whole turn: the pause leaves a `PendingTurn` that the
 *   next call picks up. Each call plays its part through `playForcedTurn`, so the natural copy plays the same switch choice, and
 *   each part ends the stream on the natural turn's seed at that place (decision D8): the parts chain into the whole turn.
 */

/** Gate answer 19a: the log's results join the user's dice on the first turn. The user may move this to "always" (open question). */
export const FIRST_TURN_JOINS_LOG = true;

/** What a turn that paused for a switch hands to the next call. */
export interface PendingTurn {
  turn: number;
  /** Every die the turn forces, the user's and the log's. */
  forced: readonly ForcedDie[];
  /** The user's own dice. */
  mine: readonly ForcedDie[];
  /** The reports of the user's dice so far, the best of the parts played. */
  reports: readonly DieReport[];
}

export interface BranchTurnInput {
  battle: Battle;
  commands: readonly { side: 'p1' | 'p2'; command: string }[];
  p1Choices: readonly (BranchSlotChoice | null)[];
  p2Choices: readonly (BranchSlotChoice | null)[];
  pending: PendingTurn | undefined;
  /** Writes the commands to the battle it gets and plays the turn out; runs on the copy and on the live battle. */
  play: (battle: Battle) => void;
}

export interface BranchTurnResult {
  /** The user's dice only, joined across the parts of the turn; undefined when the turn forced nothing. */
  report: DiceReport | undefined;
  pending: PendingTurn | null;
}

/** The dice the user forced, one per key (the first wins). */
export function userDice(...sides: readonly (readonly (BranchSlotChoice | null)[])[]): ForcedDie[] {
  const seen = new Set<string>();
  const dice: ForcedDie[] = [];
  for (const choice of sides.flat()) {
    for (const die of choice?.dice ?? []) {
      const key = dieKey(die.name);
      if (seen.has(key)) continue;
      seen.add(key);
      dice.push(die);
    }
  }
  return dice;
}

/** One slot's command fragment as the comparison reads it: the action and its aim. */
interface Fragment { kind: string; index: number; aim: number | undefined }

function fragmentOf(text: string): Fragment {
  const [kind, index, ...rest] = text.trim().split(' ');
  const aim = rest.find(token => /^[+-]?\d+$/.test(token));
  return { kind, index: Number.parseInt(index ?? '', 10), aim: aim === undefined ? undefined : Number.parseInt(aim, 10) };
}

/** An aim missing on one side is no change: the log's click and the resolved click write a spread move's aim differently. */
function sameAction(a: Fragment, b: Fragment): boolean {
  return a.kind === b.kind && a.index === b.index && (a.aim === undefined || b.aim === undefined || a.aim === b.aim);
}

const slotsOf = (side: 'p1' | 'p2', command: string): { slot: string; fragment: Fragment }[] =>
  command.split(',').map((text, index) => ({ slot: `${side}${slotLetter(index)}`, fragment: fragmentOf(text) }));

/**
 * Which slots the user acts differently in than the log: another move, another aim or a switch (`changed`), and the slots the
 * user switched (`switched`; the body that stood there leaves). Both sides' commands are compared fragment by fragment.
 */
export function turnChanges(
  logged: { p1: string; p2: string }, commands: readonly { side: 'p1' | 'p2'; command: string }[],
): { changed: Set<string>; switched: Set<string> } {
  const changed = new Set<string>();
  const switched = new Set<string>();
  for (const { side, command } of commands) {
    const was = slotsOf(side, logged[side]);
    for (const { slot, fragment } of slotsOf(side, command)) {
      const before = was.find(entry => entry.slot === slot)?.fragment;
      if (before && sameAction(before, fragment)) continue;
      changed.add(slot);
      if (fragment.kind === 'switch') switched.add(slot);
    }
  }
  return { changed, switched };
}

/** What the log cannot name (`LoggedOptions`): the move each body clicked, the checks each body stood under, the secondaries of every move. */
function loggedOptions(battle: Battle, logged: { p1: string; p2: string }): LoggedOptions {
  const clicked = new Map<string, string>();
  const checks = new Map<string, readonly string[]>();
  for (const side of ['p1', 'p2'] as const) {
    slotsOf(side, logged[side]).forEach(({ slot, fragment }, index) => {
      if (fragment.kind !== 'move') return;
      const body = battle.sides[side === 'p1' ? 0 : 1].active[index];
      const moveId = body && !body.fainted ? body.getMoveRequestData().moves[fragment.index - 1]?.id : undefined;
      if (!moveId) return;
      clicked.set(slot, moveId);
      const offers = offeredDice(battle, slot, { kind: 'move', moveId, moveName: moveId, ...(fragment.aim === undefined ? {} : { targetLoc: fragment.aim }) });
      checks.set(slot, offers.filter(offer => offer.name.kind === 'status-check' && offer.name.effectId).map(offer => offer.name.effectId!));
    });
  }
  return { clicked, checks, secondariesOf: secondariesIn(battle.dex) };
}

/** The forced list of a turn the user has just chosen: the user's dice, joined by the log's on the branch's first turn. */
function firstTurnDice(input: BranchTurnInput, mine: readonly ForcedDie[]): ForcedDie[] {
  const logged = battleLoggedTurn(input.battle);
  if (!FIRST_TURN_JOINS_LOG || !logged) return [...mine];
  const { changed, switched } = turnChanges(logged.choices, input.commands);
  return mergeLoggedDice({
    logged: loggedDice(logged.lines, loggedOptions(input.battle, logged.choices)), forced: mine, changed, switched,
  });
}

/**
 * What the log shows for the position a branch opened on (the dice of every action as logged), for the panel's chips on the
 * first turn ("Crit, log"). Empty when the battle no longer stands in that turn or has no logged turn. The panel keys a chip by
 * `dieKey`; the user's own die replaces the log's of the same key.
 */
export function loggedTurnDice(battle: Battle): ForcedDie[] {
  const logged = battleLoggedTurn(battle);
  return logged ? loggedDice(logged.lines, loggedOptions(battle, logged.choices)) : [];
}

/** The logged turn of the live PRNG when the battle still stands in that turn. */
function battleLoggedTurn(battle: Battle) {
  const prng = battle.prng;
  const logged = prng instanceof LoggedRollPRNG ? prng.loggedTurn : null;
  return logged && logged.turn === battle.turn ? logged : null;
}

const RANK: Record<DieTook, number> = { applied: 3, blocked: 2, 'no-chance': 1, 'no-draw': 0 };

/** The best report of each die over the parts of a turn: a die the first part never reached reads `no-draw` there. */
function bestReports(before: readonly DieReport[], now: readonly DieReport[]): DieReport[] {
  const best = new Map<string, DieReport>();
  for (const report of [...before, ...now]) {
    const key = dieKey(report.die.name);
    const held = best.get(key);
    if (!held || RANK[report.took] > RANK[held.took]) best.set(key, report);
  }
  return [...best.values()];
}

const pausedMidTurn = (battle: Battle): boolean => !battle.ended && (battle as unknown as { midTurn?: boolean }).midTurn === true;

export function playBranchTurn(input: BranchTurnInput): BranchTurnResult {
  const { battle, pending } = input;
  const carried = pending && pending.turn === battle.turn && !battle.ended ? pending : undefined;
  const fresh = userDice(input.p1Choices, input.p2Choices);
  const taken = new Set(fresh.map(die => dieKey(die.name)));
  const later = <T extends ForcedDie>(dice: readonly T[]): T[] => dice.filter(die => !taken.has(dieKey(die.name)));
  const mine = carried ? [...fresh, ...later(carried.mine)] : fresh;
  const forced = carried ? [...fresh, ...later(carried.forced)] : fresh.length > 0 ? firstTurnDice(input, fresh) : [];
  if (forced.length === 0) {
    input.play(battle);
    return { report: undefined, pending: null };
  }
  const played = playForcedTurn({ live: battle, forced, play: input.play });
  const own = new Set(mine.map(die => dieKey(die.name)));
  const reports = bestReports(carried?.reports ?? [], played.forced.filter(entry => own.has(dieKey(entry.die.name))));
  return {
    report: { forced: reports, naturalEndSeed: played.naturalEndSeed },
    pending: pausedMidTurn(battle) ? { turn: battle.turn, forced, mine, reports } : null,
  };
}
