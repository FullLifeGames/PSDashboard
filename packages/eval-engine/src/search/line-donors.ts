import type { EvalResult, EvalSettings, LineRequest, MctsTreeStats, TreeLineStep } from '../types.ts';
import { playedIndices } from '../verify-select.ts';
import { worstAnswer } from '../turn-analysis/worst-answer.ts';

/** Which lines of a search get replayed and from which trees; sim-free, the replay runs in search/lines.ts. */
export function lineRequests(trees: readonly MctsTreeStats[], result: EvalResult, settings: EvalSettings): LineRequest[] {
  if (trees.length === 0 || !trees.some(tree => tree.rowLines)) return [];
  const played = playedIndices([...trees], result, settings.keepPlayed);
  return (['p1', 'p2'] as const).flatMap(side => requestsOf(trees, result, settings, side, played[side]));
}

function requestsOf(trees: readonly MctsTreeStats[], result: EvalResult, settings: EvalSettings, side: 'p1' | 'p2', playedIndex: number | undefined): LineRequest[] {
  const top = result.perSide[side][0]?.label;
  const ranking = [...(settings.lineReplies?.[side] ?? []), ...result.perSide[side === 'p1' ? 'p2' : 'p1'].map(row => row.label)];
  const options = side === 'p1' ? trees[0].p1Options : trees[0].p2Options;
  const wanted = new Map<string, LineRequest['for']>();
  for (const label of settings.lineRows?.[side] ?? (top === undefined ? [] : [top])) wanted.set(label, ['engine']);
  const playedLabel = playedIndex === undefined ? undefined : options[playedIndex]?.label;
  if (playedLabel !== undefined) wanted.set(playedLabel, [...(wanted.get(playedLabel) ?? []), 'played']);
  return [...wanted].flatMap(([label, roles]) => {
    const donors = donorsOf(trees, side, label, ranking);
    if (donors.length === 0) return [];
    const usual: LineRequest = { side, label, for: roles, donors, visits: donors[0][0].visits };
    const worst = worstRequest(trees, result, side, label, roles, donors[0][0]);
    return worst ? [usual, worst] : [usual];
  });
}

function worstRequest(trees: readonly MctsTreeStats[], result: EvalResult, side: 'p1' | 'p2', label: string, roles: LineRequest['for'], usualFirst: TreeLineStep): LineRequest | null {
  const row = result.perSide[side].find(entry => entry.label === label);
  const answer = row ? worstAnswer(result, side, row)?.label : undefined;
  const answered = (step: TreeLineStep): string => (side === 'p1' ? step.p2 : step.p1);
  if (answer === undefined || answered(usualFirst) === answer) return null;
  const held = trees.flatMap((tree, index) => [...(tree.rowLines?.[side][label] ?? []), ...(tree.rowLines?.floor?.[side][label] ? [tree.rowLines.floor[side][label]] : [])]
    .flatMap((line, order) => (line.length > 0 && answered(line[0]) === answer ? [{ line, index, order }] : [])));
  if (held.length === 0) return null;
  const donors = held.sort((a, b) => b.line[0].visits - a.line[0].visits || a.index - b.index || a.order - b.order).map(entry => entry.line);
  return { side, label, for: roles, donors, visits: donors[0][0].visits, versus: 'worst' };
}

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
