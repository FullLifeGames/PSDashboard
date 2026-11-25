import type { Side } from '@pkmn/sim';

/** The label a side that waits for the other's replacement reads; the sim's own choice string for it is `wait`. */
export const WAITING_LABEL = '(waiting)';

/** Every way to send distinct bench replacements into the forced slots; the sim wants a `pass` per unfillable slot. */
export function switchAssignments(forcedCount: number, benchSlots: number[]): string[] {
  if (forcedCount <= 1) return benchSlots.map(slot => `switch ${slot}`);
  if (benchSlots.length === 1) {
    return [`switch ${benchSlots[0]}, pass`, `pass, switch ${benchSlots[0]}`];
  }
  const assignments: string[] = [];
  for (const first of benchSlots) {
    for (const second of benchSlots) {
      if (first === second) continue;
      assignments.push(`switch ${first}, switch ${second}`);
    }
  }
  return assignments;
}

/** The label of a switch request's answer: `→ Name` per forced slot, `pass` for a slot no body fills. */
export function assignmentLabel(sideState: Side, choice: string): string {
  return choice.split(',').map(part => {
    const tokens = part.trim().split(' ');
    if (tokens[0] !== 'switch') return 'pass';
    return `→ ${sideState.pokemon[parseInt(tokens[1], 10) - 1].species.name}`;
  }).join(' + ');
}
