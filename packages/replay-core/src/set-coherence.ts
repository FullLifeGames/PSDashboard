import type { RulesDex } from './rules-dex.ts';
import type { PokemonSetAssumption } from './smogon/sets-lookup.ts';
import { filledSlots, slotMoveKey, slotOrderedMoves } from './team/move-slots.ts';
import { fillsOpenMove } from './team/open-moves.ts';
import type { OpenMove } from './types.ts';

/** A move candidate for the pairwise coherence vetoes; revealed and manual moves are proof and never vetoed. */

export interface MoveCandidate {
  name: string;
  /** false = revealed/manual (immune to vetoes), true = usage/set fill. */
  guessed: boolean;
  /** A move of the chosen Smogon set: rows 1 to 4 spare it; the item rows only when the item is the set's own. */
  fromSet?: boolean;
  /** A usage move past the top ten: it may refill a slot, but its boost serves nothing in row 1. */
  tail?: boolean;
}

export interface CoherenceContext {
  dex: RulesDex;
  /** The set's item id ('' when unknown): a status fill contradicts a Choice or AV item, proof or guess. */
  itemId: string;
  /** The item is the chosen set's own published item; absent or false: it came from elsewhere. */
  itemFromSet?: boolean;
}

/** A selected set; `itemReplaced` when its item gave way after a rule-out (then it is no longer the set's own). */
export type CuratedSetAssumption = PokemonSetAssumption & { itemReplaced?: true };

type DexMove = ReturnType<RulesDex['moves']['get']>;

// Self boosts, and a sure secondary's self boosts (Torch Song).
function boostsServed(move: DexMove): ('atk' | 'spa')[] {
  const raised: Record<string, number | undefined> = {
    ...(move.category === 'Status' && move.target === 'self' ? move.boosts : undefined),
    ...move.self?.boosts, ...move.selfBoost?.boosts,
    ...(move.secondary?.chance === 100 ? move.secondary.self?.boosts : undefined),
  };
  return (['atk', 'spa'] as const).filter(stat => (raised[stat] ?? 0) > 0);
}

// Setup for a Defense-scaling attack (Body Press): when that attack is vetoed or absent, the guessed enabler falls too.
function defenseBoost(move: DexMove): boolean {
  return move.category === 'Status' && move.target === 'self' && (move.boosts?.def ?? 0) > 0 && boostsServed(move).length === 0;
}

const TRICK_FAMILY = new Set(['trick', 'switcheroo']);

// A boost contradiction only matters on moves whose damage is the point.
const BOOST_VETO_MIN_BP = 70;

interface MoveFacts {
  id: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  type: string;
  priority: number;
  scaling: 'atk' | 'spa' | 'def' | null;
  /** A pivot (the Dex's `selfSwitch`: U-turn, Volt Switch) is utility whatever its category, never boost-vetoed. */
  pivot: boolean;
  /** The user's own stat the damage reads outside its category (Body Press: def); null for the rest. */
  readsOwn: string | null;
  lowersOwn: string[];
}

function ownStatsLowered(move: DexMove): string[] {
  const boosts: Record<string, number | undefined> = { ...move.self?.boosts, ...move.selfBoost?.boosts };
  return Object.keys(boosts).filter(stat => (boosts[stat] ?? 0) < 0);
}

export function factsOf(dex: RulesDex, name: string): MoveFacts | null {
  const move = dex.moves.get(name);
  if (!move.exists) return null;
  const scaling = move.category === 'Status' ? null
    : move.overrideOffensiveStat === 'def' ? 'def'
    : move.category === 'Physical' ? 'atk' : 'spa';
  const readsOwn = move.overrideOffensiveStat && move.overrideOffensivePokemon !== 'target' ? move.overrideOffensiveStat : null;
  return {
    id: move.id, category: move.category, basePower: move.basePower, type: move.type, priority: move.priority, scaling,
    pivot: !!move.selfSwitch, readsOwn, lowersOwn: ownStatsLowered(move),
  };
}

