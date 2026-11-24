const WAITING_LABEL = '(waiting)';

export const formatLine = (line: { p1: string; p2: string }[]): string =>
  line.map(step => [step.p1, step.p2].filter(label => label !== WAITING_LABEL).join(' · ')).join(' → ');
