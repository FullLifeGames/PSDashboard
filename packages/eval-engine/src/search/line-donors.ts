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
  const requests: LineRequest[] = [];
  for (const side of ['p1', 'p2'] as const) {
    const other = side === 'p1' ? 'p2' : 'p1';
    const top = result.perSide[side][0]?.label;
    const reply = result.perSide[other][0]?.label;
    const options = side === 'p1' ? trees[0].p1Options : trees[0].p2Options;
    const playedLabel = played[side] === undefined ? undefined : options[played[side]!]?.label;
    const wanted = new Map<string, LineRequest['for']>();
    if (top !== undefined) wanted.set(top, ['engine']);
    if (playedLabel !== undefined) wanted.set(playedLabel, [...(wanted.get(playedLabel) ?? []), 'played']);
    for (const [label, roles] of wanted) {
      const donors = donorsOf(trees, side, label, reply);
      if (donors.length > 0) requests.push({ side, label, for: roles, donors, visits: donors[0][0].visits });
    }
  }
  return requests;
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
