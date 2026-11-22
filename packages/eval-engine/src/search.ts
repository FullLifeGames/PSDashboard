/**
 * The search facade: the value space, the option lists, the hints, and the
 * matrix search live in search/; this module keeps the public names every
 * consumer imports.
 */

export { battleFaintedFraction } from './search/leaf.ts';
export { optionHints } from './search/hints.ts';
export { searchOptions } from './search/options.ts';
export { createLocalExecutor, searchPosition, subSearchDepth1 } from './search/position.ts';