export interface CuratedEvidence {
  dex: RulesDex;
  /** Move ids seen in game or user-set: the anchors a set must cover. */
  revealedMoves: string[];
  /** Base moves of Z or Max moves no revealed move explains; each earns a set that lists a move for it two points. */
  openMoves?: OpenMove[];
  /** Item/ability ids known from proof ('' when unknown). */
  revealedItem: string;
  revealedAbility: string;
  ruledOutItems: string[];
  ruledOutAbilities: string[];
  /** Usage marginal probability of a move id (tiebreak; 0..1). */
  usageProbability: (moveId: string) => number;
  /** An item the log already points to (the Boots tell, the panel's guess): the first replacement after a rule-out. */
  guessedItem?: string;
  /** The most used item the log still allows: the replacement after that ('' without usage data). */
  usageItem?: string;
}

const UNSEEN_MOVE_PROBABILITY = 0.01;

interface CandidateIds {
  moveIds: string[];
  itemIds: string[];
  abilityId: string;
}

function candidateIds(dex: RulesDex, candidate: PokemonSetAssumption): CandidateIds {
  return {
    moveIds: candidate.moves.map(move => dex.moves.get(move.value).id as string),
    itemIds: candidate.item ? (candidate.item.options ?? [candidate.item.value]).map(name => dex.items.get(name).id as string) : [],
    abilityId: candidate.ability ? (dex.abilities.get(candidate.ability.value).id as string) : '',
  };
}

// Two points per move slot a revealed move fills (one per slot), per revealed item and per revealed ability.
function fitScore(candidate: PokemonSetAssumption, ids: CandidateIds, evidence: CuratedEvidence): number {
  let fit = 2 * filledSlots(evidence.dex, candidate.moves, evidence.revealedMoves.map(name => slotMoveKey(evidence.dex, name))).size;
  if (evidence.revealedItem && ids.itemIds.includes(evidence.revealedItem)) fit += 2;
  if (evidence.revealedAbility && ids.abilityId === evidence.revealedAbility) fit += 2;
  return fit;
}

// They rank the sets that clear the floor and never lift one over it: a set that misses the revealed moves stays out.
function openFit(candidate: PokemonSetAssumption, evidence: CuratedEvidence): number {
  const fills = (open: OpenMove) => candidate.moves.some(slot => (slot.options ?? [slot.value]).some(option => fillsOpenMove(evidence.dex, open, option)));
  return 2 * (evidence.openMoves ?? []).filter(fills).length;
}

// `itemRuleOuts` false reads the item rule-outs as if the log had shown none.
function bestCandidate(
  candidates: PokemonSetAssumption[], evidence: CuratedEvidence, itemRuleOuts: boolean,
): PokemonSetAssumption | null {
  let best: PokemonSetAssumption | null = null;
  let bestFit = -Infinity;
  let bestTiebreak = -Infinity;
  for (const candidate of candidates) {
    const ids = candidateIds(evidence.dex, candidate);
    if (itemRuleOuts && ids.itemIds.length > 0 && ids.itemIds.every(id => evidence.ruledOutItems.includes(id))) continue;
    if (ids.abilityId && evidence.ruledOutAbilities.includes(ids.abilityId)) continue;

    const fit = fitScore(candidate, ids, evidence);
    if (fit < evidence.revealedMoves.length) continue;
    const ranked = fit + openFit(candidate, evidence);

    const tiebreak = ids.moveIds.reduce((sum, id) =>
      sum + Math.log(Math.max(evidence.usageProbability(id), UNSEEN_MOVE_PROBABILITY)), 0);
    if (ranked > bestFit || (ranked === bestFit && tiebreak > bestTiebreak)) {
      best = candidate;
      bestFit = ranked;
      bestTiebreak = tiebreak;
    }
  }
  return best;
}

