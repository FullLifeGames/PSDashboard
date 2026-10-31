import type { Battle, Pokemon } from '@pkmn/sim';
import type { BranchSlotChoice } from '../branch-choices.ts';
import { strengthMix } from '../calc/fickle.ts';
import { copyOf } from '../sim-ask/copy.ts';
import { chanceOfEntry, genShape, secondaryEffectId } from './recognize.ts';
import type { DieName, DieResult, SecondaryEntry } from './types.ts';

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
  if (move.flags.futuremove || !charged(user, move)) return [];
  const offers = FOE_REACHING.has(move.target) ? moveOffers(copy, user, move, targetsOf(user, move, choice)) : [];
  // a self effect belongs to the move whatever it aims at (a status move that raises the user's stats draws it too)
  if (move.self?.boosts) offers.push({ name: { slot, moveId: move.id, kind: 'self-effect' }, results: YES_NO });
  const stall = move.stallingMove ? stallCondition(user, copy) : undefined;
  if (stall) offers.push({ name: { slot, moveId: move.id, kind: 'stalling', effectId: stall }, results: YES_NO });
  return offers;
}
