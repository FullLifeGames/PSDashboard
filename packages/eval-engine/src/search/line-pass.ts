import { cellKey } from '../rank.ts';
import type { EvalResult, EvalSettings, MctsTreeStats } from '../types.ts';
import { playedIndices } from '../verify-select.ts';
import { worstAnswer } from '../turn-analysis/worst-answer.ts';
import { backpropagate, selectAndExpand } from './descent.ts';
import type { ExpansionContext } from './expansion.ts';
import { LINE_MIN_VISITS, lineFrom, type Node } from './mcts-node.ts';

// The pass writes only below the root, so no score, rank or grade moves; only `rowLines` reads more visits.

export const LINE_PASS_MAX = 5_000;

/** The quota of a settings object: a whole number from 1 up, else none. */
export const linePassQuota = (settings: Pick<EvalSettings, 'linePass'>): number => {
  const asked = settings.linePass;
  return asked !== undefined && Number.isInteger(asked) && asked > 0 ? Math.min(asked, LINE_PASS_MAX) : 0;
};

const hasChoices = (node: Node): boolean => !node.ended && node.p1Options.length > 0 && node.p2Options.length > 0;

const indexOfLabel = (options: { label: string }[], label: string | undefined): number => (label === undefined ? -1 : options.findIndex(option => option.label === label));

/** The root cells the pass aims at: wanted rows against the tree's top three answers, expanded only, keys ascending. */
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

function wantedRows(root: Node, result: EvalResult, settings: EvalSettings, side: 'p1' | 'p2'): number[] {
  // playedIndices reads the option lists of the first tree only
  const played = playedIndices([{ p1Options: root.p1Options, p2Options: root.p2Options } as MctsTreeStats], result, settings.keepPlayed);
  const own = side === 'p1' ? root.p1Options : root.p2Options;
  const named = settings.lineRows?.[side] ?? [result.perSide[side][0]?.label];
  const rows = named.map(label => indexOfLabel(own, label)).filter(row => row >= 0);
  if (played[side] !== undefined) rows.push(played[side]!);
  return rows;
}

/** The cell of each wanted row against its worst answer, when the root holds it and `taken` does not; keys ascend. */
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

const reaches = (root: Node, key: number): boolean => lineFrom(root, key, LINE_MIN_VISITS).length >= 2;

// `firstIteration` is the tree's iteration count, so the expansions draw seeds the tree did not use.
/** Up to `quota` round-robin iterations on wanted cells with a short line; returns the iterations run. */
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

/** The pass of a tree whose result is final: nothing when none is asked, the root is dead or the search was stopped. */
export function passAfterResult(
  root: Node, result: EvalResult, settings: EvalSettings, ctx: ExpansionContext | undefined, seedOffset: number, iterations: number, shouldStop?: () => boolean,
): void {
  const quota = linePassQuota(settings);
  if (quota === 0 || !ctx || shouldStop?.()) return;
  const plain = wantedCells(root, result, settings);
  const used = linePass(root, plain, quota, ctx, seedOffset, iterations, shouldStop);
  if (used < quota) linePass(root, floorCells(root, result, settings, plain), quota - used, ctx, seedOffset, iterations + used, shouldStop);
}
