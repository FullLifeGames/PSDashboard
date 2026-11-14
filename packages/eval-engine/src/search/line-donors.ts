import type { EvalResult, EvalSettings, LineRequest, MctsTreeStats, TreeLineStep } from '../types.ts';
import { playedIndices } from '../verify-select.ts';

/**
 * Round 89 (#104): which lines of a search get replayed, and from which trees. Sim-free (the orchestrator reads it): the replay runs
 * in the executor (search/lines.ts).
 *
 * A turn shows each side's best row and the row the side played (one line when they are the row). Every tree ships the line of every
 * row it has one for, against its own best row of the other side (mcts-node.ts `rowLines`). The donors of a row are the trees that
 * hold its line, the ones whose first step answers with the merged result's best row of the other side first (the opponent answers
 * with its top choice), then by the visits of the first step. The replay takes the first donor whose line survives the likeliest
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
  const reply = result.perSide[side === 'p1' ? 'p2' : 'p1'][0]?.label;
  const options = side === 'p1' ? trees[0].p1Options : trees[0].p2Options;
  const wanted = new Map<string, LineRequest['for']>();
  // a host that graded the turn with another search names the rows it graded against (settings.lineRows)
  for (const label of settings.lineRows?.[side] ?? (top === undefined ? [] : [top])) wanted.set(label, ['engine']);
  const playedLabel = playedIndex === undefined ? undefined : options[playedIndex]?.label;
  if (playedLabel !== undefined) wanted.set(playedLabel, [...(wanted.get(playedLabel) ?? []), 'played']);
  return [...wanted].flatMap(([label, roles]) => {
    const donors = donorsOf(trees, side, label, reply);
    return donors.length > 0 ? [{ side, label, for: roles, donors, visits: donors[0][0].visits }] : [];
  });
}

/** The lines the trees hold for one row, best donor first: the reply the opponent's best row names first, then the heavier first step, then the lower tree. */
function donorsOf(trees: readonly MctsTreeStats[], side: 'p1' | 'p2', label: string, reply: string | undefined): TreeLineStep[][] {
  const held = trees.flatMap((tree, index) => {
    const line = tree.rowLines?.[side][label];
    return line && line.length > 0 ? [{ line, index }] : [];
  });
  const answers = (line: TreeLineStep[]): boolean => (side === 'p1' ? line[0].p2 : line[0].p1) === reply;
  return held
    .sort((a, b) => Number(answers(b.line)) - Number(answers(a.line)) || b.line[0].visits - a.line[0].visits || a.index - b.index)
    .map(entry => entry.line);
}
