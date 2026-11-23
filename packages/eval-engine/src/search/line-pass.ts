import { cellKey } from '../rank.ts';
import type { EvalResult, EvalSettings, MctsTreeStats } from '../types.ts';
import { playedIndices } from '../verify-select.ts';
import { worstAnswer } from '../turn-analysis/worst-answer.ts';
import { backpropagate, selectAndExpand } from './descent.ts';
import type { ExpansionContext } from './expansion.ts';
import { LINE_MIN_VISITS, lineFrom, type Node } from './mcts-node.ts';

/**
 * The line pass: after a tree has its result, a host may ask for extra iterations (`EvalSettings.linePass`) that start at the cells
 * whose lines the card shows and descend by the same decoupled UCB below them, so the second turn of a line holds the visits it needs.
 * They run on existing cells and write only below the root: the root's arrays, its visit count and every statistic the result and the
 * merge read stay as the tree left them, so no score, rank or grade moves; only `rowLines` reads more visits.
 */

/** The largest quota a settings object may ask for (a sanity bound). */
export const LINE_PASS_MAX = 5_000;

/** The quota of a settings object: a whole number from 1 up, else none. */
export const linePassQuota = (settings: Pick<EvalSettings, 'linePass'>): number => {
  const asked = settings.linePass;
  return asked !== undefined && Number.isInteger(asked) && asked > 0 ? Math.min(asked, LINE_PASS_MAX) : 0;
};

const hasChoices = (node: Node): boolean => !node.ended && node.p1Options.length > 0 && node.p2Options.length > 0;

/** The index of a row by label, -1 when the tree holds no such row. */
const indexOfLabel = (options: { label: string }[], label: string | undefined): number => (label === undefined ? -1 : options.findIndex(option => option.label === label));

/**
 * The root cells the pass aims at: each side's wanted rows against the tree's own top three answers of the other side, the columns
 * `rowLines` reads. Only cells the tree already expanded; keys in ascending order, so the pass is deterministic.
 */
export function wantedCells(root: Node, result: EvalResult, settings: EvalSettings): number[] {
  const keys = new Set<number>();
  for (const side of ['p1', 'p2'] as const) {
    const other = side === 'p1' ? 'p2' : 'p1';
    const against = side === 'p1' ? root.p2Options : root.p1Options;
    const columns = result.perSide[other].slice(0, 3).map(row => indexOfLabel(against, row.label)).filter(column => column >= 0);
    for (const row of wantedRows(root, result, settings, side)) {
      for (const column of columns) {
        const key = side === 'p1' ? cellKey(row, column) : cellKey(column, row);
        if (root.children.has(key)) keys.add(key);
      }
    }
  }
  return [...keys].sort((a, b) => a - b);
}

/** The rows of one side the donors will ask a line for: the named rows (else the tree's best row) and the row the side played. */
function wantedRows(root: Node, result: EvalResult, settings: EvalSettings, side: 'p1' | 'p2'): number[] {
  // playedIndices reads the option lists of the first tree only
  const played = playedIndices([{ p1Options: root.p1Options, p2Options: root.p2Options } as MctsTreeStats], result, settings.keepPlayed);
  const own = side === 'p1' ? root.p1Options : root.p2Options;
  const named = settings.lineRows?.[side] ?? [result.perSide[side][0]?.label];
  const rows = named.map(label => indexOfLabel(own, label)).filter(row => row >= 0);
  if (played[side] !== undefined) rows.push(played[side]!);
  return rows;
}

/**
 * The cell of each wanted row against its worst answer (`worstAnswer` of the tree's own result), when the root holds it and `taken` does
 * not. Keys ascend.
 */
export function floorCells(root: Node, result: EvalResult, settings: EvalSettings, taken: readonly number[]): number[] {
  const keys = new Set<number>();
  for (const side of ['p1', 'p2'] as const) {
    const own = side === 'p1' ? root.p1Options : root.p2Options;
    const against = side === 'p1' ? root.p2Options : root.p1Options;
    for (const row of wantedRows(root, result, settings, side)) {
      const ranked = result.perSide[side].find(entry => entry.label === own[row].label);
      const answer = ranked ? worstAnswer(result, side, ranked) : null;
      const column = answer ? indexOfLabel(against, answer.label) : -1;
      if (column < 0) continue;
      const key = side === 'p1' ? cellKey(row, column) : cellKey(column, row);
      if (root.children.has(key) && !taken.includes(key)) keys.add(key);
    }
  }
  return [...keys].sort((a, b) => a - b);
}

/** Whether the line from a root cell already holds two turns: the graded turn and one after it. */
const reaches = (root: Node, key: number): boolean => lineFrom(root, key, LINE_MIN_VISITS).length >= 2;

/**
 * Up to `quota` iterations, each starting at the next wanted cell whose line is still short, round robin, until every wanted line
 * holds two turns or the quota is spent. `firstIteration` is the tree's own iteration count, so the expansions draw seeds the tree
 * did not use. Returns the iterations run; `shouldStop` is read before each iteration.
 */
export function linePass(
  root: Node, wanted: readonly number[], quota: number, ctx: ExpansionContext, seedOffset: number, firstIteration: number, shouldStop?: () => boolean,
): number {
  let pending = wanted.filter(key => {
    const child = root.children.get(key);
    return child !== undefined && hasChoices(child) && !reaches(root, key);
  });
  let used = 0;
  while (used < quota && pending.length > 0) {
    if (shouldStop?.()) break;
    const key = pending[used % pending.length];
    const { path, leaf } = selectAndExpand(root, firstIteration + used, seedOffset, ctx, undefined, root.children.get(key)!);
    backpropagate(path, leaf);
    used += 1;
    if (reaches(root, key)) pending = pending.filter(entry => entry !== key);
  }
  return used;
}

/**
 * The pass of a tree whose result is final: nothing when the settings ask for none, the search has no tree (a dead root) or it was stopped.
 */
export function passAfterResult(
  root: Node, result: EvalResult, settings: EvalSettings, ctx: ExpansionContext | undefined, seedOffset: number, iterations: number, shouldStop?: () => boolean,
): void {
  const quota = linePassQuota(settings);
  if (quota === 0 || !ctx || shouldStop?.()) return;
  const plain = wantedCells(root, result, settings);
  const used = linePass(root, plain, quota, ctx, seedOffset, iterations, shouldStop);
  // what the plain cells left of the quota goes to the floor cells; their seeds follow the plain pass's
  if (used < quota) linePass(root, floorCells(root, result, settings, plain), quota - used, ctx, seedOffset, iterations + used, shouldStop);
}
