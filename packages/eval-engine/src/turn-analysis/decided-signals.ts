import { AUTO_MCTS_FAINTED_FRACTION } from '../types.ts';
import {
  DECIDED_SCORE, decidedSeenKey, forcedWinSeenKey, type AnalyzeTurnParams, type Side, type SideAnalysis,
} from './types.ts';
import { heldDecided } from './decided-held.ts';
import { forcedWinSpeaks } from './forced-speech.ts';

// The decided sweep, the near-decided roll and the proven forced win: board states that attach to the owning side on every turn they hold
// and announce only until the game report has spoken them once. Narrative only, never graded.

/** The forced win for this side, spoken once by the report; when it speaks, the decided stages stay quiet. */
function forcedWinSignal(params: AnalyzeTurnParams, key: Side): SideAnalysis['forcedWin'] {
  const forced = params.result.forcedWin;
  if (!forced || forced.side !== key) return undefined;
  return {
    turns: forced.turns, mass: forced.mass, caveat: forced.caveat,
    ...(forced.open ? { open: forced.open } : {}),
    ...(forced.delay ? { delay: forced.delay } : {}),
    ...(forced.delayName ? { delayName: forced.delayName } : {}),
    ...(forced.choiceNames ? { choiceNames: forced.choiceNames } : {}),
    announce: !params.decidedSeen?.has(forcedWinSeenKey(key)),
  };
}

/**
 * The near stage speaks once a quarter of the bodies has fallen (the auto mode's phase line); gated on announce, so the report walk speaks
 * it at the first turn in phase, and the state stays for the denied-early-end reading. An unknown share keeps the gate off.
 */
const nearInPhase = (params: AnalyzeTurnParams): boolean =>
  params.faintedFraction === undefined || params.faintedFraction === null ||
  params.faintedFraction >= AUTO_MCTS_FAINTED_FRACTION;

/**
 * The card's own outcome still backs the sweep: the after-score holds the decided line for the side, or the game ended. A turn that
 * undid it says so in its estimate, and "from here X clears everything" would contradict it. The near stage has no such gate: its
 * sentence is about a roll that may fail.
 */
const outcomeHolds = (params: AnalyzeTurnParams, key: Side): boolean =>
  params.scoreAfter === null || (key === 'p1' ? params.scoreAfter : -params.scoreAfter) >= DECIDED_SCORE;

function decidedStage(params: AnalyzeTurnParams, key: Side): SideAnalysis['decided'] {
  const ownDecided = heldDecided(params.result);
  if (!ownDecided || ownDecided.side !== key) return undefined;
  return {
    species: ownDecided.species,
    announce: outcomeHolds(params, key) && !params.decidedSeen?.has(decidedSeenKey(key, { species: ownDecided.species })),
  };
}

function nearStage(params: AnalyzeTurnParams, key: Side): SideAnalysis['nearDecided'] {
  const ownNear = params.result.unanswered?.nearDecided;
  if (!ownNear || ownNear.side !== key) return undefined;
  return {
    species: ownNear.species, odds: ownNear.odds, removes: ownNear.removes, ...(ownNear.click ? { click: ownNear.click } : {}),
    announce: nearInPhase(params) && !params.decidedSeen?.has(
      decidedSeenKey(key, { species: ownNear.species, removes: ownNear.removes })),
  };
}

/** A spoken claim's marker: it was spoken while the side's bar sat inside the decided zone. */
const zoneMarker = (claim: string): string => `${claim}:zone`;

/** Notes a spoken decided or forced key, and, when the turn's bar read the side at DECIDED_SCORE or beyond, that it was spoken in the decided zone. */
export function noteSpokenClaim(seen: Set<string>, claim: string, key: Side, scoreBefore: number): void {
  seen.add(claim);
  if ((key === 'p1' ? scoreBefore : -scoreBefore) >= DECIDED_SCORE) seen.add(zoneMarker(claim));
}

/** Forgets the decided and forced claims spoken inside the decided zone once the side's bar falls under DECIDED_SCORE. */
export function releaseBrokenClaims(seen: Set<string>, scoreBefore: number): void {
  // The report walk speaks a side's decided and forced sentences once, until the board leaves the decided zone: a claim spoken inside the
  // zone is forgotten once a later turn's bar reads the side under DECIDED_SCORE, and a new sweep or proof speaks again (decided at t6, the
  // bar fell to 16% at t7, decided again at t10). A proof spoken under the line (an open event holding the bar at 0.65) left no zone and
  // stays spoken, or it would repeat every turn. Near keys stay: a near stage lives under the line by nature.
  for (const key of ['p1', 'p2'] as const) {
    if ((key === 'p1' ? scoreBefore : -scoreBefore) >= DECIDED_SCORE) continue;
    // The decided stage keys on the side alone, whatever the species.
    for (const claim of [decidedSeenKey(key, { species: '' }), forcedWinSeenKey(key)]) {
      if (!seen.has(zoneMarker(claim))) continue;
      seen.delete(claim);
      seen.delete(zoneMarker(claim));
    }
  }
}

export function decidedSignals(
  params: AnalyzeTurnParams,
  key: Side,
): { decided: SideAnalysis['decided']; nearDecided: SideAnalysis['nearDecided']; forcedWin: SideAnalysis['forcedWin'] } {
  let decided = decidedStage(params, key);
  let nearDecided = nearStage(params, key);
  const forcedWin = forcedWinSignal(params, key);
  // Once the report has spoken the side's proof, its decided stages add nothing.
  const proofSpoken = params.decidedSeen?.has(forcedWinSeenKey(key)) ?? false;
  if (proofSpoken || forcedWinSpeaks(forcedWin, key === 'p1' ? params.scoreBefore : -params.scoreBefore)) {
    // The proof speaks for the board; the decided stages keep their state, quietly.
    if (decided) decided = { ...decided, announce: false };
    if (nearDecided) nearDecided = { ...nearDecided, announce: false };
  }
  return { decided, nearDecided, forcedWin };
}
