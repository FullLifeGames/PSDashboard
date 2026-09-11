/**
 * Forced-switch assignments shared by the greedy resolver and the option
 * lists: every way to send distinct bench replacements into the forced
 * slots, as ready-to-send choice strings. With fewer replacements than
 * forced slots the remainder passes (the sim demands an explicit `pass`
 * per unfillable slot: "switch 3, pass").
 */
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
