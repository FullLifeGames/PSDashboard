import { legalChoices, positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { coreOf, GIMMICK_TOKENS } from '../rank.ts';
import { findConsistentOptions, findPlayedOption } from '../analysis.ts';
import { isPivotMove } from '../pivot-moves.ts';
import type { PlayedAction } from '../played.ts';
import type { TeraAllowance } from '../types.ts';
import { combinedOptionHints, isCombined, singlesOptionHints } from './hints.ts';
import { sideIndex } from '@fulllifegames/replay-core';

/**
 * The engine's option lists: legal choices without guaranteed no-ops, the doubles restriction, the sub-search cap, the root's pivot pairs.
 */

const RESTRICT_K = 8;

/** Combined-option cap for doubles, mandatory everywhere (root included): the raw slot product reaches hundreds of options per side. */
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
  // Distinct cores compete on hints first: without the core budget three gimmick variants of each top damage pair crowd out every
  // status/setup combo. Gimmick variants of the strongest cores then fill the remaining slots.
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

/**
 * The played combo stays rankable even when the hint scoring would not keep it, or played-vs-best regret has nothing to read. Its
 * gimmick siblings ride along. A hidden slot (flinch) falls back to the best-hint consistent combo, the candidate the analysis grades.
 */
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

/**
 * The layers at which a layered hazard refuses another layer. The cap lives in the code of the condition's `onSideRestart`
 * handler, so no Dex field says it; test/noop-field-moves-oracle.spec.ts reads the full stack from the simulator.
 */
// oracle: packages/eval-engine/test/noop-field-moves-oracle.spec.ts
export const LAYER_CAPS: Record<string, number> = { spikes: 3, toxicspikes: 2 };

type Side = ReturnType<typeof positionBattle>['sides'][number];

/**
 * Field moves that fail deterministically against a standing condition: clicking them is a pass with a real-looking label (Stealth
 * Rock ranked while rocks were already up). The rule is the simulator's (`Side.addSideCondition`): a side condition that stands and
 * has no restart handler cannot start again; one with the handler (Spikes, Toxic Spikes) refuses a layer past its cap. A move with
 * an `onHitSide` handler (Quick Guard, Wide Guard) runs it either way and prints no failure. A foe-side move checks the foe's side,
 * an ally-side move the mover's own. If a player clicks one, the turn reads as unmatched (charitable) rather than graded.
 */
export function failsAgainstStanding(dex: ReturnType<typeof positionBattle>['dex'], moveId: string, own: Side, foe: Side): boolean {
  const move = dex.moves.get(moveId);
  if (!move.sideCondition) return false;
  const standing = (move.target === 'foeSide' ? foe : own).sideConditions[move.sideCondition] as { layers?: number } | undefined;
  if (!standing || typeof (move as { onHitSide?: unknown }).onHitSide === 'function') return false;
  if (typeof (dex.conditions.get(move.sideCondition) as { onSideRestart?: unknown }).onSideRestart !== 'function') return true;
  const cap = LAYER_CAPS[move.sideCondition];
  return cap !== undefined && (standing.layers ?? 0) >= cap;
}

/**
 * Sleep Clause makes a second sleep fail while a foe already sleeps, so Sleep Powder into a sleeping team is a no-op with a
 * real-looking label. The clause comes from the battle's own ruleTable (real ladder formats survive serialization) or the settings
 * flag (custom-game reconstructions lose their @@@ suffix when serialized). Rest-sleeps do not trip the real clause; the filter
 * accepts that rare false drop.
 */
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
  const foeSleeps = sleepClauseActive(battle, sleepClause) &&
    foe.pokemon.some(pokemon => !pokemon.fainted && pokemon.status === 'slp');
  const filtered = options.filter(option => {
    if (!option.choice.startsWith('move ')) return true;
    const moveId = option.choice.split(' ')[1];
    if (foeSleeps && battle.dex.moves.get(moveId).status === 'slp') return false;
    return !failsAgainstStanding(battle.dex, moveId, own, foe);
  });
  // never filter a side into an empty list: a mon whose only moves are standing field moves must still act
  return filtered.length > 0 ? filtered : options;
}

export function searchOptions(
  position: SimPosition,
  side: 'p1' | 'p2',
  opts?: { tera?: TeraAllowance; keep?: (PlayedAction | null)[]; sleepClause?: boolean },
): ChoiceOption[] {
  // the played slots (keepPlayed, root only) add the partner target a played move named
  const options = legalChoices(position, side, { tera: opts?.tera, partner: opts?.keep });
  if (isCombined(options)) return restrictCombined(position, side, options, opts?.keep);
  return dropNoopMoves(positionBattle(position), side, options, opts?.sleepClause);
}

/**
 * Pivot moves are pairs: the move plus the incoming Pokémon, chosen in the same turn. The root matrix enumerates them ("U-turn →
 * Clefable") so the ranking prices each follow-up instead of hiding a greedy mid-turn resolution inside one row. Root singles
 * only: sub-searches and doubles keep the greedy resolution, their bare `move uturn` stays valid. Which moves pivot comes from the
 * battle's own Dex, so Teleport is a pair from Gen 8 on (pivot-moves.ts, test/pivot-moves.spec.ts).
 */
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

/**
 * Caps a wide option list for deep sub-searches: every base move is kept (insurance against proxy blind spots like fixed-damage
 * moves), and Tera variants plus switches compete for the remaining slots by static threat hints. Never applied to the top-level matrix.
 */
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
