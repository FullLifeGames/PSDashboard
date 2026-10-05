import { MIN_FORCED_MASS, SPOKEN_MASS } from '../types.ts';
import { TIER_THRESHOLDS } from './types.ts';

/**
 * Round 63 (T19): under SPOKEN_MASS a proof still speaks on the turn card
 * when the side's bar sits at least this far under the proven win — the
 * open event is then why the number is lower (649664 t24: mass 0.8, the
 * next 80% Hydro Pump must land, bar 0.79). The sampled-rolls caveat takes
 * the same gap. A proof whose open branch wins anyway keeps the bar near
 * the win and stays quiet (573756 t138: mass 0.66, bar 0.97, a 2% event).
 */
export const OPEN_EVENT_BAR_GAP = TIER_THRESHOLDS.inaccuracy;

/**
 * Whether the forced-win sentence speaks: at the spoken mass, or on a real
 * proof (above the coin flip) whose open event holds the own bar down by
 * OPEN_EVENT_BAR_GAP. `ownBar` is the turn's score from the proving side.
 */
export function forcedWinSpeaks(forced: { mass: number; announce: boolean } | undefined, ownBar: number): boolean {
  if (!forced?.announce) return false;
  if (forced.mass >= SPOKEN_MASS) return true;
  return forced.mass > MIN_FORCED_MASS && 1 - ownBar >= OPEN_EVENT_BAR_GAP;
}
