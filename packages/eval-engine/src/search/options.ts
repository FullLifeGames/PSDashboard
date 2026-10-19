import { legalChoices, positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { coreOf, GIMMICK_TOKENS } from '../rank.ts';
import { findConsistentOptions, findPlayedOption } from '../analysis.ts';
import { isPivotMove } from '../pivot-moves.ts';
import type { PlayedAction } from '../played.ts';
import type { TeraAllowance } from '../types.ts';
import { combinedOptionHints, isCombined, singlesOptionHints } from './hints.ts';
import { sideIndex } from '@fulllifegames/replay-core';

/**
 * The engine's option lists: legal choices with guaranteed no-ops dropped,
 * the mandatory doubles restriction, the sub-search candidate cap, and the
 * root's pivot-pair expansion.
 */

/** Sub-matrix cap for candidate restriction (base moves always survive). */
const RESTRICT_K = 8;

/**
 * Combined-option cap for doubles. Unlike the singles sub-search cap this is
 * mandatory everywhere (root included): the raw slot product reaches hundreds
 * of options per side, and a full matrix over it would take minutes.
 */
const RESTRICT_K_DOUBLES = 16;
/** Distinct move-pair cores competing on hints before gimmick variants enter. */
const BASE_CORE_BUDGET = 12;
/** Top cores whose Tera/Mega/Ultra variants fill the remaining slots. */
const GIMMICK_CORE_BUDGET = 4;

/** Ranks combined doubles options by summed per-slot static threat hints. */
function restrictCombined(
  position: SimPosition,
  side: 'p1' | 'p2',
  options: ChoiceOption[],
  keep?: (PlayedAction | null)[],
): ChoiceOption[] {
  if (options.length <= RESTRICT_K_DOUBLES) return options;
  // Distinct cores compete on hints first: without the core budget three
  // gimmick variants of each top damage pair crowded out every status/setup
  // combo (a Tera variant is hinted on its Tera body since round 63, so it
  // can outrank its base). Gimmick variants of the strongest cores then fill
  // the remaining slots.
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
 * The actually played combo must stay rankable even when the hint scoring
 * wouldn't keep it — otherwise played-vs-best regret has nothing to read.
 * Its gimmick siblings ride along so "played, but with Mega/Tera" is always
 * a comparable line. A hidden slot (flinch) falls back to the best-hint
 * consistent combo — the same charitable candidate the analysis grades.
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
 * Field moves that FAIL deterministically against a standing condition —
 * clicking them is a pass with a real-looking label (GPL T25: Stealth Rock
 * ranked while rocks were already up). The rule is the simulator's
 * (`Side.addSideCondition`, round 72 W4): a side condition that stands and
 * has no restart handler cannot start again; one with the handler (Spikes,
 * Toxic Spikes) refuses a layer past its cap. A move with an `onHitSide`
 * handler (Quick Guard, Wide Guard) runs it either way and prints no failure.
 * A foe-side move checks the foe's side, an ally-side move the mover's own. If a player actually
 * clicks one, the turn reads as unmatched (charitable) rather than graded.
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
 * Sleep Clause makes a second sleep FAIL while a foe already sleeps —
 * recommending Sleep Powder into a sleeping team is a no-op with a
 * real-looking label (GPL T11). The clause comes from the battle's own
 * ruleTable (real ladder formats survive serialization) or the settings
 * flag (custom-game reconstructions lose their @@@ suffix when serialized).
 * Rest-sleeps don't trip the real clause; the filter accepts that rare
 * false drop — the sim still prices whatever stays listed.
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
  // Never filter a side into an empty list — a stuck mon whose only moves
  // are standing field moves must still act.
  return filtered.length > 0 ? filtered : options;
}

/**
 * The engine's option source: legal choices, with guaranteed-failing field
 * moves dropped (singles lists; doubles combos keep their hint-based
 * restriction) and the mandatory doubles restriction applied. Every
 * consumer (search root, sub-searches, MCTS nodes, executors) goes through
 * here so all engines see the same lists.
 */
export function searchOptions(
  position: SimPosition,
  side: 'p1' | 'p2',
  opts?: { tera?: TeraAllowance; keep?: (PlayedAction | null)[]; sleepClause?: boolean },
): ChoiceOption[] {
  // Round 67 (T113): the played slots (keepPlayed, root only) add the partner target a played move named.
  const options = legalChoices(position, side, { tera: opts?.tera, partner: opts?.keep });
  if (isCombined(options)) return restrictCombined(position, side, options, opts?.keep);
  return dropNoopMoves(positionBattle(position), side, options, opts?.sleepClause);
}

/**
 * Pivot moves are pairs: the move PLUS the incoming Pokémon, chosen in the
 * same turn. The root matrix enumerates them ("U-turn → Clefable") so the
 * ranking can price each follow-up instead of hiding a greedy mid-turn
 * resolution inside one row (GPL T25). Root singles only: sub-searches and
 * doubles keep the greedy resolution — their bare `move uturn` stays valid.
 * Round 70 (N1): which moves pivot comes from the battle's own Dex, so Teleport
 * is a pair from Gen 8 on (pivot-moves.ts, test/pivot-moves.spec.ts).
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
 * Caps a wide option list for deep sub-searches: every base move is kept
 * (cheap insurance against proxy blind spots like fixed-damage moves), and
 * Tera variants plus switches compete for the remaining slots by static
 * threat hints. Deterministic; an approximation by design — never applied
 * to the top-level matrix the user sees.
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