/** The coherent-set pick: the best-fitting curated set, or null below the floor (fit under the revealed-move count). */
export function selectCuratedSet(
  candidates: PokemonSetAssumption[],
  evidence: CuratedEvidence,
): CuratedSetAssumption | null {
  const best = bestCandidate(candidates, evidence, true);
  const unruled = bestCandidate(candidates, evidence, false);
  if (!best) {
    // Every set that fits the moves lists only ruled-out items: it stays the pick and plays the replacement, if any.
    const replaced = unruled ? withItemAfterRuleOut(withSlotsResolved(unruled, evidence), unruled, evidence) : null;
    return replaced?.itemReplaced ? replaced : null;
  }
  const resolved = withItemSlotResolved(withSlotsResolved(best, evidence), evidence);
  return unruled && unruled !== best ? withItemAfterRuleOut(resolved, unruled, evidence) : resolved;
}

// The next set won after a rule-out, so its item is no evidence: it plays a supported guess, else the top allowed item.
function withItemAfterRuleOut(
  set: PokemonSetAssumption, unruled: PokemonSetAssumption, evidence: CuratedEvidence,
): CuratedSetAssumption {
  const allowed = (item: string | undefined): item is string =>
    !!item && !evidence.ruledOutItems.includes(evidence.dex.items.get(item).id as string);
  const replacement = [evidence.guessedItem, evidence.usageItem].find(allowed);
  if (!replacement) return set;
  const why = replacement === evidence.guessedItem ? `${replacement} guessed from the log` : 'most used other item';
  const listed = (unruled.item?.options ?? [unruled.item?.value]).join(' and ');
  return { ...set, item: { value: replacement, sourceDetail: `${listed} ruled out, ${why}` }, itemReplaced: true };
}

/** The IVs the build plays from the published sets: the chosen set's, else the marginal set's; one rule for both. */
export function publishedIvs(
  curated: CuratedSetAssumption | null, usageHasSpread: boolean, smogonSet: PokemonSetAssumption | undefined,
): PokemonSetAssumption['ivs'] {
  return curated ? curated.ivs : !usageHasSpread ? smogonSet?.ivs : undefined;
}

/** Whether `item` is the chosen set's own: an option of its published item slot that no rule-out replaced. */
export function itemFromChosenSet(dex: RulesDex, curated: CuratedSetAssumption | null, item: string): boolean {
  if (!curated?.item || curated.itemReplaced || !item) return false;
  const itemId = (name: string) => dex.items.get(name).id as string;
  return (curated.item.options ?? [curated.item.value]).some(option => itemId(option) === itemId(item));
}

function withItemSlotResolved(set: PokemonSetAssumption, evidence: CuratedEvidence): PokemonSetAssumption {
  const options = set.item?.options;
  if (!set.item || !options) return set;
  const itemId = (name: string) => evidence.dex.items.get(name).id as string;
  const played = options.find(option => itemId(option) === evidence.revealedItem)
    ?? options.find(option => !evidence.ruledOutItems.includes(itemId(option)));
  return !played || played === set.item.value ? set : { ...set, item: { ...set.item, value: played } };
}

function withSlotsResolved(set: PokemonSetAssumption, evidence: CuratedEvidence): PokemonSetAssumption {
  const moves = slotOrderedMoves(evidence.dex, set.moves, new Set(evidence.revealedMoves.map(name => slotMoveKey(evidence.dex, name))));
  return moves === set.moves ? set : { ...set, moves };
}

interface DamagingKeeps {
  keptScalings: Set<string>;
  damagingKept: Set<MoveCandidate>;
}

// Two moves the Dex calls contradicting: one reads a user stat the other lowers (Body Press beside Close Combat).
function contradicts(a: MoveFacts, b: MoveFacts): boolean {
  return (!!a.readsOwn && b.lowersOwn.includes(a.readsOwn)) || (!!b.readsOwn && a.lowersOwn.includes(b.readsOwn));
}

// No row may veto a seen damaging move or one of the chosen set, wherever the pool lists it.
function protectedDamaging(dex: RulesDex, candidates: MoveCandidate[]): MoveFacts[] {
  return candidates.filter(candidate => !candidate.guessed || candidate.fromSet)
    .map(candidate => factsOf(dex, candidate.name))
    .filter((facts): facts is MoveFacts => !!facts && facts.category !== 'Status');
}

