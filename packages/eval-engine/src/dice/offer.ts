import type { Battle, Pokemon } from '@pkmn/sim';
import type { BranchSlotChoice } from '../branch-choices.ts';
import { strengthMix } from '../calc/fickle.ts';
import { copyOf } from '../sim-ask/copy.ts';
import { naturalTurn } from './play.ts';
import { chanceOfEntry, genShape, rollsAtTurnStart, secondaryEffectId } from './recognize.ts';
import { readsStartRoll } from './start-roll.ts';
import { probeCheck } from './status-probe.ts';
import { dieKey, tieName, type DieName, type DieResult, type SecondaryEntry } from './types.ts';

/**
 * Round 82 (forced dice), step A3a: which dice the panel offers for a slot's move choice. What the move's Dex entry and the
 * battle's state name: the dice the simulator will draw for that move, with the results a user can force. Every offered die
 * is held to a draw of the simulator in its scene by `dice-offer.spec.ts`.
 *
 * The move the simulator runs is not the Dex entry: abilities and items rewrite it (an item adds a flinch, an ability fixes
 * the hit count or strips the secondaries) and the target's own rules remove entries (`ModifySecondaries`). So the offer
 * reads the move the way the simulator does, on a copy of the battle: the move's own `ModifyMove` handler, then the event
 * over the user's rules, then `ModifySecondaries` for each target. The live battle is read and never written.
 */

export interface DieOffer {
  name: DieName;
  /** The results the user can force; a damage roll lists every step, a hit count every count of the move's range. */
  results: DieResult[];
  /** The chance of a die that is one chance (a secondary entry, a chance of power). */
  chance?: number;
}

/** The targets a move reaches that a foe can be among (`move.target` of the Dex): the others (the user, a side, the field, an ally) draw no accuracy or crit against a foe. */
const FOE_REACHING = new Set(['normal', 'any', 'adjacentFoe', 'allAdjacentFoes', 'allAdjacent', 'randomNormal', 'scripted']);
/** Moves that hit the bodies next to the user, the ally among them. */
const HITS_ALLY = 'allAdjacent';
/** Moves that hit every foe. */
const SPREAD = new Set(['allAdjacentFoes', 'allAdjacent', 'randomNormal', 'scripted']);

const YES_NO: DieResult[] = [{ happens: true }, { happens: false }];

interface ActiveMove {
  id: string; name: string; target: string; category: string; basePower: number; accuracy: number | true; alwaysHit?: boolean; willCrit?: boolean;
  damage?: unknown; ohko?: unknown; damageCallback?: unknown; basePowerCallback?: unknown; multihit?: number | number[]; self?: { boosts?: object };
  secondaries?: SecondaryEntry[]; flags: Record<string, unknown>; stallingMove?: boolean; noDamageVariance?: boolean; smartTarget?: boolean;
  onModifyMove?: unknown;
}

type Base = Omit<DieName, 'kind' | 'targetSlot'>;
type MoveChoice = Extract<BranchSlotChoice, { kind: 'move' }>;

const slotOf = (body: Pokemon | undefined | null): string | undefined => (body && !body.fainted ? body.getSlot() : undefined);

/** The bodies a move aimed by this choice can reach: the chosen one, or every foe (and the ally for a move that hits all). */
function targetsOf(user: Pokemon, move: ActiveMove, choice: MoveChoice): Pokemon[] {
  const foes = user.foes();
  if (SPREAD.has(move.target)) return move.target === HITS_ALLY ? [...foes, ...user.allies()] : foes;
  // a move that throws one hit at each foe (Dex flag `smartTarget`) draws for both, aimed or not
  if (move.smartTarget) return foes;
  const aimed = choice.targetLoc === undefined ? foes[0] : user.getAtLoc(choice.targetLoc);
  return aimed ? [aimed] : [];
}

/** The move as the simulator rewrites it for this user and target, read on a copy of the battle. */
function activeMoveOn(copy: Battle, user: Pokemon, target: Pokemon | undefined, moveId: string): ActiveMove {
  const active = copy.dex.getActiveMove(moveId) as unknown as ActiveMove;
  const events = copy as unknown as { singleEvent(...args: unknown[]): unknown; runEvent(...args: unknown[]): unknown };
  events.singleEvent('ModifyMove', active, null, user, target, active, active);
  events.runEvent('ModifyMove', user, target, active, active);
  return active;
}

