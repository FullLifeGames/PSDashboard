// Data-only Dex: this module is reachable from the app's MAIN bundle via
// team-info's enrichment — importing @pkmn/sim here would drag the whole
// simulator across the dynamic-import boundary (team-builder stays lazy).
import { Dex } from '@pkmn/dex';
import type { PokemonSetAssumption } from './smogon/sets-lookup.ts';
import { filledSlots, slotMoveKey, slotOrderedMoves } from './team/move-slots.ts';

/**
 * Pairwise coherence vetoes for guessed set assembly. Marginal fills (top
 * usage moves + top usage item) are individually plausible but often jointly
 * incoherent — SD Cobalion carrying Body Press, Noivern with Air Slash AND
 * Hurricane, a Choice set stuffed with status (GPL findings). Each veto row
 * applies ONLY to guessed entries: revealed/manual knowledge is proof and is
 * never second-guessed, however incoherent it looks.
 */

export interface MoveCandidate {
  name: string;
  /** false = revealed/manual (immune to vetoes), true = usage/set fill. */
  guessed: boolean;
  /**
   * A move of the chosen Smogon set: coherent by construction, so rows 1
   * and 2 spare it; the item rows still apply, because the item may come
   * from elsewhere (an inferred Scarf). Round 63, T28.
   */
  fromSet?: boolean;
  /**
   * A usage move past the top ten: it may refill a slot, but its boost
   * serves nothing in row 1 (round 63 review: a Dragon Dance at 0.2 %
   * struck Kingdra's guessed special attacks).
   */
  tail?: boolean;
}

export interface CoherenceContext {
  /** The set's item id ('' when unknown) — provenance does not matter: only
   * guessed MOVES are vetoed, and a status fill contradicts a Choice/AV item
   * whether the item is proof or the stronger guess. */
  itemId: string;
}

type DexMove = ReturnType<typeof Dex.moves.get>;

/**
 * The offense stats a move raises for its user, from the Dex (round 64,
 * decision 17): a self-targeted status move's boosts, `self.boosts`,
 * `selfBoost`, and a sure secondary's self boosts (Torch Song). The
 * coherence axis of veto row 1.
 */
function boostsServed(move: DexMove): ('atk' | 'spa')[] {
  const raised: Record<string, number | undefined> = {
    ...(move.category === 'Status' && move.target === 'self' ? move.boosts : undefined),
    ...move.self?.boosts, ...move.selfBoost?.boosts,
    ...(move.secondary?.chance === 100 ? move.secondary.self?.boosts : undefined),
  };
  return (['atk', 'spa'] as const).filter(stat => (raised[stat] ?? 0) > 0);
}

/**
 * Defense-boost setup whose offensive payoff is a Defense-scaling attack
 * (Body Press). Usage ranks these high BECAUSE of the pairing — when the
 * payoff attack is vetoed or absent, the guessed enabler must fall with it
 * (GPL Cobalion: Body Press vetoed next to revealed Swords Dance, Iron
 * Defense stayed behind). From the Dex (round 64, decision 17): a
 * self-targeted status move that raises Defense and no offense stat.
 */
function defenseBoost(move: DexMove): boolean {
  return move.category === 'Status' && move.target === 'self' && (move.boosts?.def ?? 0) > 0 && boostsServed(move).length === 0;
}

const TRICK_FAMILY = new Set(['trick', 'switcheroo']);

/** A boost-contradiction only matters on moves whose DAMAGE is the point. */
const BOOST_VETO_MIN_BP = 70;

interface MoveFacts {
  id: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  type: string;
  /** Moves before the turn order (Ice Shard): their own role, never a redundant second attack. */
  priority: number;
  /** The stat the move's damage actually scales with (Body Press: def). */
  scaling: 'atk' | 'spa' | 'def' | null;
  /** A pivot (the Dex's `selfSwitch`: U-turn, Volt Switch) is utility whatever its category, never boost-vetoed. */
  pivot: boolean;
  /** The user's own stat the damage reads outside its category (Body Press: def); null for the rest. */
  readsOwn: string | null;
  /** The user's stats the move lowers on use (Close Combat: def and spd). */
  lowersOwn: string[];
}

