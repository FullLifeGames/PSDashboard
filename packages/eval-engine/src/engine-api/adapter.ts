import type { EvalResult, RankedChoice } from '../types.ts';
import { rankFromMatrix, toResult } from '../ranking/order.ts';
import type { EngineOption, EngineRequest, EngineResponse } from './protocol.ts';

const labelled = (options: EngineOption[], ids: string[]) => {
  const byId = new Map(options.map(option => [option.id, option.label]));
  return ids.map(id => ({ choice: id, label: byId.get(id) ?? id }));
};

/** Without a matrix a value is its own floor and expectation; nobody is named as its punisher. */
function rankedFromValues(options: EngineOption[], values: Record<string, number>): RankedChoice[] {
  return options
    .map(option => ({
      choice: option.id, label: option.label,
      worstCase: values[option.id], expected: values[option.id], ev: values[option.id], punishedBy: null,
    }))
    .sort((a, b) => b.ev - a.ev);
}

/**
 * The dashboard's reading of a checked answer (validateEngineResponse first). With a matrix the game
 * is solved by the ranking the dashboard's own engine uses (rankFromMatrix, toResult): floors,
 * punishers, the equilibrium mixes and the score as the solved value. Without one the engine's score
 * and values stand as given.
 */
export function engineResponseToResult(request: EngineRequest, response: EngineResponse): EvalResult {
  if (response.matrix) {
    const { p1, p2, values } = response.matrix;
    const ranked = rankFromMatrix({
      p1Options: labelled(request.options.p1, p1),
      p2Options: labelled(request.options.p2, p2),
      values,
      ended: values.map(row => row.map(() => false)),
    }, response.score);
    return toResult(ranked, 1);
  }
  return {
    score: response.score,
    interval: 0,
    depthCompleted: 1,
    perSide: {
      p1: rankedFromValues(request.options.p1, response.values.p1),
      p2: rankedFromValues(request.options.p2, response.values.p2),
    },
  };
}