/** Whether the move is on its second turn: a charge move draws nothing on the turn it charges. */
const charged = (user: Pokemon, move: ActiveMove): boolean =>
  !move.flags.charge || Object.values(user.volatiles).some(volatile => (volatile as { move?: string }).move === move.id);

/** The condition on the user that makes a stalling move draw (the one with a `StallMove` handler), or undefined. */
function stallCondition(user: Pokemon, battle: Battle): string | undefined {
  return Object.keys(user.volatiles).find(id => typeof (battle.dex.conditions.get(id) as unknown as { onStallMove?: unknown }).onStallMove === 'function');
}

const fixedDamage = (move: ActiveMove): boolean => !!move.damage || !!move.ohko || !!move.damageCallback;

function accuracyOffers(battle: Battle, move: ActiveMove, base: Base, targets: string[]): DieOffer[] {
  // Gen 2 draws no accuracy for a move of 100 percent (accuracy 255), whatever the answer
  const draws = typeof move.accuracy === 'number' && !move.alwaysHit && !(battle.gen === 2 && move.accuracy >= 100);
  return draws ? targets.map(targetSlot => ({ name: { ...base, targetSlot, kind: 'accuracy' }, results: YES_NO })) : [];
}

function damageOffers(battle: Battle, move: ActiveMove, base: Base, targets: string[]): DieOffer[] {
  // a move that sets its own power in `onModifyMove` has base power 0 until it runs
  if (move.category === 'Status' || fixedDamage(move) || (!move.basePower && !move.basePowerCallback && typeof move.onModifyMove !== 'function')) return [];
  const steps = Array.from({ length: genShape(battle.gen).roll.steps }, (_, step): DieResult => ({ step }));
  return targets.flatMap((targetSlot): DieOffer[] => [
    // `willCrit` is set to true (always) or to false (never) by the Dex; only a move that leaves it open draws the crit
    ...(move.willCrit === undefined ? [{ name: { ...base, targetSlot, kind: 'crit' as const }, results: YES_NO }] : []),
    ...(move.noDamageVariance ? [] : [{ name: { ...base, targetSlot, kind: 'damage-roll' as const }, results: steps }]),
  ]);
}

/** The entries `ModifySecondaries` leaves for each target, one die each (the target's own rules may remove them). */
function secondaryOffers(copy: Battle, user: Pokemon, move: ActiveMove, base: Base, targets: Pokemon[]): DieOffer[] {
  if (!move.secondaries?.length) return [];
  const runner = copy as unknown as { runEvent(...args: unknown[]): SecondaryEntry[] | undefined };
  return targets.flatMap(target => {
    const entries = copy.gen >= 3 ? runner.runEvent('ModifySecondaries', target, user, move, move.secondaries!.slice()) ?? [] : move.secondaries!;
    // Gens 1 and 2 apply an entry with no chance without a draw
    return entries.filter(entry => copy.gen >= 3 || entry.chance !== undefined).map((entry): DieOffer => ({
      name: { ...base, targetSlot: target.getSlot(), kind: 'secondary', effectId: secondaryEffectId(entry) },
      results: YES_NO,
      chance: chanceOfEntry(entry.chance),
    }));
  });
}

function moveOffers(copy: Battle, user: Pokemon, move: ActiveMove, targets: Pokemon[]): DieOffer[] {
  const base = { slot: user.getSlot(), moveId: move.id };
  const slots = targets.map(slotOf).filter((slot): slot is string => slot !== undefined);
  const offers = [...accuracyOffers(copy, move, base, slots), ...damageOffers(copy, move, base, slots), ...secondaryOffers(copy, user, move, base, targets)];
  if (Array.isArray(move.multihit)) {
    const [low, high] = move.multihit;
    offers.push({ name: { ...base, kind: 'hit-count' }, results: Array.from({ length: high - low + 1 }, (_, offset): DieResult => ({ hits: low + offset })) });
  }
  const mix = strengthMix(copy.dex, move.name);
  if (mix) offers.push({ name: { ...base, kind: 'power', effectId: move.id }, results: YES_NO, chance: mix.chance });
  return offers;
}

/**
 * The status checks the body carries: a condition (its status or a volatile) whose own `BeforeMove` handler draws a chance for
 * this move. The chance offered is the chance of the answer "the body goes on".
 */
