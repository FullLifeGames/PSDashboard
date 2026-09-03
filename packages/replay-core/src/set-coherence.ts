// Data-only Dex: this module is reachable from the app's MAIN bundle via
// team-info's enrichment — importing @pkmn/sim here would drag the whole
// simulator across the dynamic-import boundary (team-builder stays lazy).
import { Dex } from '@pkmn/dex';
import type { PokemonSetAssumption } from './smogon/sets-lookup.ts';

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
}

export interface CoherenceContext {
  /** The set's item id ('' when unknown) — provenance does not matter: only
   * guessed MOVES are vetoed, and a status fill contradicts a Choice/AV item
   * whether the item is proof or the stronger guess. */
  itemId: string;
}

/** Offense stat each setup move serves — the coherence axis of veto row 1. */
const BOOST_SERVES: Record<string, 'atk' | 'spa'> = {
  swordsdance: 'atk', dragondance: 'atk', bulkup: 'atk', coil: 'atk',
  honeclaws: 'atk', victorydance: 'atk', shiftgear: 'atk', shellsmash: 'atk',
  nastyplot: 'spa', calmmind: 'spa', quiverdance: 'spa', tailglow: 'spa',
  geomancy: 'spa', torchsong: 'spa',
};

/** Pivots are utility whatever their category — never boost-vetoed. */
const PIVOT_MOVES = new Set(['uturn', 'voltswitch', 'flipturn', 'partingshot', 'batonpass', 'teleport', 'chillyreception', 'shedtail']);

/**
 * Defense-boost setup whose offensive payoff is a Defense-scaling attack
 * (Body Press). Usage ranks these high BECAUSE of the pairing — when the
 * payoff attack is vetoed or absent, the guessed enabler must fall with it
 * (GPL Cobalion: Body Press vetoed next to revealed Swords Dance, Iron
 * Defense stayed behind).
 */
const DEF_BOOSTS = new Set(['irondefense', 'acidarmor', 'cottonguard', 'barrier', 'shelter']);

const CHOICE_ITEMS = new Set(['choiceband', 'choicespecs', 'choicescarf']);
const TRICK_FAMILY = new Set(['trick', 'switcheroo']);

/** A boost-contradiction only matters on moves whose DAMAGE is the point. */
const BOOST_VETO_MIN_BP = 70;

interface MoveFacts {
  id: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  type: string;
  /** The stat the move's damage actually scales with (Body Press: def). */
  scaling: 'atk' | 'spa' | 'def' | null;
}

function factsOf(name: string): MoveFacts | null {
  const move = Dex.moves.get(name);
  if (!move.exists) return null;
  const scaling = move.category === 'Status' ? null
    : move.overrideOffensiveStat === 'def' ? 'def'
    : move.category === 'Physical' ? 'atk' : 'spa';
  return { id: move.id, category: move.category, basePower: move.basePower, type: move.type, scaling };
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

/** Two points per revealed move, item, and ability the candidate carries. */
function fitScore(ids: CandidateIds, evidence: CuratedEvidence): number {
  let fit = 0;
  for (const revealed of evidence.revealedMoves) {
    if (ids.moveIds.includes(revealed)) fit += 2;
  }
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

    const fit = fitScore(ids, evidence);
    if (fit < evidence.revealedMoves.length) continue;

    const tiebreak = ids.moveIds.reduce((sum, id) =>
      sum + Math.log(Math.max(evidence.usageProbability(id), UNSEEN_MOVE_PROBABILITY)), 0);
    if (fit > bestFit || (fit === bestFit && tiebreak > bestTiebreak)) {
      best = candidate;
      bestFit = fit;
      bestTiebreak = tiebreak;
    }
  }
  return best;
}

interface DamagingKeeps {
  keptScalings: Set<string>;
  damagingKept: Set<MoveCandidate>;
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
  for (const candidate of candidates) {
    const facts = factsOf(candidate.name);
    if (!facts || facts.category === 'Status') continue;
    const keep = () => {
      damagingKept.add(candidate);
      keptDamageTypes.add(facts.type);
      if (facts.scaling) keptScalings.add(facts.scaling);
    };
    if (!candidate.guessed) {
      keep();
      continue;
    }
    // Row 1: a big attack the set's boost does not serve (SD + Body Press).
    if (served.size > 0 && facts.scaling && !served.has(facts.scaling) &&
      facts.basePower >= BOOST_VETO_MIN_BP && !PIVOT_MOVES.has(facts.id)) {
      continue;
    }
    // Row 2: redundant same-type damage from the same slot budget
    // (Air Slash + Hurricane) — first accepted (higher usage) wins.
    if (keptDamageTypes.has(facts.type)) continue;
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
      if (DEF_BOOSTS.has(facts.id) && !keeps.keptScalings.has('def')) continue;
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
  // Boost context comes from the WHOLE pool (usage order can list the attack
  // before the boost) — boost moves themselves are never vetoed by these rows.
  const served = new Set<string>();
  for (const candidate of candidates) {
    const serves = BOOST_SERVES[Dex.moves.get(candidate.name).id];
    if (serves) served.add(serves);
  }
  const restrictiveItem = CHOICE_ITEMS.has(context.itemId) ? 'choice'
    : context.itemId === 'assaultvest' ? 'av' : null;

  const keeps = keepDamagingMoves(candidates, served);
  return assembleKeptMoves(candidates, restrictiveItem, keeps);
}
