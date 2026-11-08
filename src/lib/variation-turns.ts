import type { BranchHistoryEntry } from './branch-history';

/**
 * Round 88 (T348, #84): the one rule that says which entries of a variation's history make a turn. Every reader of the
 * history (the span and the slider, the dock's position and its played record, the rebuild, the history rows, the graph,
 * the labels and the play-out's counter) imports it, so every entry names the same turn everywhere.
 *
 * An entry is an interlude, a replacement between two turns, when it is of kind `forced` (one side replaces) or when it
 * carries the `turnNumber` of the entry before it. A turn always advances the battle's turn, a replacement does not, and
 * the simulator wrote a replacement on BOTH sides as an entry of kind `turn` (state files of 1.0.2 and 1.1.0, saved
 * branches, share links). Reading the number covers that data without a new version of the file or the link.
 */
export type TurnEntry = Pick<BranchHistoryEntry, 'kind' | 'turnNumber'>;

/** True when the entry at `index` is a replacement between two turns and makes no turn of its own. */
export function isInterlude(history: readonly Partial<TurnEntry>[], index: number): boolean {
  const entry = history[index];
  if (!entry) return false;
  if (entry.kind === 'forced') return true;
  const before = history[index - 1];
  return before !== undefined && typeof entry.turnNumber === 'number' && entry.turnNumber === before.turnNumber;
}

/** How many entries make a turn: the variation's length in turns. */
export function turnEntryCount(history: readonly Partial<TurnEntry>[]): number {
  let count = 0;
  for (let index = 0; index < history.length; index += 1) if (!isInterlude(history, index)) count += 1;
  return count;
}

/** The entry that plays the turn with this 0-based number among the turns of the history, or null past the last one. */
export function turnEntryAt<T extends Partial<TurnEntry>>(history: readonly T[], turnIndex: number): T | null {
  let count = 0;
  for (let index = 0; index < history.length; index += 1) {
    if (isInterlude(history, index)) continue;
    if (count === turnIndex) return history[index];
    count += 1;
  }
  return null;
}

/** How many interludes follow the entry at `index` before the next turn: they finish that turn. */
export function interludesAfter(history: readonly Partial<TurnEntry>[], index: number): number {
  let count = 0;
  while (isInterlude(history, index + count + 1)) count += 1;
  return count;
}

/**
 * The entries of the first `turns` turns with the interludes that settle them: the history up to the next turn past the
 * cut. A branch from an inner turn keeps these, and the position before turn `turns + 1` is the last of them.
 */
export function entriesOfTurns<T extends Partial<TurnEntry>>(history: readonly T[], turns: number): T[] {
  const kept: T[] = [];
  let remaining = turns;
  for (let index = 0; index < history.length; index += 1) {
    if (!isInterlude(history, index)) {
      if (remaining === 0) break;
      remaining -= 1;
    }
    kept.push(history[index]);
  }
  return kept;
}

/**
 * The entry that holds the position before the pointer turn `startTurn + turns`: the last entry of the first `turns`
 * turns. Null for no turns, and for a history shorter than that.
 */
export function settledEntryAfterTurns<T extends Partial<TurnEntry>>(history: readonly T[], turns: number): T | null {
  if (turns <= 0 || turns > turnEntryCount(history)) return null;
  const kept = entriesOfTurns(history, turns);
  return kept[kept.length - 1] ?? null;
}
