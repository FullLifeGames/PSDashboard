import type { BranchHistoryEntry } from '../../../src/lib/branch-history';
import { pokemon } from './sim-state';

/**
 * Round 88 (T348, #84): two real variation histories of 1.1.0 and before, copied from the reporter's state file
 * (GitHub issue #4, gen9vgc2025regg-2335527677, `state-issue4.json`) and from the check of 07.11.2026 (`issue4c.txt`, the
 * same replay, a variation from turn 1 that the engine played out). The simulator wrote a replacement on BOTH sides as an
 * entry of kind `turn` that carries the `turnNumber` of the entry before it, a replacement on one side as kind `forced`.
 *
 * A row is [kind, turnNumber, forcedSide, p1Choice, p2Choice]. Every entry carries its own marker: the position
 * `pos-<index>`, `index` fainted bodies of 20 (the share the graph reads) and, for an entry that plays a turn, the move
 * `m<index>` in its slot choices (the dock's "played" record).
 */
type Row = [kind: 'turn' | 'forced', turnNumber: number, forcedSide: 'p1' | 'p2' | null, p1: string, p2: string];

const BODIES = 20;

export function interludeHistory(rows: Row[]): BranchHistoryEntry[] {
  return rows.map(([kind, turnNumber, forcedSide, p1Choice, p2Choice], index) => ({
    turnNumber, kind, ...(forcedSide ? { forcedSide } : {}), p1Choice, p2Choice,
    serializedPosition: `pos-${index}`,
    p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [],
    p1Pokemon: Array.from({ length: BODIES }, (_, body) => (
      body < index ? pokemon(`Mon${body}`, { fainted: true, hp: 0, hpPercent: 0 }) : pokemon(`Mon${body}`)
    )),
    p2Pokemon: [],
    ...(kind === 'forced' ? {} : {
      p1SlotChoices: [{ kind: 'move' as const, moveId: `m${index}`, moveName: `M${index}` }],
      p2SlotChoices: [{ kind: 'move' as const, moveId: `n${index}`, moveName: `N${index}` }],
    }),
  }));
}

/** The reporter's state file: start turn 1, 7 entries, 4 real turns; entries 2 and 4 are replacements on both sides. */
export const ISSUE4_STATE = {
  startTurn: 1,
  history: interludeHistory([
    ['turn', 1, null, 'move 2 +2, move 2', 'move 4 +1, move 2 +1'],
    ['turn', 2, null, 'move 2 +2, move 3 +1', 'move 1, move 1 +1'],
    ['turn', 2, null, 'switch 3, pass', 'pass, switch 3'],
    ['turn', 3, null, 'move 4 +1, move 3 +1', 'move 3 +2, move 1 +1'],
    ['turn', 3, null, 'switch 5, pass', 'switch 4, pass'],
    ['turn', 4, null, 'move 1 +2, move 3 +1', 'move 1 +1, move 2 +1'],
    ['forced', 4, 'p1', 'switch 4, pass', '—'],
  ]),
  /** Index of the entry that holds the position before each pointer turn (the last entry of the turns before it). */
  settledAt: { 2: 0, 3: 2, 4: 4, 5: 6 } as Record<number, number>,
  /** Index of the entry that plays each pointer turn (the dock's "played" record); the tip plays none yet. */
  playedAt: { 2: 1, 3: 3, 4: 5 } as Record<number, number>,
  interludes: [2, 4, 6],
  turns: 4,
};

/** The play-out of the check of 07.11.2026: start turn 1, 17 entries, 10 real turns; entry 4 replaces both sides. */
export const ISSUE4C_PLAYOUT = {
  startTurn: 1,
  history: interludeHistory([
    ['turn', 1, null, 'switch 3, move 3 +2', 'move 3 +1, move 2 +1'],
    ['turn', 2, null, 'move 4 +2, move 2', 'move 2 +1 terastallize, move 2 +2'],
    ['forced', 2, 'p1', 'switch 5, pass', '—'],
    ['turn', 3, null, 'move 1 +1, move 3 +1', 'move 2 +1, move 2 +2'],
    ['turn', 3, null, 'pass, switch 6', 'switch 4, pass'],
    ['turn', 4, null, 'move 1 +1, move 2 +1', 'switch 3, move 3'],
    ['forced', 4, 'p2', '—', 'switch 6, pass'],
    ['turn', 5, null, 'move 2 +2 terastallize, move 1 +1', 'move 1 +1, move 3'],
    ['forced', 5, 'p2', '—', 'pass, switch 3'],
    ['turn', 6, null, 'move 1 +2, move 1 +1', 'move 1 +1, move 3'],
    ['forced', 6, 'p2', '—', 'switch 5, pass'],
    ['turn', 7, null, 'move 1 +2, move 1 +2', 'move 3, move 2 +1'],
    ['forced', 7, 'p1', 'switch 4, pass', '—'],
    ['turn', 8, null, 'move 1 +2, move 1 +1', 'move 3, move 3'],
    ['forced', 8, 'p1', 'switch 3, pass', '—'],
    ['turn', 9, null, 'move 2 +2, move 2 +1', 'move 2, move 2 +2'],
    ['turn', 10, null, 'move 2 +1, move 1 +1', 'move 2, pass'],
  ]),
  settledAt: { 2: 0, 3: 2, 4: 4, 5: 6, 6: 8, 7: 10, 8: 12, 9: 14, 10: 15, 11: 16 } as Record<number, number>,
  playedAt: { 2: 1, 3: 3, 4: 5, 5: 7, 6: 9, 7: 11, 8: 13, 9: 15, 10: 16 } as Record<number, number>,
  interludes: [2, 4, 6, 8, 10, 12, 14],
  turns: 10,
};

/** A singles game with a double knockout in turn 3 (both sides replace, one slot each), from turn 2. */
export const SINGLES_DOUBLE_KNOCKOUT = {
  startTurn: 2,
  history: interludeHistory([
    ['turn', 2, null, 'move 1', 'move 2'],
    ['turn', 3, null, 'move 1', 'move 1'],
    ['turn', 3, null, 'switch 3', 'switch 2'],
    ['turn', 4, null, 'move 2', 'move 1'],
    ['forced', 4, 'p2', '—', 'switch 3'],
    ['turn', 5, null, 'move 1', 'move 1'],
  ]),
  settledAt: { 3: 0, 4: 2, 5: 4, 6: 5 } as Record<number, number>,
  playedAt: { 3: 1, 4: 3, 5: 5 } as Record<number, number>,
  interludes: [2, 4],
  turns: 4,
};

export const INTERLUDE_CASES = [
  { name: 'the reporter\'s state file (issue #4, doubles)', ...ISSUE4_STATE },
  { name: 'the play-out of the check of 07.11.2026 (doubles)', ...ISSUE4C_PLAYOUT },
  { name: 'a singles double knockout', ...SINGLES_DOUBLE_KNOCKOUT },
];
