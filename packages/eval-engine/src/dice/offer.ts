import type { Battle, Pokemon } from '@pkmn/sim';
import type { BranchSlotChoice } from '../branch-choices.ts';
import { strengthMix } from '../calc/fickle.ts';
import { copyOf } from '../sim-ask/copy.ts';
import { fixedCountOffers } from './fixed-count.ts';
import { reachableOptions } from './learn.ts';
import { naturalTurn } from './play.ts';
import { RecordingPRNG } from './prng.ts';
import { chanceOfEntry, genShape, rollsAtTurnStart, secondaryEffectId } from './recognize.ts';
import { readsStartRoll } from './start-roll.ts';
import { probeCheck } from './status-probe.ts';
import { dieKey, tieName, type DieName, type DieResult, type SecondaryEntry } from './types.ts';
import { watchBattle } from './watch.ts';

/** The dice the panel offers for a move choice, read on copies; `dice-offer.spec.ts` holds each to a simulator draw. */

export interface DieOffer {
  name: DieName;
  results: DieResult[];
  chance?: number;
  /** Ability or item that fixes a variable multi-hit move's count (Skill Link, Loaded Dice): a `hit-count` row. */
  fixedBy?: string;
}

// Targets a foe can be among; the others (the user, a side, the field, an ally) draw no accuracy or crit against a foe.
const FOE_REACHING = new Set(['normal', 'any', 'adjacentFoe', 'allAdjacentFoes', 'allAdjacent', 'randomNormal', 'scripted']);
const HITS_ALLY = 'allAdjacent';
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

const bodyAt = (battle: Battle, slot: string): Pokemon | undefined => battle.sides[slot[1] === '1' ? 0 : 1].active[slot[2] === 'a' ? 0 : 1];

const slotOf = (body: Pokemon | undefined | null): string | undefined => (body && !body.fainted ? body.getSlot() : undefined);

function targetsOf(user: Pokemon, move: ActiveMove, choice: MoveChoice): Pokemon[] {
  const foes = user.foes();
  if (SPREAD.has(move.target)) return move.target === HITS_ALLY ? [...foes, ...user.allies()] : foes;
  if (move.smartTarget) return foes;
  const aimed = choice.targetLoc === undefined ? foes[0] : user.getAtLoc(choice.targetLoc);
  return aimed ? [aimed] : [];
}

// Abilities and items rewrite the move (a flinch, a fixed hit count): read via ModifyMove on a copy.
function activeMoveOn(copy: Battle, user: Pokemon, target: Pokemon | undefined, moveId: string): ActiveMove {
  const active = copy.dex.getActiveMove(moveId) as unknown as ActiveMove;
  const events = copy as unknown as {
    singleEvent(...args: unknown[]): unknown; runEvent(...args: unknown[]): unknown;
    setActiveMove(move: unknown, pokemon: Pokemon, target?: Pokemon): void; clearActiveMove(failed?: boolean): void;
  };
  // runMove sets the move in flight before ModifyMove, and handlers read it (choicelock throws without it).
  events.setActiveMove(active, user, target);
  try {
    events.singleEvent('ModifyMove', active, null, user, target, active, active);
    events.runEvent('ModifyMove', user, target, active, active);
  } finally {
    events.clearActiveMove(true);
  }
  return active;
}

const holdsCharge = (user: Pokemon, move: ActiveMove): boolean =>
  Object.values(user.volatiles).some(volatile => (volatile as { move?: string }).move === move.id);

// The move's weather, Power Herb and Mega Sol skip the charge; Utility Umbrella, Cloud Nine, Air Lock, Klutz, Embargo,
// Magic Room block the skip. It runs on a second copy: Electro Shot boosts on its charge turn, Power Herb is used up.
function chargesThisTurn(battle: Battle, slot: string, choice: MoveChoice, move: ActiveMove): boolean {
  if (!move.flags.charge) return false;
  const copy = copyOf(battle);
  copy.prng ??= battle.prng.clone();
  const user = bodyAt(copy, slot);
  if (!user || user.fainted) return false;
  if (holdsCharge(user, move)) return false;
  const aimed = choice.targetLoc === undefined ? user.foes()[0] : user.getAtLoc(choice.targetLoc);
  copy.actions.useMove(move.id, user, { target: aimed });
  return holdsCharge(user, move);
}

function stallCondition(user: Pokemon, battle: Battle): string | undefined {
  return Object.keys(user.volatiles).find(id => typeof (battle.dex.conditions.get(id) as unknown as { onStallMove?: unknown }).onStallMove === 'function');
}

const fixedDamage = (move: ActiveMove): boolean => !!move.damage || !!move.ohko || !!move.damageCallback;

