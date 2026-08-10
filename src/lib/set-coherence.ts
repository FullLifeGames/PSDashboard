import { Dex } from '@pkmn/sim';
import type { PokemonSetAssumption } from './smogon-sets';

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
export function selectCuratedSet(
  candidates: PokemonSetAssumption[],
  evidence: CuratedEvidence,
): PokemonSetAssumption | null {
  let best: PokemonSetAssumption | null = null;
  let bestFit = -Infinity;
  let bestTiebreak = -Infinity;
  for (const candidate of candidates) {
    const moveIds = candidate.moves.map(move => Dex.moves.get(move.value).id as string);
    const itemId = candidate.item ? (Dex.items.get(candidate.item.value).id as string) : '';
    const abilityId = candidate.ability ? (Dex.abilities.get(candidate.ability.value).id as string) : '';
    if (itemId && evidence.ruledOutItems.includes(itemId)) continue;
    if (abilityId && evidence.ruledOutAbilities.includes(abilityId)) continue;

    let fit = 0;
    for (const revealed of evidence.revealedMoves) {
      if (moveIds.includes(revealed)) fit += 2;
    }
    if (evidence.revealedItem && itemId === evidence.revealedItem) fit += 2;
    if (evidence.revealedAbility && abilityId === evidence.revealedAbility) fit += 2;
    if (fit < evidence.revealedMoves.length) continue;

    const tiebreak = moveIds.reduce((sum, id) =>
      sum + Math.log(Math.max(evidence.usageProbability(id), UNSEEN_MOVE_PROBABILITY)), 0);
    if (fit > bestFit || (fit === bestFit && tiebreak > bestTiebreak)) {
      best = candidate;
      bestFit = fit;
      bestTiebreak = tiebreak;
    }
  }
  return best;
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

  const kept: MoveCandidate[] = [];
  const keptDamageTypes = new Set<string>();
  const keep = (candidate: MoveCandidate, facts: MoveFacts | null) => {
    kept.push(candidate);
    if (facts && facts.category !== 'Status') keptDamageTypes.add(facts.type);
  };

  for (const candidate of candidates) {
    const facts = factsOf(candidate.name);
    if (!candidate.guessed || !facts) {
      keep(candidate, facts);
      continue;
    }
    if (facts.category === 'Status') {
      if (restrictiveItem === 'av') continue;
      if (restrictiveItem === 'choice' && !TRICK_FAMILY.has(facts.id)) continue;
      keep(candidate, facts);
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
    keep(candidate, facts);
  }
  return kept;
}
