import type { PRNGSeed } from '@pkmn/sim';

/**
 * The fixed seed lists the search read until round 89 (#60, T324), kept for the specs that name the old streams. No `src` file reads a
 * list: the engine reads only how many draws each path takes (`BASE_DRAWS` in `search/leaf.ts`, `FALLBACK_DRAWS` in
 * `pair/sampler.ts`) and takes the seeds themselves from `cellSeeds` (`search/root-quantile.ts`). A spec holds the counts to the
 * lengths of these lists (`cell-seed-t324.spec.ts`).
 */

/** The five search seeds. */
export const SEARCH_SEEDS: readonly PRNGSeed[] = [
  '1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20',
];

/** The eleven probe seeds that followed them. */
export const PROBE_SEEDS: readonly PRNGSeed[] = [
  '21,22,23,24', '25,26,27,28', '29,30,31,32', '33,34,35,36', '37,38,39,40',
  '41,42,43,44', '45,46,47,48', '49,50,51,52', '53,54,55,56', '57,58,59,60',
  '61,62,63,64',
];

/** The doubles fallback's eight natural draws: the five search seeds and the first three probe seeds. */
export const FALLBACK_SEEDS: readonly PRNGSeed[] = [...SEARCH_SEEDS, ...PROBE_SEEDS.slice(0, 3)];

/** A plain verify cell's sixteen draws: the search seeds, then the probe seeds. */
export const VERIFY_PLAIN_SEEDS: readonly PRNGSeed[] = [...SEARCH_SEEDS, ...PROBE_SEEDS];
