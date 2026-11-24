/** Pure ranking math over a computed value matrix, with no @pkmn/sim import so the main bundle can rank worker-computed values. */

export { cellKey, reblendValue, TOP_EXPANSION } from './ranking/matrix.ts';
export type { PvStep, Ranked, ValueMatrix } from './ranking/matrix.ts';
export { solveMatrixGame } from './ranking/solve.ts';
export { attachLines, rankFromMatrix, selectExpansionCells, toResult } from './ranking/order.ts';
export { coreOf, GIMMICK_TOKENS, selectTieProbeCells, TIE_EPSILON, TREND_MARGIN } from './ranking/ties.ts';
export { applyTrendExtrapolation, applyTrendTiebreak, meanTrend } from './ranking/trend.ts';
