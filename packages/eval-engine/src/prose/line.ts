/**
 * The principal variation as one line of text, shared by the turn summary
 * and the panel rows: steps joined by " → ", each step "p1 · p2".
 */

/**
 * The label the engine gives a side that cannot act at a forced-switch
 * node (forward/choices.ts, the waiting sentinel; pv-line.spec.ts checks it
 * against a real waiting position).
 */
const WAITING_LABEL = '(waiting)';

/**
 * Round 63 (T18): a step where one side waits reads as the other side's
 * click alone ("→ Keldeo"), so no shown main line carries the placeholder.
 */
export const formatLine = (line: { p1: string; p2: string }[]): string =>
  line.map(step => [step.p1, step.p2].filter(label => label !== WAITING_LABEL).join(' · ')).join(' → ');
