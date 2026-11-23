/** The principal variation as one line of text: steps joined by " → ", each step "p1 · p2". */

/** The label of a side that cannot act at a forced-switch node (the waiting sentinel of forward/choices.ts; `pv-line.spec.ts`). */
const WAITING_LABEL = '(waiting)';

/** The principal variation as text; a step where one side waits reads as the other side's click alone. */
export const formatLine = (line: { p1: string; p2: string }[]): string =>
  line.map(step => [step.p1, step.p2].filter(label => label !== WAITING_LABEL).join(' · ')).join(' → ');
