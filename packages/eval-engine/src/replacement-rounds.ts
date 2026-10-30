/**
 * Round 79 (T290): the replacement requests of a replay, read from the protocol alone. A request round is the set of fainted
 * slots that are open when the first replacement enters; a replacement that faints again (an entry hazard) opens the next round,
 * and a faint that no switch answers (the game's last body, a forfeit) closes with its block. The capture hook of the
 * reconstruction (`onReplacement`) is held to this read by test/replacement-capture-sweep.spec.ts. Pure, no sim imports.
 */
export interface ReplacementRound {
  /** The block's turn: the knockout turn. The replacement stands on the board of the next one. */
  turn: number;
  /** The block's n-th request round, from 0. */
  ordinal: number;
  /** The slot indexes the round refills, per side, in slot order. */
  slots: { p1: number[]; p2: number[] };
  /** The species the log sends in, per side, in log order. */
  species: { p1: string[]; p2: string[] };
}

export function replacementRounds(log: string): ReplacementRound[] {
  const rounds: ReplacementRound[] = [];
  let turn = 0;
  let ordinal = 0;
  let pending = new Set<string>();
  let filling: Set<string> | null = null;
  let current: ReplacementRound | null = null;
  for (const line of log.replace(/\r\n/g, '\n').split('\n')) {
    const turnLine = line.match(/^\|turn\|(\d+)/);
    if (turnLine) {
      turn = Number(turnLine[1]);
      ordinal = 0;
      pending = new Set();
      filling = null;
      current = null;
      continue;
    }
    const faint = line.match(/^\|faint\|(p[12])([a-d]):/);
    if (faint) {
      pending.add(`${faint[1]}${faint[2]}`);
      continue;
    }
    const entry = line.match(/^\|switch\|(p[12])([a-d]):[^|]*\|([^,|]+)/);
    if (!entry) continue;
    const slot = `${entry[1]}${entry[2]}`;
    if (!filling && pending.has(slot)) {
      filling = new Set(pending);
      pending = new Set();
      current = { turn, ordinal: ordinal++, slots: { p1: [], p2: [] }, species: { p1: [], p2: [] } };
      rounds.push(current);
    }
    if (filling?.has(slot) && current) {
      filling.delete(slot);
      const side = entry[1] as 'p1' | 'p2';
      current.slots[side].push(entry[2].charCodeAt(0) - 97);
      current.species[side].push(entry[3].trim());
      if (filling.size === 0) filling = null;
    }
  }
  for (const round of rounds) {
    round.slots.p1.sort((a, b) => a - b);
    round.slots.p2.sort((a, b) => a - b);
  }
  return rounds;
}
