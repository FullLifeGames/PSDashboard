import { MIN_FORCED_MASS, SPOKEN_MASS } from '../types.ts';
import { TIER_THRESHOLDS } from './types.ts';

/** Under SPOKEN_MASS a proof still speaks when the bar sits this far under the win: the open event explains it. */
export const OPEN_EVENT_BAR_GAP = TIER_THRESHOLDS.inaccuracy;

export function forcedWinSpeaks(forced: { mass: number; announce: boolean } | undefined, ownBar: number): boolean {
  if (!forced?.announce) return false;
  if (forced.mass >= SPOKEN_MASS) return true;
  return forced.mass > MIN_FORCED_MASS && 1 - ownBar >= OPEN_EVENT_BAR_GAP;
}
