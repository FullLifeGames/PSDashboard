import type { EvalResult, EvalSettings, LineRequest, MctsTreeStats, TreeLineStep } from '../types.ts';
import { playedIndices } from '../verify-select.ts';

/**
 * Round 89 (#104): which lines of a search get replayed, and from which trees. Sim-free (the orchestrator reads it): the replay runs
 * in the executor (search/lines.ts).
 *
 * A turn shows each side's best row and the row the side played (one line when they are the row). Every tree ships the line of every
 * row it has one for, against its own top three rows of the other side (mcts-node.ts `rowLines`). The donors of a row are the lines the
 * trees hold for it, the ones whose first step answers with the best row of the other side by the merged ranking first (the opponent
 * answers with its best choice overall), then by the visits of the first step. The replay takes the first donor whose line survives the likeliest
 * dice and the next one otherwise.
 */
export function lineRequests(trees: readonly MctsTreeStats[], result: EvalResult, settings: EvalSettings): LineRequest[] {
  if (trees.length === 0 || !trees.some(tree => tree.rowLines)) return [];
  const played = playedIndices([...trees], result, settings.keepPlayed);
  return (['p1', 'p2'] as const).flatMap(side => requestsOf(trees, result, settings, side, played[side]));
}

/** One side's requests: the rows it wants the engine's line for, and the row it played, in that order. */
function requestsOf(trees: readonly MctsTreeStats[], result: EvalResult, settings: EvalSettings, side: 'p1' | 'p2', playedIndex: number | undefined): LineRequest[] {
  const top = result.perSide[side][0]?.label;
  // the answers a host's card ranks first lead the search's own ranking (settings.lineReplies)
  const ranking = [...(settings.lineReplies?.[side] ?? []), ...result.perSide[side === 'p1' ? 'p2' : 'p1'].map(row => row.label)];
  const options = side === 'p1' ? trees[0].p1Options : trees[0].p2Options;
  const wanted = new Map<string, LineRequest['for']>();
  // a host that graded the turn with another search names the rows it graded against (settings.lineRows)
  for (const label of settings.lineRows?.[side] ?? (top === undefined ? [] : [top])) wanted.set(label, ['engine']);
  const playedLabel = playedIndex === undefined ? undefined : options[playedIndex]?.label;
  if (playedLabel !== undefined) wanted.set(playedLabel, [...(wanted.get(playedLabel) ?? []), 'played']);
  return [...wanted].flatMap(([label, roles]) => {
    const donors = donorsOf(trees, side, label, ranking);
    return donors.length > 0 ? [{ side, label, for: roles, donors, visits: donors[0][0].visits }] : [];
  });
}

/**
 * The lines the trees hold for one row, best donor first: the answer the merged ranking puts first (an answer the ranking does not hold
 * comes last), then the heavier first step, then the lower tree, then the order the tree kept its lines in.
 */
function donorsOf(trees: readonly MctsTreeStats[], side: 'p1' | 'p2', label: string, ranking: readonly string[]): TreeLineStep[][] {
  const held = trees.flatMap((tree, index) => (tree.rowLines?.[side][label] ?? []).flatMap((line, order) => (line.length > 0 ? [{ line, index, order }] : [])));
  const rank = (line: TreeLineStep[]): number => {
    const at = ranking.indexOf(side === 'p1' ? line[0].p2 : line[0].p1);
    return at < 0 ? Number.POSITIVE_INFINITY : at;
  };
  return held
    .sort((a, b) => rank(a.line) - rank(b.line) || b.line[0].visits - a.line[0].visits || a.index - b.index || a.order - b.order)
    .map(entry => entry.line);
}
