import { Generations } from '@smogon/calc';

/**
 * Round 68 (T186): whether the installed @smogon/calc carries the Champions generation 0 (0.12 and later). Under 0.11
 * its generation 0 is an empty shell. A checker that can only fail on generation 0 data is skipped without it; step C3
 * (the 0.12 bump) deletes this file and every skipIf on it.
 */
export const CALC_HAS_GEN0 = !!Generations.get(0 as never).species.get('garchomp' as never);
