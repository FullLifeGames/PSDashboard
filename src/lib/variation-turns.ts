import type { BranchHistoryEntry } from './branch-history';

// An entry is an interlude (a replacement between two turns) when it is `forced` or carries the `turnNumber` of the
// entry before it: the simulator wrote a replacement on BOTH sides as kind `turn`; reading the number covers that data.
export type TurnEntry = Pick<BranchHistoryEntry, 'kind' | 'turnNumber'>;

export function isInterlude(history: readonly Partial<TurnEntry>[], index: number): boolean {
  const entry = history[index];
  if (!entry) return false;
  if (entry.kind === 'forced') return true;
  const before = history[index - 1];
  return before !== undefined && typeof entry.turnNumber === 'number' && entry.turnNumber === before.turnNumber;
}

export function turnEntryCount(history: readonly Partial<TurnEntry>[]): number {
  let count = 0;
  for (let index = 0; index < history.length; index += 1) if (!isInterlude(history, index)) count += 1;
  return count;
}

export function turnEntryAt<T extends Partial<TurnEntry>>(history: readonly T[], turnIndex: number): T | null {
  let count = 0;
  for (let index = 0; index < history.length; index += 1) {
    if (isInterlude(history, index)) continue;
    if (count === turnIndex) return history[index];
    count += 1;
  }
  return null;
}

export function interludesAfter(history: readonly Partial<TurnEntry>[], index: number): number {
  let count = 0;
  while (isInterlude(history, index + count + 1)) count += 1;
  return count;
}

// Includes the interludes that settle the last turn, up to the next turn past the cut.
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

export function settledEntryAfterTurns<T extends Partial<TurnEntry>>(history: readonly T[], turns: number): T | null {
  if (turns <= 0 || turns > turnEntryCount(history)) return null;
  const kept = entriesOfTurns(history, turns);
  return kept[kept.length - 1] ?? null;
}
