import { AUTO_MCTS_FAINTED_FRACTION } from '../types.ts';
import {
  decidedSeenKey, forcedWinSeenKey, type AnalyzeTurnParams, type Side, type SideAnalysis,
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

export function decidedSignals(
  params: AnalyzeTurnParams,
  key: Side,
): { decided: SideAnalysis['decided']; nearDecided: SideAnalysis['nearDecided']; forcedWin: SideAnalysis['forcedWin'] } {
  let decided: SideAnalysis['decided'];
  // Round 50: the sweep needs the search's key; the near stage below does not.
  const ownDecided = heldDecided(params.result);
  if (ownDecided && ownDecided.side === key) {
    decided = {
      species: ownDecided.species,
      announce: !params.decidedSeen?.has(decidedSeenKey(key, { species: ownDecided.species })),
    };
  }
  let nearDecided: SideAnalysis['nearDecided'];
  const ownNear = params.result.unanswered?.nearDecided;
  if (ownNear && ownNear.side === key) {
    nearDecided = {
      species: ownNear.species, odds: ownNear.odds, removes: ownNear.removes,
      announce: nearInPhase(params) && !params.decidedSeen?.has(
        decidedSeenKey(key, { species: ownNear.species, removes: ownNear.removes })),
    };
  }
  const forcedWin = forcedWinSignal(params, key);
  if (forcedWinSpeaks(forcedWin, key === 'p1' ? params.scoreBefore : -params.scoreBefore)) {
    // The proof speaks for the board; the decided stages keep their state, quietly.
    if (decided) decided = { ...decided, announce: false };
    if (nearDecided) nearDecided = { ...nearDecided, announce: false };
  }
  return { decided, nearDecided, forcedWin };
}