function checkOffers(battle: Battle, slot: string, moveId: string): DieOffer[] {
  const body = battle.sides[slot[1] === '1' ? 0 : 1].active[slot[2] === 'a' ? 0 : 1];
  if (!body || body.fainted) return [];
  const ids = [body.status, ...Object.keys(body.volatiles)].filter(id => id !== '');
  return ids.flatMap((id): DieOffer[] => {
    const probe = probeCheck(battle, slot, id, moveId);
    if (!probe) return [];
    return [{ name: { slot, moveId, kind: 'status-check', effectId: id }, results: YES_NO, chance: probe.actsOnTrue ? probe.chance : 1 - probe.chance }];
  });
}

/**
 * The dice the panel offers for `choice` of the body in `slot`. A switch offers none. A move the simulator cannot run this turn
 * (charging, landing two turns later) offers none; the offer says what the move will draw if it runs.
 */
export function offeredDice(battle: Battle, slot: string, choice: BranchSlotChoice): DieOffer[] {
  if (choice.kind !== 'move') return [];
  const copy = copyOf(battle);
  copy.prng ??= battle.prng.clone();
  const user = copy.sides[slot[1] === '1' ? 0 : 1].active[slot[2] === 'a' ? 0 : 1];
  if (!user || user.fainted) return [];
  const aimed = choice.targetLoc === undefined ? user.foes()[0] : user.getAtLoc(choice.targetLoc);
  const move = activeMoveOn(copy, user, aimed, choice.moveId);
  // the checks before a move draw whatever the move does next, also on the turn a charge move charges
  const checks = checkOffers(battle, slot, move.id);
  if (move.flags.futuremove || !charged(user, move)) return checks;
  const offers = FOE_REACHING.has(move.target) ? moveOffers(copy, user, move, targetsOf(user, move, choice)) : [];
  offers.push(...checks);
  // a self effect belongs to the move whatever it aims at (a status move that raises the user's stats draws it too)
  if (move.self?.boosts) offers.push({ name: { slot, moveId: move.id, kind: 'self-effect' }, results: YES_NO });
  const stall = move.stallingMove ? stallCondition(user, copy) : undefined;
  if (stall) offers.push({ name: { slot, moveId: move.id, kind: 'stalling', effectId: stall }, results: YES_NO });
  return offers;
}

/**
 * The dice of the turn's order the panel offers (round 82, step A3b). They belong to the turn and not to one slot's choice, so
 * the offer plays the turn on a copy, the way `playForcedTurn` plays its natural turn, and reads what the simulator drew:
 *
 * - a speed tie for every pair of bodies whose move actions the simulator shuffled together (the name is the sorted pair, the
 *   results are the two orders);
 * - a first mover for every holder whose die the simulator drew (Quick Claw for any move, since the handler tests the relayed
 *   priority of 0 and not the move's; Quick Draw only for a damaging move), with the chance of the draw;
 * - Gens 2 and 3 draw that die at the start of the turn and keep it on the battle: it is offered for every body that acted
 *   this turn and whose action speed moves with the roll (no chance: no draw of the turn carries one).
 *
 * The live battle is read and never written.
 */
export function offeredOrderDice(battle: Battle, play: (battle: Battle) => void): DieOffer[] {
  const natural = naturalTurn(battle, play);
  const offers: DieOffer[] = [];
  const seen = new Set<string>();
  for (const slots of natural.ties) {
    for (const [index, a] of slots.entries()) {
      for (const b of slots.slice(index + 1)) {
        const name = tieName(a, b);
        if (seen.has(dieKey(name))) continue;
        seen.add(dieKey(name));
        offers.push({ name, results: [{ first: name.slot }, { first: name.targetSlot! }] });
      }
    }
  }
  for (const [key, name] of natural.names) {
    const chance = natural.chances.get(key);
    if (name.kind === 'move-first') offers.push({ name, results: YES_NO, ...(chance === undefined ? {} : { chance }) });
  }
  if (rollsAtTurnStart(battle.gen)) {
    for (const slot of natural.acted.filter(acted => readsStartRoll(battle, acted))) {
      const body = battle.sides[slot[1] === '1' ? 0 : 1].active[slot[2] === 'a' ? 0 : 1];
      offers.push({ name: { slot, moveId: '', kind: 'move-first', effectId: body.item }, results: YES_NO });
    }
  }
  return offers;
}
