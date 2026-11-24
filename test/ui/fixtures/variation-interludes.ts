import type { BranchHistoryEntry } from '../../../src/lib/branch-history';
import { pokemon } from './sim-state';

// The simulator writes a replacement on BOTH sides as kind `turn` with the `turnNumber` of the entry before it.
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
  { name: 'the reporter\'s state file (doubles)', ...ISSUE4_STATE },
  { name: 'a play-out with an interlude after seven of its turns (doubles)', ...ISSUE4C_PLAYOUT },
  { name: 'a singles double knockout', ...SINGLES_DOUBLE_KNOCKOUT },
];
