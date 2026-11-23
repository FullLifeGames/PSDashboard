import type { BranchMoveOption, BranchSwitchOption } from './branch-engine.ts';
import { splitCombinedLabel } from './analysis.ts';
import { toId } from '@fulllifegames/replay-core';
import { dieLabel, type DieWords } from './dice/die-label.ts';
import { isCommanding } from './forward/request-moves.ts';
import type { ForcedDie } from './dice/types.ts';

/** The facts of one active body that decide whether its slot is asked for a choice. */
export interface BranchChoiceActive {
  fainted: boolean;
  /** A Tatsugiri inside its Dondozo; the simulator passes its slot, so it is asked nothing. */
  commanding?: boolean;
}

/** The facts `requiredChoicesForActiveSlots` reads, from a simulator body (the live battle's actives). */
export function branchChoiceActive(pokemon: { fainted: boolean; volatiles: Record<string, unknown> } | null | undefined): BranchChoiceActive | null {
  return pokemon ? { fainted: pokemon.fainted, commanding: isCommanding(pokemon) } : null;
}

/** The Tera, Mega, Z-Move and Ultra Burst intents of a move choice. */
export type BranchMoveModifier = 'terastallize' | 'mega' | 'zmove' | 'ultra';

/** One slot's choice by identity (a move by id, a switch by species and nickname), never by position; `dice` are the dice forced in this choice's turn, each named by its body (`name.slot`), optional and JSON-clean. */
export type BranchSlotChoice =
  | { kind: 'move'; moveId: string; moveName: string; targetLoc?: number; modifier?: BranchMoveModifier; dice?: ForcedDie[] }
  | { kind: 'switch'; speciesId: string; pokemonName: string; dice?: ForcedDie[] };

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

/** The notation of a slot choice: the move name clicked, or "→ Pokémon" for a switch, never the raw sim command the history stores. */
export function notationSlotChoice(choice: BranchSlotChoice | null | undefined): string {
  if (!choice) return '';
  if (choice.kind === 'switch') return `→ ${choice.pokemonName}`;
  const target = choice.targetLoc !== undefined ? ` ${formatTargetLoc(choice.targetLoc)}` : '';
  const modifier = choice.modifier ? ` (${MODIFIER_LABELS[choice.modifier]})` : '';
  return `${choice.moveName}${target}${modifier}`;
}

/** The labels of forced dice, one text per die; `words` reads the names of the game's rule set, without it the ids stand in. */
export function notationDice(dice: readonly ForcedDie[] | undefined, words?: DieWords): string[] {
  return (dice ?? []).map(die => dieLabel(die, words));
}

/** The labels of the dice one slot's choice carries; none for a pass and for a choice without dice. */
export function notationSlotDice(choice: BranchSlotChoice | null | undefined, words?: DieWords): string[] {
  return notationDice(choice?.dice, words);
}

/** One side's notation for a history entry — slots joined, raw fallback. */
export function notationSideLabel(
  slotChoices: (BranchSlotChoice | null)[] | undefined,
  rawCommand: string,
): string {
  const parts = (slotChoices ?? []).filter(Boolean).map(choice => notationSlotChoice(choice));
  return parts.length > 0 ? parts.join(' + ') : rawCommand;
}

/** The identity key of a switch choice (species id and nickname id), null for a move or a pass. */
export function switchChoiceKey(choice: BranchSlotChoice | null | undefined): string | null {
  if (!choice || choice.kind !== 'switch') return null;
  return `${choice.speciesId}|${toId(choice.pokemonName)}`;
}

/** The identity key of a switch option, in the form `switchChoiceKey` gives. */
export function switchOptionKey(option: Pick<BranchSwitchOption, 'species' | 'name'>): string {
  return `${toId(option.species)}|${toId(option.name)}`;
}

/**
 * The forced slots a bench can fill: the simulator asks every flagged slot even when fewer Pokémon wait in the back, then takes one switch per Pokémon and a pass for the rest,
 * the first slots first (side.js `forcedPasses = canSwitchOut - min(canSwitchOut, canSwitchIn)`). `switchIns` undefined or zero leaves the request as it is.
 */
export function fillableForcedSlots(forced: boolean[], switchIns?: number): boolean[] {
  if (switchIns === undefined || switchIns <= 0) return forced;
  let left = switchIns;
  return forced.map(slot => (slot && left > 0 ? (left--, true) : false));
}

/** Which slots the request asks for a choice: the fillable forced slots, else every living, non-commanding active. */
export function requiredChoicesForActiveSlots(
  activeSlots: (BranchChoiceActive | null)[],
  forceSwitches: boolean[],
  switchIns?: number,
): boolean[] {
  if (forceSwitches.some(Boolean)) {
    const fillable = fillableForcedSlots(forceSwitches, switchIns);
    return activeSlots.map((_, index) => fillable[index] ?? false);
  }
  // A commanding Tatsugiri passes like a fainted body (side.js getChoiceIndex); a forced replacement never meets one.
  return activeSlots.map(active => !!active && !active.fainted && !active.commanding);
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

/** True when every required slot has a choice and no two slots switch to the same Pokémon. */
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
  if (target.trapped) {
    return { ok: false, error: `${target.name} cannot be sent in: the active Pokémon is trapped and cannot switch out.` };
  }
  return {
    ok: true,
    choice: { kind: 'switch', speciesId: toId(target.species), pokemonName: target.name },
  };
}

const EVAL_MODIFIERS = ['terastallize', 'mega', 'ultra'] as const;

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

/** Maps an engine choice string (a doubles pair like "move bugbite 1 mega, switch 3") onto per-slot choices checked against each slot's live options; null when any part fails, a null entry is a pass slot. */
export function evalChoiceToSlotChoices(
  evalChoice: string,
  movesBySlot: BranchMoveOption[][],
  switchesBySlot: BranchSwitchOption[][],
  label?: string,
  actionableSlots?: boolean[],
): (BranchSlotChoice | null)[] | null {
  // Pivot pairs ("move uturn > switch 4"): the prefill is the move; the sim raises the follow-up switch as its own prompt.
  // A switch resolves by the label's species when given: the engine's slot numbers index its own bench, whose order may differ from the reconstruction's.
  // `actionableSlots` aligns parts with slots: the engine emits one part per slot with choices, so a doubles forced replacement is one part that belongs
  // to the forced slot, not slot 0 (the pick landed on the wrong slot, reserved the species there and locked the only legal button).
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

/** Validates a free-text choice against the current request before it is stored, so invalid input never reaches the simulator. */
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