/** The user's stats a move lowers on itself, from the Dex (`self.boosts`, `selfBoost`). */
function ownStatsLowered(move: DexMove): string[] {
  const boosts: Record<string, number | undefined> = { ...move.self?.boosts, ...move.selfBoost?.boosts };
  return Object.keys(boosts).filter(stat => (boosts[stat] ?? 0) < 0);
}

function factsOf(name: string): MoveFacts | null {
  const move = Dex.moves.get(name);
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
  /** Move ids seen in game or user-set — the anchors a set must cover. */
  revealedMoves: string[];
  /** Item/ability ids known from proof ('' when unknown). */
  revealedItem: string;
  revealedAbility: string;
  ruledOutItems: string[];
  ruledOutAbilities: string[];
  /** Usage marginal probability of a move id (tiebreak; 0..1). */
  usageProbability: (moveId: string) => number;
}

/** Marginal floor for moves the usage list does not know. */
const UNSEEN_MOVE_PROBABILITY = 0.01;

/**
 * Coherent-set selection: score each CURATED set against the revealed
 * evidence and build from the best match instead of assembling marginals.
 * fit = +2 per revealed move in the set, +2 item match, +2 ability match,
 * disqualified on rule-out violations; ties break toward the set whose moves
 * the usage marginals like best (Σ log p). A set below the floor —
 * fit < revealed-move count, i.e. it contradicts what we saw — yields null
 * and the caller falls back to marginal assembly plus the pairwise vetoes.
 */
interface CandidateIds {
  moveIds: string[];
  itemId: string;
  abilityId: string;
}

function candidateIds(candidate: PokemonSetAssumption): CandidateIds {
  return {
    moveIds: candidate.moves.map(move => Dex.moves.get(move.value).id as string),
    itemId: candidate.item ? (Dex.items.get(candidate.item.value).id as string) : '',
    abilityId: candidate.ability ? (Dex.abilities.get(candidate.ability.value).id as string) : '',
  };
}

/**
 * Two points per move slot a revealed move fills (any option, one move per
 * slot: T89), per revealed item, and per revealed ability the candidate carries.
 */
function fitScore(candidate: PokemonSetAssumption, ids: CandidateIds, evidence: CuratedEvidence): number {
  let fit = 2 * filledSlots(candidate.moves, evidence.revealedMoves.map(slotMoveKey)).size;
  if (evidence.revealedItem && ids.itemId === evidence.revealedItem) fit += 2;
  if (evidence.revealedAbility && ids.abilityId === evidence.revealedAbility) fit += 2;
  return fit;
}

export function selectCuratedSet(
  candidates: PokemonSetAssumption[],
  evidence: CuratedEvidence,
): PokemonSetAssumption | null {
  let best: PokemonSetAssumption | null = null;
  let bestFit = -Infinity;
  let bestTiebreak = -Infinity;
  for (const candidate of candidates) {
    const ids = candidateIds(candidate);
    if (ids.itemId && evidence.ruledOutItems.includes(ids.itemId)) continue;
    if (ids.abilityId && evidence.ruledOutAbilities.includes(ids.abilityId)) continue;

    const fit = fitScore(candidate, ids, evidence);
    if (fit < evidence.revealedMoves.length) continue;

    const tiebreak = ids.moveIds.reduce((sum, id) =>
      sum + Math.log(Math.max(evidence.usageProbability(id), UNSEEN_MOVE_PROBABILITY)), 0);
    if (fit > bestFit || (fit === bestFit && tiebreak > bestTiebreak)) {
      best = candidate;
      bestFit = fit;
      bestTiebreak = tiebreak;
    }
  }
  return best ? withSlotsResolved(best, evidence) : null;
}

/** The winner's moves with its slots read against the evidence (T89, decision 11). */
function withSlotsResolved(set: PokemonSetAssumption, evidence: CuratedEvidence): PokemonSetAssumption {
  const moves = slotOrderedMoves(set.moves, new Set(evidence.revealedMoves.map(slotMoveKey)));
  return moves === set.moves ? set : { ...set, moves };
}

