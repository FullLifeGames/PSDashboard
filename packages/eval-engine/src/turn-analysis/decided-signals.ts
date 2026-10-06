import { AUTO_MCTS_FAINTED_FRACTION } from '../types.ts';
import {
  DECIDED_SCORE, decidedSeenKey, forcedWinSeenKey, type AnalyzeTurnParams, type Side, type SideAnalysis,
} from './types.ts';
import { heldDecided } from './decided-held.ts';
import { forcedWinSpeaks } from './forced-speech.ts';

/**
 * Round 15: the decided sweep / the near-decided roll — board states, not
 * click context: they attach to the owning side on every turn they hold
 * (display layers book resolution prose from the state) and announce only
 * until the game report has spoken them once. Round 35 adds the proven
 * forced win, which speaks for the board when it speaks. Narrative only:
 * computed where the full result is in scope (signals.ts), never graded.
 */

/** Round 35: the forced win for this side, spoken once by the report; when it speaks, the decided stages stay quiet. */
function forcedWinSignal(params: AnalyzeTurnParams, key: Side): SideAnalysis['forcedWin'] {
  const forced = params.result.forcedWin;
  if (!forced || forced.side !== key) return undefined;
  return {
    turns: forced.turns, mass: forced.mass, caveat: forced.caveat,
    ...(forced.open ? { open: forced.open } : {}),
    announce: !params.decidedSeen?.has(forcedWinSeenKey(key)),
  };
}

/**
 * Round 63 (T18): the near stage speaks once a quarter of the bodies has
 * fallen (the auto mode's phase line). Gated on announce, so the report
 * walk speaks it at the first turn in phase; the state stays for the
 * denied-early-end reading. An unknown share keeps the gate off.
 */
const nearInPhase = (params: AnalyzeTurnParams): boolean =>
  params.faintedFraction === undefined || params.faintedFraction === null ||
  params.faintedFraction >= AUTO_MCTS_FAINTED_FRACTION;

/**
 * Round 63 (T18): the card's own outcome still backs the sweep — the
 * after-score holds the decided line (DECIDED_SCORE) for the side, or the
 * game ended. A turn that undid it says so in its estimate; "from here X
 * clears everything" would contradict it (649664 t23: 16% to 81% the other
 * way; 573756 t124: down to 0.39). The near stage has no such gate: its
 * sentence is about a roll that may fail (573756 t73).
 */
const outcomeHolds = (params: AnalyzeTurnParams, key: Side): boolean =>
  params.scoreAfter === null || (key === 'p1' ? params.scoreAfter : -params.scoreAfter) >= DECIDED_SCORE;

/** Round 50: the sweep needs the search's key (heldDecided); the near stage below does not. */
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
    species: ownNear.species, odds: ownNear.odds, removes: ownNear.removes,
    announce: nearInPhase(params) && !params.decidedSeen?.has(
      decidedSeenKey(key, { species: ownNear.species, removes: ownNear.removes })),
  };
}

/** A spoken claim's marker: it was spoken while the side's bar sat inside the decided zone. */
const zoneMarker = (claim: string): string => `${claim}:zone`;

/**
 * Round 64 (T123): the walk notes a spoken decided or forced key, and when
 * the turn's bar read the side at DECIDED_SCORE or beyond, also that it was
 * spoken inside the decided zone (releaseBrokenClaims needs it).
 */
export function noteSpokenClaim(seen: Set<string>, claim: string, key: Side, scoreBefore: number): void {
  seen.add(claim);
  if ((key === 'p1' ? scoreBefore : -scoreBefore) >= DECIDED_SCORE) seen.add(zoneMarker(claim));
}

/**
 * Round 64 (T123): the report walk speaks a side's decided and forced
 * sentences once, until the board leaves the decided zone: a claim spoken
 * inside the zone is forgotten once a later turn's bar reads the side under
 * DECIDED_SCORE, and a new sweep or proof speaks again (2630685175: decided
 * at t6, the bar fell to 16% at t7, decided again at t10). The release is a
 * transition: a proof spoken under the line (an open event holding the bar
 * at 0.65) left no zone and stays spoken, or it would repeat every turn.
 * Near keys stay; a near stage lives under the line by nature (573756 t73).
 */
export function releaseBrokenClaims(seen: Set<string>, scoreBefore: number): void {
  for (const key of ['p1', 'p2'] as const) {
    if ((key === 'p1' ? scoreBefore : -scoreBefore) >= DECIDED_SCORE) continue;
    // The decided stage keys on the side alone (round 63), whatever the species.
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
  // Round 63 (T18): once the report has spoken the side's proof, its decided
  // stages add nothing (648453: t36 and t39 after the proof at t35).
  const proofSpoken = params.decidedSeen?.has(forcedWinSeenKey(key)) ?? false;
  if (proofSpoken || forcedWinSpeaks(forcedWin, key === 'p1' ? params.scoreBefore : -params.scoreBefore)) {
    // The proof speaks for the board; the decided stages keep their state, quietly.
    if (decided) decided = { ...decided, announce: false };
    if (nearDecided) nearDecided = { ...nearDecided, announce: false };
  }
  return { decided, nearDecided, forcedWin };
}
