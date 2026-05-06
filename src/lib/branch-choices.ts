export interface BranchChoiceActive {
  fainted: boolean;
}

const SWITCH_CHOICE_RE = /^switch\s+(\d+)$/i;

export function requiredChoicesForActiveSlots(
  activeSlots: (BranchChoiceActive | null)[],
  forceSwitches: boolean[],
): boolean[] {
  if (forceSwitches.some(Boolean)) {
    return activeSlots.map((_, index) => forceSwitches[index] ?? false);
  }
  return activeSlots.map(active => !!active && !active.fainted);
}

export function switchTarget(choice: string | null | undefined): number | null {
  const match = choice?.trim().match(SWITCH_CHOICE_RE);
  return match ? parseInt(match[1], 10) : null;
}

export function conflictingSwitchTargets(
  choices: (string | null)[],
  requiredChoices: boolean[],
): number[] {
  const seen = new Set<number>();
  const conflicts = new Set<number>();

  choices.forEach((choice, index) => {
    if (!requiredChoices[index]) return;
    const target = switchTarget(choice);
    if (target === null) return;
    if (seen.has(target)) conflicts.add(target);
    seen.add(target);
  });

  return [...conflicts].sort((a, b) => a - b);
}

export function branchSideChoicesReady(
  choices: (string | null)[],
  requiredChoices: boolean[],
): boolean {
  return requiredChoices.every((required, index) => !required || !!choices[index]) &&
    conflictingSwitchTargets(choices, requiredChoices).length === 0;
}

export function buildBranchSideCommand(
  choices: (string | null)[],
  requiredChoices: boolean[],
): string {
  return requiredChoices
    .map((required, index) => required ? choices[index] || 'pass' : 'pass')
    .join(', ');
}
