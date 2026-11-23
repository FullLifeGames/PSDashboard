import type { Battle } from '@pkmn/sim';
import type { BranchSlotChoice } from '../branch-choices.ts';
import { LoggedRollPRNG } from '../branch/logged-rolls.ts';
import { getMainChoice, parseTurnBlocks } from '../branch/protocol-choices.ts';
import { slotLetter } from '../branch/team-order.ts';
import type { SimBattle } from '../branch/types.ts';
import { hitsIn } from './chain.ts';
import { loggedDice, mergeLoggedDice, type LoggedOptions } from './logged-results.ts';
import { offeredDice } from './offer.ts';
import { playForcedTurn } from './play.ts';
import { secondaryEffectId } from './recognize.ts';
import { secondariesIn } from './secondaries.ts';
import { dieKey, plainKey, type DiceReport, type DieReport, type DieTook, type ForcedDie } from './types.ts';

/** The branch's turn through the dice module; `executeBranchChoices` loads this file by dynamic import only when the slot choices carry a forced die (ADR 0001). */

/**
 * What a turn that paused for a switch (U-turn, Volt Switch, Flip Turn, Parting Shot, Eject Button, Eject Pack, Emergency Exit, Wimp Out) hands to
 * the next `choose`: the forced dice span the whole turn, and each call plays its part through `playForcedTurn`, so the natural copy plays the same
 * switch choice and each part ends the stream on the natural turn's seed at that place.
 */
export interface PendingTurn {
  turn: number;
  /** Every die the turn forces, the user's and the log's. */
  forced: readonly ForcedDie[];
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

/**
 * The effect id of a move's own chance to move its user (`move.self.chance` below 100: Diamond Storm in Gens 7 and later keeps the chance there and
 * no entry in its secondaries), from the game's own Dex. Only a gain of stats: no move keeps a chance for a condition of its user there.
 */
function selfChanceIn(dex: Battle['dex']): (moveId: string) => string | undefined {
  return moveId => {
    const self = (dex.moves.get(moveId) as unknown as { self?: { chance?: number; boosts?: Record<string, number> } }).self;
    return self?.chance !== undefined && self.chance < 100 && self.boosts ? secondaryEffectId({ self: { boosts: self.boosts } }) : undefined;
  };
}

/**
 * The stall conditions of the stalling moves a body knows but did not click, keyed `slot:move`. One of them can still be the move the log shows:
 * Encore makes the body repeat its last move after the click. Read from the same offers as the click's own.
 */
function redirectedStalls(battle: Battle, slot: string, body: Battle['sides'][number]['active'][number] | undefined, clickedId: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const known of body?.moveSlots ?? []) {
    if (known.id === clickedId || !(battle.dex.moves.get(known.id) as unknown as { stallingMove?: boolean }).stallingMove) continue;
    const effectId = offeredDice(battle, slot, { kind: 'move', moveId: known.id, moveName: known.id }).find(offer => offer.name.kind === 'stalling' && offer.name.effectId)?.name.effectId;
    if (effectId) found.set(`${slot}:${known.id}`, effectId);
  }
  return found;
}

/** What the log cannot name (`LoggedOptions`): the move each body clicked, the checks each body stood under, the secondaries of every move. */
export function loggedOptions(battle: Battle, logged: { p1: string; p2: string }): LoggedOptions {
  const clicked = new Map<string, string>();
  const checks = new Map<string, readonly string[]>();
  const stalling = new Map<string, string>();
  const accuracyTargets = new Map<string, readonly string[]>();
  for (const side of ['p1', 'p2'] as const) {
    slotsOf(side, logged[side]).forEach(({ slot, fragment }, index) => {
      if (fragment.kind !== 'move') return;
      const body = battle.sides[side === 'p1' ? 0 : 1].active[index];
      const moveId = body && !body.fainted ? body.getMoveRequestData().moves[fragment.index - 1]?.id : undefined;
      if (!moveId) return;
      clicked.set(slot, moveId);
      const offers = offeredDice(battle, slot, { kind: 'move', moveId, moveName: moveId, ...(fragment.aim === undefined ? {} : { targetLoc: fragment.aim }) });
      checks.set(slot, offers.filter(offer => offer.name.kind === 'status-check' && offer.name.effectId).map(offer => offer.name.effectId!));
      // the condition that makes a stalling move draw its chance to succeed again, as the offer names it
      const stall = offers.find(offer => offer.name.kind === 'stalling' && offer.name.effectId)?.name.effectId;
      if (stall) stalling.set(slot, stall);
      redirectedStalls(battle, slot, body, moveId).forEach((effectId, key) => stalling.set(key, effectId));
      // the foes the click draws an accuracy for, for a move the log writes without an aim; one entry per target (the offer also names the die of
      // each later hit), so the reconstruction's forced list does not move
      accuracyTargets.set(slot, offers.filter(offer => offer.name.kind === 'accuracy' && offer.name.hit === undefined && offer.name.targetSlot).map(offer => offer.name.targetSlot!));
    });
  }
  return { clicked, checks, stalling, accuracyTargets, secondariesOf: secondariesIn(battle.dex), selfOf: selfChanceIn(battle.dex), hitsOf: hitsIn(battle.dex), randomTargets: battle.gameType !== 'singles' };
}

