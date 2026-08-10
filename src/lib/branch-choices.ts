import type { BranchMoveOption, BranchSwitchOption } from './branch-engine';
import { splitCombinedLabel } from './eval/analysis';

export interface BranchChoiceActive {
  fainted: boolean;
}

export type BranchMoveModifier = 'terastallize' | 'mega' | 'zmove' | 'ultra';

/**
 * Identity-based slot choice (B1): moves are stored by move id and switches by
 * species + nickname, never by grid/bench position. Position indices are only
 * produced at the sim boundary, resolved against the live request
 * (`resolveSideChoices` in branch-engine.ts). `modifier` carries
 * Tera/Mega/Z-Move/Ultra Burst intents (G7).
 */
export type BranchSlotChoice =
  | { kind: 'move'; moveId: string; moveName: string; targetLoc?: number; modifier?: BranchMoveModifier }
  | { kind: 'switch'; speciesId: string; pokemonName: string };

const MODIFIER_LABELS: Record<BranchMoveModifier, string> = {
  terastallize: 'Tera',
  mega: 'Mega',
  zmove: 'Z',
  ultra: 'Ultra',
};

export function choiceId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatTargetLoc(targetLoc: number): string {
  return targetLoc > 0 ? `+${targetLoc}` : `${targetLoc}`;
}

export function describeSlotChoice(choice: BranchSlotChoice | null | undefined): string {
  if (!choice) return '';
  if (choice.kind === 'switch') return `switch ${choice.pokemonName}`;
  const target = choice.targetLoc !== undefined ? ` ${formatTargetLoc(choice.targetLoc)}` : '';
  const modifier = choice.modifier ? ` (${MODIFIER_LABELS[choice.modifier]})` : '';
  return `move ${choice.moveName}${target}${modifier}`;
}

export function switchChoiceKey(choice: BranchSlotChoice | null | undefined): string | null {
  if (!choice || choice.kind !== 'switch') return null;
  return `${choice.speciesId}|${choiceId(choice.pokemonName)}`;
}

export function switchOptionKey(option: Pick<BranchSwitchOption, 'species' | 'name'>): string {
  return `${choiceId(option.species)}|${choiceId(option.name)}`;
}

export function requiredChoicesForActiveSlots(
  activeSlots: (BranchChoiceActive | null)[],
  forceSwitches: boolean[],
): boolean[] {
  if (forceSwitches.some(Boolean)) {
    return activeSlots.map((_, index) => forceSwitches[index] ?? false);
  }
  return activeSlots.map(active => !!active && !active.fainted);
}

export function conflictingSwitchTargets(
  choices: (BranchSlotChoice | null)[],
  requiredChoices: boolean[],
): string[] {
  const seen = new Set<string>();
  const conflicts = new Set<string>();

  choices.forEach((choice, index) => {
    if (!requiredChoices[index]) return;
    const target = switchChoiceKey(choice);
    if (target === null) return;
    if (seen.has(target)) conflicts.add(target);
    seen.add(target);
  });

  return [...conflicts].sort();
}

export function branchSideChoicesReady(
  choices: (BranchSlotChoice | null)[],
  requiredChoices: boolean[],
): boolean {
  return requiredChoices.every((required, index) => !required || !!choices[index]) &&
    conflictingSwitchTargets(choices, requiredChoices).length === 0;
}

export type ResolvedCustomChoice =
  | { ok: true; choice: BranchSlotChoice }
  | { ok: false; error: string };

function resolveCustomMove(
  nameOrSlot: string,
  targetRaw: string | undefined,
  moves: BranchMoveOption[],
): ResolvedCustomChoice {
  let move: BranchMoveOption | undefined;
  if (/^\d+$/.test(nameOrSlot)) {
    const slot = parseInt(nameOrSlot, 10);
    move = moves.find(candidate => candidate.slot === slot);
    if (!move) {
      return { ok: false, error: `No move in slot ${slot} — this Pokémon has ${moves.length} move${moves.length === 1 ? '' : 's'}.` };
    }
  } else {
    const id = choiceId(nameOrSlot);
    move = moves.find(candidate => choiceId(candidate.name) === id);
    if (!move) {
      return { ok: false, error: `"${nameOrSlot}" is not one of this Pokémon's moves.` };
    }
  }

  if (move.disabled) {
    return { ok: false, error: `${move.name} is disabled and can't be used right now.` };
  }

  const baseChoice = { kind: 'move' as const, moveId: choiceId(move.name), moveName: move.name };

  if (move.targetOptions.length > 0) {
    if (targetRaw !== undefined) {
      const targetLoc = parseInt(targetRaw, 10);
      const target = move.targetOptions.find(option => option.targetLoc === targetLoc);
      if (!target) {
        const valid = move.targetOptions
          .map(option => `${formatTargetLoc(option.targetLoc)} (${option.name})`)
          .join(', ');
        return { ok: false, error: `Invalid target "${targetRaw}" for ${move.name}. Valid targets: ${valid}.` };
      }
      return { ok: true, choice: { ...baseChoice, targetLoc } };
    }
    return { ok: true, choice: { ...baseChoice, targetLoc: move.targetOptions[0].targetLoc } };
  }

  return { ok: true, choice: baseChoice };
}