interface DamagingKeeps {
  keptScalings: Set<string>;
  damagingKept: Set<MoveCandidate>;
}

/** Two moves the Dex calls contradicting: one reads a user stat the other lowers (Body Press beside Close Combat). */
function contradicts(a: MoveFacts, b: MoveFacts): boolean {
  return (!!a.readsOwn && b.lowersOwn.includes(a.readsOwn)) || (!!b.readsOwn && a.lowersOwn.includes(b.readsOwn));
}

/** The damaging moves no row may veto: seen ones and the chosen set's, wherever the pool lists them. */
function protectedDamaging(candidates: MoveCandidate[]): MoveFacts[] {
  return candidates.filter(candidate => !candidate.guessed || candidate.fromSet)
    .map(candidate => factsOf(candidate.name))
    .filter((facts): facts is MoveFacts => !!facts && facts.category !== 'Status');
}

/**
 * Pass 1 decides the DAMAGING keeps (rows 1 and 2), so a status rule can
 * ask what the kept attacks scale with — Iron Defense is only coherent
 * while a Defense-scaling attack survives.
 */
function keepDamagingMoves(candidates: MoveCandidate[], served: Set<string>): DamagingKeeps {
  const keptDamageTypes = new Set<string>();
  const keptScalings = new Set<string>();
  const damagingKept = new Set<MoveCandidate>();
  const keptFacts = protectedDamaging(candidates);
  for (const candidate of candidates) {
    const facts = factsOf(candidate.name);
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
    // Row 4: a move the Dex says contradicts a kept one (Body Press reads
    // the Defense that Close Combat or Clanging Scales lowers): the guessed
    // move falls, the first kept stays (round 64, T120, decision 15).
    if (keptFacts.some(kept => contradicts(facts, kept))) continue;
    // Row 2: redundant same-type damage from the same slot budget
    // (Air Slash + Hurricane) — first accepted (higher usage) wins. A
    // priority move is no second main attack (Ice Shard beside Icicle Crash).
    if (facts.priority <= 0 && keptDamageTypes.has(facts.type)) continue;
    keep();
  }
  return { keptScalings, damagingKept };
}

/** Pass 2 assembles in pool order; status rows run against the kept attacks. */
function assembleKeptMoves(
  candidates: MoveCandidate[], restrictiveItem: 'choice' | 'av' | null, keeps: DamagingKeeps,
): MoveCandidate[] {
  const kept: MoveCandidate[] = [];
  for (const candidate of candidates) {
    const facts = factsOf(candidate.name);
    if (!candidate.guessed || !facts) {
      kept.push(candidate);
      continue;
    }
    if (facts.category === 'Status') {
      if (restrictiveItem === 'av') continue;
      if (restrictiveItem === 'choice' && !TRICK_FAMILY.has(facts.id)) continue;
      // Row 3: a defense-boost enabler without its payoff attack (Iron
      // Defense whose Body Press was vetoed or never offered).
      if (defenseBoost(Dex.moves.get(facts.id)) && !keeps.keptScalings.has('def')) continue;
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
  // A Choice item from the Dex (`isChoice`, round 64 decision 17).
  const restrictiveItem = Dex.items.get(context.itemId).isChoice ? 'choice'
    : context.itemId === 'assaultvest' ? 'av' : null;
  // Boost context comes from the WHOLE pool (usage order can list the attack
  // before the boost) — boost moves themselves are never vetoed by these rows.
  // A guessed boost the item rows strike serves nothing (round 63, T28: a
  // usage Dragon Dance under Choice Specs left Kyurem with Icicle Spear only),
  // and neither does a boost from the usage tail.
  const served = new Set<string>();
  for (const candidate of candidates) {
    const move = Dex.moves.get(candidate.name);
    const struck = candidate.guessed && restrictiveItem !== null && move.category === 'Status';
    if (!struck && !candidate.tail) for (const stat of boostsServed(move)) served.add(stat);
  }

  const keeps = keepDamagingMoves(candidates, served);
  return assembleKeptMoves(candidates, restrictiveItem, keeps);
}
