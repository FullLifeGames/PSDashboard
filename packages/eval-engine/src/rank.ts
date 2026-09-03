/**
 * Pure ranking math over a computed value matrix. No @pkmn/sim imports —
 * this module is safe for the main bundle, so a main-thread coordinator can
 * rank worker-computed values without pulling in the sim. The stages live
 * in ranking/: the matrix and cell helpers, the equilibrium solve, the
 * ordering, the tie groups, and the trend layers.
 */

export { cellKey, reblendValue, TOP_EXPANSION } from './ranking/matrix.ts';
export type { PvStep, Ranked, ValueMatrix } from './ranking/matrix.ts';
export { solveMatrixGame } from './ranking/solve.ts';
export { attachLines, rankFromMatrix, selectExpansionCells, toResult } from './ranking/order.ts';
export { coreOf, GIMMICK_TOKENS, selectTieProbeCells, TIE_EPSILON, TREND_MARGIN } from './ranking/ties.ts';
export { applyTrendExtrapolation, applyTrendTiebreak, TREND_LAMBDA } from './ranking/trend.ts';
