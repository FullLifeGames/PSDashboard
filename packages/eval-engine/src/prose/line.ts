import { WAITING_LABEL } from '../forward/assignments.ts';

type Step = { p1: string; p2: string; replacement?: 'p1' | 'p2' | 'both' };

/** A replacement's label without the slot that passes: `→ A + pass` and `pass + → A` read `→ A`. */
export const replacementWords = (label: string): string => label.replace(/ \+ pass$/, '').replace(/^pass \+ /, '');

const stepText = (step: Step): string => {
  const labels = [step.p1, step.p2].filter(label => label !== WAITING_LABEL);
  return step.replacement ? `replaces: ${labels.map(replacementWords).join(' · ')}` : labels.join(' · ');
};

/** The line as text: a waiting side drops out, a replacement step reads "replaces: ...". */
export const formatLine = (line: Step[]): string =>
  line.map((step, index) => `${index === 0 ? '' : line[index - 1].replacement ? ', ' : ' → '}${stepText(step)}`).join('');
