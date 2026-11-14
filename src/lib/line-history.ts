import type { EvalLine, LineChoice, SimPokemonInfo } from '@fulllifegames/eval-engine';
import type { BranchHistoryEntry } from './branch-history';

/**
 * Round 89 (#104), step G3: a line as the history of a variation. Each step becomes the entry the branch records for it, so the
 * rebuild that restores a saved variation (`useRestoreVariation`) plays it: the slot choices resolve by identity on the rebuilt
 * battle and the dice ride on the slot of their holder (round 82), so the click forces exactly the dice the line names.
 *
 * - A turn step is an entry of kind `turn`; its number is the battle's turn at that point (`startTurn`, then one more per turn).
 * - A replacement of one side is an entry of kind `forced` with that side; it finishes the turn before it and keeps that number.
 * - A replacement of both sides is an entry of kind `turn` with the number of the entry before it, as the simulator records it
 *   (`isInterlude` reads the repeated number).
 * The recorded position, the rosters and the commands are the rebuild's to fill: it replays from the slot choices alone.
 */

const WAITING = '—';

const choiceText = (choice: LineChoice | null): string => (choice && choice.choice !== 'wait' ? choice.label : WAITING);

const emptyRosters = () => ({
  p1Active: null, p1ActiveSlots: [] as (SimPokemonInfo | null)[], p2Active: null, p2ActiveSlots: [] as (SimPokemonInfo | null)[],
  p1Pokemon: [] as SimPokemonInfo[], p2Pokemon: [] as SimPokemonInfo[],
});

/** The entries of a line played from the start of `startTurn`. */
export function lineHistory(line: EvalLine, startTurn: number): BranchHistoryEntry[] {
  const entries: BranchHistoryEntry[] = [];
  let nextTurn = startTurn;
  line.steps.forEach((step, index) => {
    const { replacement } = step;
    const single = replacement === 'p1' || replacement === 'p2' ? replacement : null;
    // a replacement after the line's first step finishes that step's turn; one that opens the line stands at the start turn
    const finishes = replacement !== undefined && index > 0;
    const turnNumber = finishes ? entries[index - 1].turnNumber : nextTurn++;
    entries.push({
      turnNumber,
      kind: single ? 'forced' : 'turn',
      ...(single ? { forcedSide: single } : {}),
      ...(single !== 'p2' ? { p1SlotChoices: step.p1.slots } : {}),
      ...(single !== 'p1' ? { p2SlotChoices: step.p2.slots } : {}),
      p1Choice: single === 'p2' ? WAITING : choiceText(step.p1),
      p2Choice: single === 'p1' ? WAITING : choiceText(step.p2),
      ...emptyRosters(),
    });
  });
  return entries;
}