// Read after ModifyMove: Skill Link and Loaded Dice have cleared multiaccuracy by then and the simulator draws one die.
function laterHitsOf(move: ActiveMove): number[] {
  const { multiaccuracy, multihit } = move as ActiveMove & { multiaccuracy?: boolean };
  return multiaccuracy && typeof multihit === 'number' ? Array.from({ length: Math.max(0, Math.floor(multihit) - 1) }, (_, index) => index + 2) : [];
}

function accuracyOffers(battle: Battle, move: ActiveMove, base: Base, targets: string[]): DieOffer[] {
  // Gen 2 draws no accuracy for a move of 100 percent (accuracy 255), whatever the answer
  const draws = typeof move.accuracy === 'number' && !move.alwaysHit && !(battle.gen === 2 && move.accuracy >= 100);
  if (!draws) return [];
  const later = laterHitsOf(move);
  return targets.flatMap((targetSlot): DieOffer[] => [
    { name: { ...base, targetSlot, kind: 'accuracy' }, results: YES_NO },
    ...later.map((hit): DieOffer => ({ name: { ...base, targetSlot, kind: 'accuracy', hit }, results: YES_NO })),
  ]);
}

function damageOffers(battle: Battle, move: ActiveMove, base: Base, targets: string[]): DieOffer[] {
  // a move that sets its own power in `onModifyMove` has base power 0 until it runs
  if (move.category === 'Status' || fixedDamage(move) || (!move.basePower && !move.basePowerCallback && typeof move.onModifyMove !== 'function')) return [];
  const steps = Array.from({ length: genShape(battle.gen).roll.steps }, (_, step): DieResult => ({ step }));
  return targets.flatMap((targetSlot): DieOffer[] => [
    // A Dex willCrit of true or false sets the crit without a draw; only an open one draws (battle-actions.js).
    ...(move.willCrit === undefined ? [{ name: { ...base, targetSlot, kind: 'crit' as const }, results: YES_NO }] : []),
    ...(move.noDamageVariance ? [] : [{ name: { ...base, targetSlot, kind: 'damage-roll' as const }, results: steps }]),
  ]);
}

// The target's own rules may remove entries (Gens 1 and 2 have no hook).
function entriesOn(copy: Battle, user: Pokemon, move: ActiveMove, target: Pokemon): SecondaryEntry[] {
  if (!move.secondaries?.length) return [];
  const runner = copy as unknown as { runEvent(...args: unknown[]): SecondaryEntry[] | undefined };
  const entries = copy.gen >= 3 ? runner.runEvent('ModifySecondaries', target, user, move, move.secondaries.slice()) ?? [] : move.secondaries;
  // Gens 1 and 2 apply an entry with no chance without a draw
  return entries.filter(entry => copy.gen >= 3 || entry.chance !== undefined);
}

function secondaryOffers(copy: Battle, user: Pokemon, move: ActiveMove, base: Base, targets: Pokemon[]): DieOffer[] {
  return targets.flatMap(target => entriesOn(copy, user, move, target).map((entry): DieOffer => ({
    name: { ...base, targetSlot: target.getSlot(), kind: 'secondary', effectId: secondaryEffectId(entry) },
    results: YES_NO,
    chance: chanceOfEntry(entry.chance),
  })));
}

