import { legalChoices, positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { coreOf, GIMMICK_TOKENS } from '../rank.ts';
import { findConsistentOptions, findPlayedOption } from '../analysis.ts';
import { isPivotMove } from '../pivot-moves.ts';
import type { PlayedAction } from '../played.ts';
import type { TeraAllowance } from '../types.ts';
import { combinedOptionHints, isCombined, singlesOptionHints } from './hints.ts';
import { sideIndex } from '@fulllifegames/replay-core';
import { refusedByBody } from '../sim-ask/index.ts';


const RESTRICT_K = 8;

const RESTRICT_K_DOUBLES = 16;
const BASE_CORE_BUDGET = 12;
const GIMMICK_CORE_BUDGET = 4;

function restrictCombined(
  position: SimPosition,
  side: 'p1' | 'p2',
  options: ChoiceOption[],
  keep?: (PlayedAction | null)[],
): ChoiceOption[] {
  if (options.length <= RESTRICT_K_DOUBLES) return options;
  const hints = combinedOptionHints(position, side, options);
  const scored = options.map((option, index) => ({ option, index, value: hints[index] }));
  const groups = new Map<string, typeof scored>();
  for (const entry of scored) {
    const key = coreOf(entry.option.choice);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  const rankedCores = [...groups.values()].sort((a, b) =>
    Math.max(...b.map(entry => entry.value)) - Math.max(...a.map(entry => entry.value)) ||
    a[0].index - b[0].index);

  const selection: typeof scored = [];
  for (const group of rankedCores.slice(0, BASE_CORE_BUDGET)) {
    selection.push(group.find(entry =>
      !entry.option.choice.split(/[ ,]+/).some(token => GIMMICK_TOKENS.has(token))) ?? group[0]);
  }
  for (const group of rankedCores.slice(0, GIMMICK_CORE_BUDGET)) {
    for (const entry of group) {
      if (selection.length >= RESTRICT_K_DOUBLES) break;
      if (!selection.includes(entry)) selection.push(entry);
    }
  }
  const restricted = selection
    .sort((a, b) => a.index - b.index)
    .map(entry => entry.option);

  keepPlayedCore(options, restricted, scored, keep);
  return restricted;
}

// The played combo stays rankable past the hints; a hidden slot (flinch) takes the best-hint consistent combo.
function keepPlayedCore(
  options: ChoiceOption[],
  restricted: ChoiceOption[],
  scored: { option: ChoiceOption; index: number; value: number }[],
  keep: (PlayedAction | null)[] | undefined,
): void {
  if (!keep) return;
  const valueOf = new Map(scored.map(entry => [entry.option, entry.value]));
  const consistent = findConsistentOptions(options, keep);
  const played = findPlayedOption(options, keep) ??
    (consistent.length > 0
      ? consistent.reduce((a, b) => ((valueOf.get(b) ?? 0) > (valueOf.get(a) ?? 0) ? b : a))
      : null);
  if (played) {
    const playedCore = coreOf(played.choice);
    for (const option of options) {
      if (coreOf(option.choice) === playedCore && !restricted.includes(option)) restricted.push(option);
    }
  }
}

/** Layers at which a layered hazard refuses another; only `onSideRestart` code says it, no Dex field. */
// oracle: packages/eval-engine/test/noop-moves-oracle.spec.ts
export const LAYER_CAPS: Record<string, number> = { spikes: 3, toxicspikes: 2 };

type Side = ReturnType<typeof positionBattle>['sides'][number];

/** Field moves that fail against a standing condition (`Side.addSideCondition`): clicking one is a pass. */
export function failsAgainstStanding(dex: ReturnType<typeof positionBattle>['dex'], moveId: string, own: Side, foe: Side): boolean {
  const move = dex.moves.get(moveId);
  if (!move.sideCondition) return false;
  const standing = (move.target === 'foeSide' ? foe : own).sideConditions[move.sideCondition] as { layers?: number } | undefined;
  // An onHitSide move (Quick Guard, Wide Guard) runs it either way and prints no failure.
  if (!standing || typeof (move as { onHitSide?: unknown }).onHitSide === 'function') return false;
  if (typeof (dex.conditions.get(move.sideCondition) as { onSideRestart?: unknown }).onSideRestart !== 'function') return true;
  const cap = LAYER_CAPS[move.sideCondition];
  return cap !== undefined && (standing.layers ?? 0) >= cap;
}

// From the battle's own ruleTable, or the settings flag (custom-game reconstructions lose their @@@ suffix).
// Rest-sleeps do not trip the real clause; the filter accepts that rare false drop.
function sleepClauseActive(battle: ReturnType<typeof positionBattle>, sleepClause: boolean | undefined): boolean {
  return sleepClause === true || battle.ruleTable?.has('sleepclausemod') === true;
}

function dropNoopMoves(
  battle: ReturnType<typeof positionBattle>,
  side: 'p1' | 'p2',
  options: ChoiceOption[],
  sleepClause?: boolean,
): ChoiceOption[] {
  const own = battle.sides[sideIndex(side)];
  const foe = battle.sides[side === 'p1' ? 1 : 0];
  const foeBody = foe.active.find(body => body && !body.fainted);
  const foeSleeps = sleepClauseActive(battle, sleepClause) &&
    foe.pokemon.some(pokemon => !pokemon.fainted && pokemon.status === 'slp');
  const filtered = options.filter(option => {
    if (!option.choice.startsWith('move ')) return true;
    const moveId = option.choice.split(' ')[1];
    if (foeSleeps && battle.dex.moves.get(moveId).status === 'slp') return false;
    const body = own.active[0];
    return !failsAgainstStanding(battle.dex, moveId, own, foe) && !(body && foeBody && refusedByBody(battle, body, foeBody, moveId));
  });
  return filtered.length > 0 ? filtered : options;
}

function dropRefusedParts(battle: ReturnType<typeof positionBattle>, side: 'p1' | 'p2', options: ChoiceOption[]): ChoiceOption[] {
  const own = battle.sides[sideIndex(side)];
  const foeBody = battle.sides[side === 'p1' ? 1 : 0].active.find(body => body && !body.fainted);
  if (!foeBody) return options;
  const parts = options.map(option => option.choice.split(',').map(part => part.trim()));
  const refused = new Map<string, boolean>();
  const refusedAt = (slot: number, part: string): boolean => {
    const key = `${slot}:${part}`;
    let answer = refused.get(key);
    if (answer === undefined) {
      const body = own.active[slot];
      const [verb, moveId] = part.split(' ');
      refused.set(key, answer = verb === 'move' && !!body && !body.fainted && refusedByBody(battle, body, foeBody, moveId));
    }
    return answer;
  };
  const starved = new Set<number>();
  for (let slot = 0; slot < Math.max(...parts.map(each => each.length)); slot++) {
    if (parts.every(each => each[slot] === undefined || refusedAt(slot, each[slot]))) starved.add(slot);
  }
  const kept = options.filter((_option, index) => parts[index].every((part, slot) => starved.has(slot) || !refusedAt(slot, part)));
  return kept.length > 0 ? kept : options;
}

export function searchOptions(
  position: SimPosition,
  side: 'p1' | 'p2',
  opts?: { tera?: TeraAllowance; keep?: (PlayedAction | null)[]; sleepClause?: boolean },
): ChoiceOption[] {
  const options = legalChoices(position, side, { tera: opts?.tera, partner: opts?.keep });
  if (isCombined(options)) return restrictCombined(position, side, dropRefusedParts(positionBattle(position), side, options), opts?.keep);
  return dropNoopMoves(positionBattle(position), side, options, opts?.sleepClause);
}

/** Root singles only: a pivot move plus its incoming Pokémon is one option; the battle's Dex says which moves pivot. */
export function expandPivotPairs(position: SimPosition, side: 'p1' | 'p2', options: ChoiceOption[]): ChoiceOption[] {
  if (isCombined(options)) return options;
  const battle = positionBattle(position);
  const pivots = (option: ChoiceOption) => option.choice.startsWith('move ') && isPivotMove(battle.dex, option.choice.split(' ')[1]);
  if (!options.some(pivots)) return options;
  const sideState = battle.sides[sideIndex(side)];
  const bench = sideState.pokemon
    .map((pokemon, index) => ({ pokemon, slot: index + 1 }))
    .filter(({ pokemon }) => !pokemon.isActive && !pokemon.fainted);
  if (bench.length === 0) return options;
  const expanded: ChoiceOption[] = [];
  for (const option of options) {
    if (!pivots(option)) {
      expanded.push(option);
      continue;
    }
    for (const { pokemon, slot } of bench) {
      expanded.push({
        choice: `${option.choice} > switch ${slot}`,
        label: `${option.label} → ${pokemon.species.name}`,
      });
    }
  }
  return expanded;
}

/** Caps a wide option list for sub-searches: every base move stays, Tera variants and switches compete by hints. */
export function restrictOptions(position: SimPosition, side: 'p1' | 'p2', options: ChoiceOption[]): ChoiceOption[] {
  if (options.length <= RESTRICT_K) return options;

  const isBaseMove = (option: ChoiceOption) =>
    option.choice.startsWith('move ') && !option.choice.endsWith(' terastallize');
  const baseMoves = options.filter(isBaseMove);
  const rest = options.filter(option => !isBaseMove(option));

  const restHints = singlesOptionHints(position, side, rest);
  const kept = rest
    .map((option, index) => ({ option, index, value: restHints[index] }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, Math.max(0, RESTRICT_K - baseMoves.length))
    .sort((a, b) => a.index - b.index)
    .map(entry => entry.option);
  return [...baseMoves, ...kept];
}
