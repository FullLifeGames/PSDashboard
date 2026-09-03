import type { BranchMoveOption, BranchSwitchOption } from './branch-engine.ts';
import { splitCombinedLabel } from './analysis.ts';
import { toId } from '@fulllifegames/replay-core';

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

/**
 * Notation form of a slot choice: the move NAME the user clicked, or
 * "→ Pokémon" for a switch — never the raw sim command ("move 1",
 * "switch 2") the history stores for replaying.
 */
export function notationSlotChoice(choice: BranchSlotChoice | null | undefined): string {
  if (!choice) return '';
  if (choice.kind === 'switch') return `→ ${choice.pokemonName}`;
  const target = choice.targetLoc !== undefined ? ` ${formatTargetLoc(choice.targetLoc)}` : '';
  const modifier = choice.modifier ? ` (${MODIFIER_LABELS[choice.modifier]})` : '';
  return `${choice.moveName}${target}${modifier}`;
}

/** One side's notation for a history entry — slots joined, raw fallback. */
export function notationSideLabel(
  slotChoices: (BranchSlotChoice | null)[] | undefined,
  rawCommand: string,
): string {
  const parts = (slotChoices ?? []).filter(Boolean).map(choice => notationSlotChoice(choice));
  return parts.length > 0 ? parts.join(' + ') : rawCommand;
}

export function switchChoiceKey(choice: BranchSlotChoice | null | undefined): string | null {
  if (!choice || choice.kind !== 'switch') return null;
  return `${choice.speciesId}|${toId(choice.pokemonName)}`;
}

export function switchOptionKey(option: Pick<BranchSwitchOption, 'species' | 'name'>): string {
  return `${toId(option.species)}|${toId(option.name)}`;
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
      return { ok: false, error: `No move in slot ${slot}: this Pokémon has ${moves.length} move${moves.length === 1 ? '' : 's'}.` };
    }
  } else {
    const id = toId(nameOrSlot);
    move = moves.find(candidate => toId(candidate.name) === id);
    if (!move) {
      return { ok: false, error: `"${nameOrSlot}" is not one of this Pokémon's moves.` };
    }
  }

  if (move.disabled) {
    return { ok: false, error: `${move.name} is disabled and can't be used right now.` };
  }

  const baseChoice = { kind: 'move' as const, moveId: toId(move.name), moveName: move.name };

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
    const id = toId(nameOrSlot);
    target = switches.find(candidate => toId(candidate.name) === id || toId(candidate.species) === id);
    if (!target) {
      return { ok: false, error: `"${nameOrSlot}" is not available to switch in.` };
    }
  }
  return {
    ok: true,
    choice: { kind: 'switch', speciesId: toId(target.species), pokemonName: target.name },
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
 *
 * `actionableSlots` aligns parts with slots: the engine emits one part per
 * slot WITH choices and skips slots the sim auto-passes, so a doubles
 * forced replacement arrives as a single part that belongs to the FORCED
 * slot, not slot 0 (the VGC play-out wedge: the pick landed on the wrong
 * slot, reserved the species there, and locked the only legal button).
 * With the mask, parts map onto the slots that expect a choice; a
 * full-width string (explicit `pass` per slot) still maps positionally,
 * and any other count mismatch refuses rather than guessing a slot.
 */
/** Maps choice parts onto slots: by the actionable mask, positionally, or not at all. */
function partSlotMapping(
  partCount: number, actionableSlots: boolean[] | undefined,
): { slotFor: (part: number) => number; width: number } | null {
  if (!actionableSlots) return { slotFor: part => part, width: partCount };
  const actionable = actionableSlots.flatMap((expects, index) => (expects ? [index] : []));
  if (actionable.length === partCount) {
    return { slotFor: part => actionable[part], width: actionableSlots.length };
  }
  if (partCount === actionableSlots.length) {
    return { slotFor: part => part, width: actionableSlots.length };
  }
  return null;
}

/** One part's slot choice; a pass keeps the slot empty, an unresolvable part refuses. */
function resolvePartChoice(
  tokens: string[], labelPart: string | undefined, moves: BranchMoveOption[], switches: BranchSwitchOption[],
): { ok: true; choice: BranchSlotChoice | null } | { ok: false } {
  if (tokens[0] === 'pass') return { ok: true, choice: null };
  if (tokens[0] === 'switch') {
    const species = labelPart?.startsWith('→ ') ? labelPart.slice(2) : null;
    const resolved = resolveCustomSwitch(species ?? tokens[1], switches);
    return resolved.ok ? { ok: true, choice: resolved.choice } : { ok: false };
  }
  if (tokens[0] !== 'move') return { ok: false };
  const modifier = EVAL_MODIFIERS.find(candidate => tokens.includes(candidate));
  const locToken = tokens.slice(2).find(token => /^-?\d+$/.test(token));
  const resolved = resolveCustomMove(tokens[1], locToken, moves);
  if (!resolved.ok || resolved.choice.kind !== 'move') return { ok: false };
  return { ok: true, choice: modifier ? { ...resolved.choice, modifier } : resolved.choice };
}

export function evalChoiceToSlotChoices(
  evalChoice: string,
  movesBySlot: BranchMoveOption[][],
  switchesBySlot: BranchSwitchOption[][],
  label?: string,
  actionableSlots?: boolean[],
): (BranchSlotChoice | null)[] | null {
  // Pivot pairs ("move uturn > switch 4"): the branch UI prefills the MOVE;
  // the sim raises the follow-up switch as its own prompt afterwards.
  const parts = evalChoice.split(' > ')[0].split(',').map(part => part.trim());
  const labelParts = label ? splitCombinedLabel(label) : [];
  const mapping = partSlotMapping(parts.length, actionableSlots);
  if (!mapping) return null;
  const choices: (BranchSlotChoice | null)[] = new Array<BranchSlotChoice | null>(mapping.width).fill(null);
  for (let part = 0; part < parts.length; part++) {
    const slot = mapping.slotFor(part);
    const tokens = parts[part].split(' ');
    const resolved = resolvePartChoice(tokens, labelParts[part], movesBySlot[slot] ?? [], switchesBySlot[slot] ?? []);
    if (!resolved.ok) return null;
    if (resolved.choice) choices[slot] = resolved.choice;
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
