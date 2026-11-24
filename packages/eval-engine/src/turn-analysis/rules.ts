import type { GameRules } from '@fulllifegames/replay-core';
import type { AnalyzeTurnParams } from './types.ts';

/** The rules a turn is read by; none without the board: callers skip Dex reads instead of assuming Scarlet/Violet. */
export const rulesOfActives = (actives: AnalyzeTurnParams['actives']): GameRules | undefined =>
  actives ? { gen: actives.gen, mod: actives.mod } : undefined;
