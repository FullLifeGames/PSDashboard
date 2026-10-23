import type { GameRules } from '@fulllifegames/replay-core';
import type { AnalyzeTurnParams } from './types.ts';

/**
 * Round 75 (T160): the generation and mod a turn's analysis reads rules by, from the board context it was given (`actives`
 * carries the replay's generation and mod). Without the board there is no game to read: the callers then skip the Dex reads
 * that need one (a species fold, a priority, a hazard) instead of answering for Scarlet/Violet.
 */
export const rulesOfActives = (actives: AnalyzeTurnParams['actives']): GameRules | undefined =>
  actives ? { gen: actives.gen, mod: actives.mod } : undefined;