function resolveCustomSwitch(
  nameOrSlot: string,
  switches: BranchSwitchOption[],
): ResolvedCustomChoice {
  let target: BranchSwitchOption | undefined;
  if (/^\d+$/.test(nameOrSlot)) {
    const slot = parseInt(nameOrSlot, 10);
    target = switches.find(candidate => candidate.slot === slot);
    if (!target) {
      return { ok: false, error: `No Pokémon can switch in from slot ${slot}.` };
    }
  } else {
    const id = choiceId(nameOrSlot);
    target = switches.find(candidate => choiceId(candidate.name) === id || choiceId(candidate.species) === id);
    if (!target) {
      return { ok: false, error: `"${nameOrSlot}" is not available to switch in.` };
    }
  }
  return {
    ok: true,
    choice: { kind: 'switch', speciesId: choiceId(target.species), pokemonName: target.name },
  };
}

const EVAL_MODIFIERS = ['terastallize', 'mega', 'ultra'] as const;

/**
 * Maps an engine choice string (possibly a doubles combined choice like
 * "move bugbite 1 mega, switch 3") onto per-slot branch choices, validated
 * against each slot's live options. Null when any part fails to resolve —
 * a partial prefill would silently misrepresent the engine's line. A null
 * entry inside the array is a "pass" slot (nothing to choose there).
 *
 * Switch parts resolve by the label's species ("→ Muk-Alola") when the
 * label is provided — the engine's slot numbers index ITS battle's bench,
 * which is not guaranteed to share the branch reconstruction's order.
 */
export function evalChoiceToSlotChoices(
  evalChoice: string,
  movesBySlot: BranchMoveOption[][],
  switchesBySlot: BranchSwitchOption[][],
  label?: string,
): (BranchSlotChoice | null)[] | null {
  // Pivot pairs ("move uturn > switch 4"): the branch UI prefills the MOVE;
  // the sim raises the follow-up switch as its own prompt afterwards.
  const parts = evalChoice.split(' > ')[0].split(',').map(part => part.trim());
  const labelParts = label ? splitCombinedLabel(label) : [];
  const choices: (BranchSlotChoice | null)[] = [];
  for (let slot = 0; slot < parts.length; slot++) {
    const tokens = parts[slot].split(' ');
    if (tokens[0] === 'pass') {
      choices.push(null);
      continue;
    }
    if (tokens[0] === 'switch') {
      const species = labelParts[slot]?.startsWith('→ ') ? labelParts[slot].slice(2) : null;
      const resolved = resolveCustomSwitch(species ?? tokens[1], switchesBySlot[slot] ?? []);
      if (!resolved.ok) return null;
      choices.push(resolved.choice);
      continue;
    }
    if (tokens[0] !== 'move') return null;
    const modifier = EVAL_MODIFIERS.find(candidate => tokens.includes(candidate));
    const locToken = tokens.slice(2).find(token => /^-?\d+$/.test(token));
    const resolved = resolveCustomMove(tokens[1], locToken, movesBySlot[slot] ?? []);
    if (!resolved.ok || resolved.choice.kind !== 'move') return null;
    choices.push(modifier ? { ...resolved.choice, modifier } : resolved.choice);
  }
  return choices;
}

/**
 * Validates a free-text choice against the current request before it is ever
 * stored, so invalid input can never reach the simulator (B8).
 */
export function resolveCustomChoice(
  input: string,
  moves: BranchMoveOption[],
  switches: BranchSwitchOption[],
): ResolvedCustomChoice {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Enter a choice first.' };

  const switchMatch = trimmed.match(/^switch\s+(.+)$/i);
  if (switchMatch) return resolveCustomSwitch(switchMatch[1].trim(), switches);

  const moveMatch = trimmed.match(/^move\s+(.+?)(?:\s+([+-]?\d+))?$/i);
  if (moveMatch) return resolveCustomMove(moveMatch[1].trim(), moveMatch[2], moves);

  return {
    ok: false,
    error: 'Unrecognized choice. Supported: "move 2", "move thunderbolt", "move 2 +1", "switch 3", "switch pikachu".',
  };
}
