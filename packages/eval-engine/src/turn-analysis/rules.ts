import type { GameRules } from '@fulllifegames/replay-core';
import type { AnalyzeTurnParams } from './types.ts';

/**
 * The generation and mod a turn's analysis reads rules by, from the board context (`actives`). Without the board there is no game to read:
 * callers skip the Dex reads that need one instead of answering for Scarlet/Violet.
 */
export const rulesOfActives = (actives: AnalyzeTurnParams['actives']): GameRules | undefined =>
  actives ? { gen: actives.gen, mod: actives.mod } : undefined;