export function secondaryDiceOf(battle: Battle, userSlot: string, moveId: string, targetSlot: string): { effectId: string; chance: number }[] {
  const copy = copyOf(battle);
  copy.prng ??= battle.prng.clone();
  const user = bodyAt(copy, userSlot);
  const target = bodyAt(copy, targetSlot);
  if (!user || !target || user.fainted || target.fainted) return [];
  const move = activeMoveOn(copy, user, target, moveId);
  return entriesOn(copy, user, move, target).map(entry => ({ effectId: secondaryEffectId(entry), chance: chanceOfEntry(entry.chance) }));
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

function hitEvents(copy: Battle, userSlot: string, targetSlot: string, moveId: string): void {
  const user = bodyAt(copy, userSlot);
  const target = bodyAt(copy, targetSlot);
  if (!user || !target) return;
  const move = copy.dex.getActiveMove(moveId);
  const events = copy as unknown as {
    setActiveMove(move: unknown, pokemon: Pokemon, target?: Pokemon): void; clearActiveMove(failed?: boolean): void; runEvent(...args: unknown[]): unknown;
  };
  events.setActiveMove(move, user, target);
  try {
    events.runEvent('DamagingHit', target, user, move, 1);
    events.runEvent('Damage', target, user, move, 1);
  } finally {
    // the move in flight ends with the hit, as in the simulator's `runMove`
    events.clearActiveMove(true);
  }
}

// No ability or item is named: a holder whose handler draws nothing offers nothing.
function procOffers(battle: Battle, user: Pokemon, move: ActiveMove, targets: Pokemon[]): DieOffer[] {
  if (move.category === 'Status') return [];
  const offers: DieOffer[] = [];
  for (const target of targets) {
    const play = (copy: Battle): void => hitEvents(copy, user.getSlot(), target.getSlot(), move.id);
    const copy = copyOf(battle);
    copy.prng ??= battle.prng.clone();
    const watch = watchBattle(copy);
    const recording = new RecordingPRNG(copy.prng, watch);
    recording.procsYes = true;
    copy.prng = recording;
    try {
      play(copy);
    } finally {
      watch.uninstall();
    }
    for (const [key, name] of recording.names) {
      if (name.kind !== 'ability-proc' && name.kind !== 'item-proc') continue;
      const shape = recording.shapes.get(key);
      const chance = recording.chances.get(key);
      if (shape?.call === 'sample') {
        offers.push({ name, results: [...new Set(shape.items ?? [])].map((item): DieResult => ({ option: String(item) })) });
      } else if (shape?.call === 'random' && shape.to === undefined) {
        const options = reachableOptions({ live: battle, forced: [], record: new Map(), play, fork: prng => prng.clone(), name });
        offers.push({ name, results: [{ happens: false }, ...options.map((option): DieResult => ({ option }))] });
      } else {
        offers.push({ name, results: YES_NO, ...(chance === undefined ? {} : { chance }) });
      }
    }
  }
  return offers;
}

// A condition whose BeforeMove handler draws a chance for this move; the chance offered is that of "the body goes on".
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

/** None for a switch; a charging or future move offers only its status checks. */
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
  if (move.flags.futuremove || chargesThisTurn(battle, slot, choice, move)) return checks;
  const targets = FOE_REACHING.has(move.target) ? targetsOf(user, move, choice) : [];
  const offers = targets.length > 0 ? moveOffers(copy, user, move, targets) : [];
  if (targets.length > 0) offers.push(...fixedCountOffers(battle, copy, user, move, { slot, moveId: move.id }, targets));
  offers.push(...procOffers(copy, user, move, targets));
  offers.push(...checks);
  return [...offers, ...userOffers(copy, user, move)];
}

function userOffers(copy: Battle, user: Pokemon, move: ActiveMove): DieOffer[] {
  const slot = user.getSlot();
  const offers: DieOffer[] = [];
  // a self effect belongs to the move whatever it aims at (a status move that raises the user's stats draws it too)
  if (move.self?.boosts) offers.push({ name: { slot, moveId: move.id, kind: 'self-effect' }, results: YES_NO });
  const stall = move.stallingMove ? stallCondition(user, copy) : undefined;
  if (stall) offers.push({ name: { slot, moveId: move.id, kind: 'stalling', effectId: stall }, results: YES_NO });
  return offers;
}

/** Read from the natural turn on a copy; the live battle is never written. */
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
  // Quick Claw's handler tests a relayed priority of 0 and not the move's; Quick Draw only for a damaging move.
  for (const [key, name] of natural.names) {
    const chance = natural.chances.get(key);
    if (name.kind === 'move-first') offers.push({ name, results: YES_NO, ...(chance === undefined ? {} : { chance }) });
  }
  // Gens 2 and 3 draw that die at the start of the turn and keep it: offered for every body that acted this turn.
  if (rollsAtTurnStart(battle.gen)) {
    for (const slot of natural.acted.filter(acted => readsStartRoll(battle, acted))) {
      const body = battle.sides[slot[1] === '1' ? 0 : 1].active[slot[2] === 'a' ? 0 : 1];
      offers.push({ name: { slot, moveId: '', kind: 'move-first', effectId: body.item }, results: YES_NO });
    }
  }
  return offers;
}

/** The end-of-turn dice the panel offers, read from the natural turn on a copy; the live battle is never written. */
export function offeredEndDice(battle: Battle, play: (battle: Battle) => void): DieOffer[] {
  const natural = naturalTurn(battle, play);
  const offers: DieOffer[] = [];
  const steps = Array.from({ length: genShape(battle.gen).roll.steps }, (_, step): DieResult => ({ step }));
  // The Residual event of every body (Shed Skin, Harvest, Healer, the Gen 2 thaw) and a future move landing this turn.
  for (const [key, name] of natural.names) {
    const chance = natural.chances.get(key);
    const withChance = chance === undefined ? {} : { chance };
    const future = !!name.moveId && !!battle.dex.moves.get(name.moveId).flags.futuremove;
    if (name.kind === 'end-of-turn') offers.push({ name, results: YES_NO, ...withChance });
    else if (future && (name.kind === 'accuracy' || name.kind === 'crit')) offers.push({ name, results: YES_NO, ...withChance });
    else if (future && name.kind === 'damage-roll') offers.push({ name, results: steps });
  }
  return offers;
}