/**
 * The forced list of a turn the user has just chosen. On the branch's first turn (the live PRNG is a `LoggedRollPRNG` that knows the logged turn)
 * the dice the log shows for the actions the user leaves as logged join the user's dice, with or without a die of the user's; a branch whose
 * first turn has no logged turn has nothing to join. The turn after the first plays as without the module when the user forces nothing.
 */
function firstTurnDice(input: BranchTurnInput, mine: readonly ForcedDie[]): ForcedDie[] {
  const logged = battleLoggedTurn(input.battle);
  if (!logged) return [...mine];
  const { changed, switched } = turnChanges(logged.choices, input.commands);
  return mergeLoggedDice({
    logged: loggedDice(logged.lines, loggedOptions(input.battle, logged.choices)), forced: mine, changed, switched,
  });
}

/** The dice the log shows for the position a branch opened on, for the panel's chips; empty when the battle left that turn or has no logged turn. */
export function loggedTurnDice(battle: Battle): ForcedDie[] {
  const logged = battleLoggedTurn(battle);
  return logged ? loggedDice(logged.lines, loggedOptions(battle, logged.choices)) : [];
}

/** The log's dice for the stored position of a replay turn (no `LoggedRollPRNG`, nothing played); none unless it stands at a move request the replay has. */
export function loggedDiceAt(battle: Battle, replayLog: string): ForcedDie[] {
  if (battle.ended || battle.requestState !== 'move') return [];
  const block = parseTurnBlocks(replayLog).turns.find(entry => entry.turn === battle.turn);
  if (!block) return [];
  try {
    const sim = battle as SimBattle;
    const choices = { p1: getMainChoice(block.preUpkeep, 'p1', sim), p2: getMainChoice(block.preUpkeep, 'p2', sim) };
    return loggedDice([...block.preUpkeep, ...block.postUpkeep], loggedOptions(battle, choices));
  } catch {
    return [];
  }
}

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
  // a die of the user's without a hit covers every hit of its move: the logged hit dice of it leave
  const later = <T extends ForcedDie>(dice: readonly T[]): T[] => dice.filter(die => !taken.has(dieKey(die.name)) && !(die.name.hit !== undefined && taken.has(plainKey(die.name))));
  const mine = carried ? [...fresh, ...later(carried.mine)] : fresh;
  const forced = carried ? [...fresh, ...later(carried.forced)] : fresh.length > 0 || battle.requestState === 'move' ? firstTurnDice(input, fresh) : [];
  if (forced.length === 0) {
    input.play(battle);
    return { report: undefined, pending: null };
  }
  const played = playForcedTurn({ live: battle, forced, play: input.play });
  const own = new Set(mine.map(die => dieKey(die.name)));
  const reports = bestReports(carried?.reports ?? [], played.forced.filter(entry => own.has(dieKey(entry.die.name))));
  return {
    // a first turn that joins the log with no die of the user's lists no die
    report: mine.length > 0 ? { forced: reports, naturalEndSeed: played.naturalEndSeed } : undefined,
    pending: pausedMidTurn(battle) ? { turn: battle.turn, forced, mine, reports } : null,
  };
}
