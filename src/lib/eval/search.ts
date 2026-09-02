/**
 * The search facade: the value space, the option lists, the hints, and the
 * matrix search live in search/; this module keeps the public names every
 * consumer imports.
 */

// Re-exported for engine-side consumers (the calibration harness's auto
// dispatch); the constant itself lives in types.ts so the UI can share it
// without importing the sim.
export { AUTO_MCTS_FAINTED_FRACTION } from './types';
export { battleFaintedFraction, leafValue, SEARCH_SEEDS } from './search/leaf';
export { optionHints } from './search/hints';
export { RESTRICT_K, RESTRICT_K_DOUBLES, searchOptions } from './search/options';
export type { SearchCallbacks } from './search/matrix';
export { createLocalExecutor, searchPosition, subSearchDepth1 } from './search/position';
