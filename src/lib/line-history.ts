import type { EvalLine, LineChoice, SimPokemonInfo } from '@fulllifegames/eval-engine';
import type { BranchHistoryEntry } from './branch-history';


const WAITING = '—';

const choiceText = (choice: LineChoice | null): string => (choice && choice.choice !== 'wait' ? choice.label : WAITING);

const emptyRosters = () => ({
  p1Active: null, p1ActiveSlots: [] as (SimPokemonInfo | null)[], p2Active: null, p2ActiveSlots: [] as (SimPokemonInfo | null)[],
  p1Pokemon: [] as SimPokemonInfo[], p2Pokemon: [] as SimPokemonInfo[],
});

/** Entries of a line from `startTurn`: a turn step is a `turn` entry, a one-side replacement `forced`. */
// A both-sides replacement is a `turn` entry repeating the number before it, as the simulator records it.
export function lineHistory(line: EvalLine, startTurn: number): BranchHistoryEntry[] {
  const entries: BranchHistoryEntry[] = [];
  let nextTurn = startTurn;
  line.steps.forEach((step, index) => {
    const { replacement } = step;
    const single = replacement === 'p1' || replacement === 'p2' ? replacement : null;
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