// Pass 1 decides rows 1 and 2, so a status rule can ask what the kept attacks scale with.
function keepDamagingMoves(dex: RulesDex, candidates: MoveCandidate[], served: Set<string>): DamagingKeeps {
  const keptDamageTypes = new Set<string>();
  const keptScalings = new Set<string>();
  const damagingKept = new Set<MoveCandidate>();
  const keptFacts = protectedDamaging(dex, candidates);
  for (const candidate of candidates) {
    const facts = factsOf(dex, candidate.name);
    if (!facts || facts.category === 'Status') continue;
    const keep = () => {
      damagingKept.add(candidate);
      if (facts.priority <= 0) keptDamageTypes.add(facts.type);
      if (facts.scaling) keptScalings.add(facts.scaling);
      if (candidate.guessed && !candidate.fromSet) keptFacts.push(facts);
    };
    if (!candidate.guessed || candidate.fromSet) {
      keep();
      continue;
    }
    // Row 1: a big attack the set's boost does not serve (SD + Body Press).
    if (served.size > 0 && facts.scaling && !served.has(facts.scaling) &&
      facts.basePower >= BOOST_VETO_MIN_BP && !facts.pivot) {
      continue;
    }
    // Row 4: a move the Dex says contradicts a kept one (Body Press beside Close Combat): the guessed move falls.
    if (keptFacts.some(kept => contradicts(facts, kept))) continue;
    // Row 2: redundant same-type damage from one slot budget (Air Slash + Hurricane): the higher usage wins.
    // A priority move is no second main attack (Ice Shard beside Icicle Crash).
    if (facts.priority <= 0 && keptDamageTypes.has(facts.type)) continue;
    keep();
  }
  return { keptScalings, damagingKept };
}

function assembleKeptMoves(
  dex: RulesDex, candidates: MoveCandidate[], restrictiveItem: 'choice' | 'av' | null, keeps: DamagingKeeps, itemFromSet: boolean,
): MoveCandidate[] {
  const kept: MoveCandidate[] = [];
  for (const candidate of candidates) {
    const facts = factsOf(dex, candidate.name);
    if (!candidate.guessed || !facts) {
      kept.push(candidate);
      continue;
    }
    if (facts.category === 'Status') {
      const spared = !!candidate.fromSet && itemFromSet;
      if (restrictiveItem === 'av' && !spared) continue;
      if (restrictiveItem === 'choice' && !TRICK_FAMILY.has(facts.id) && !spared) continue;
      // Row 3: a defense-boost enabler without its payoff attack (Iron Defense, Body Press vetoed or never offered).
      if (!candidate.fromSet && defenseBoost(dex.moves.get(facts.id)) && !keeps.keptScalings.has('def')) continue;
      kept.push(candidate);
      continue;
    }
    if (keeps.damagingKept.has(candidate)) kept.push(candidate);
  }
  return kept;
}

export function applyCoherenceVetoes(
  candidates: MoveCandidate[],
  context: CoherenceContext,
): MoveCandidate[] {
  const { dex } = context;
  const restrictiveItem = dex.items.get(context.itemId).isChoice ? 'choice'
    : context.itemId === 'assaultvest' ? 'av' : null;
  // Boost context comes from the whole pool (usage order can list the attack first); boosts are never vetoed here.
  // A guessed boost the item rows strike serves nothing, and neither does a boost from the usage tail.
  const served = new Set<string>();
  const itemFromSet = !!context.itemFromSet;
  for (const candidate of candidates) {
    const move = dex.moves.get(candidate.name);
    const struck = candidate.guessed && restrictiveItem !== null && move.category === 'Status' && !(candidate.fromSet && itemFromSet);
    if (!struck && !candidate.tail) for (const stat of boostsServed(move)) served.add(stat);
  }

  const keeps = keepDamagingMoves(dex, candidates, served);
  return assembleKeptMoves(dex, candidates, restrictiveItem, keeps, itemFromSet);
}
