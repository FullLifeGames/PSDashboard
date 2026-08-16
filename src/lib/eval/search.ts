import type { Pokemon, PRNGSeed } from '@pkmn/sim';
import {
  boostedFraction, createMatchupCache, evaluatePosition, pairThreat, singleMoveFraction, type MatchupCache,
} from './eval-function';
import {
  advancePosition, advancePositionWithLog, createRootPosition, legalChoices, positionBattle,
  type ChoiceOption, type SimPosition,
} from './forward-model';
import {
  applyTrendExtrapolation, applyTrendTiebreak, attachLines, cellKey, coreOf, GIMMICK_TOKENS,
  rankFromMatrix, reblendValue, selectExpansionCells, selectTieProbeCells, toResult, TOP_EXPANSION,
  type PvStep, type Ranked, type ValueMatrix,
} from './rank';
import { findConsistentOptions, findPlayedOption } from './analysis';
import {
  BOUNDARY_DRAW_BUDGET, classifyChild, foldClassWeights, koOddsForOptions, observeOrder, planCellEvents, PROBE_SEEDS,
} from './cell-blend';
import { RANDOM_CALL_MOVES } from './ko-odds';
import type { PlayedAction } from './played';
import type { CellValue, SearchExecutor } from './orchestrator';
import type {
  CellBlend, CellBlendClass, EvalResult, EvalSettings, KoOddsMismatch, RankedChoice, SearchProgress, TeraAllowance,
} from './types';
import { wpUnits } from './winprob';

export interface SearchCallbacks {
  onProgress?(progress: SearchProgress): void;
  onPartial?(result: EvalResult): void;
  /** Checked between matrix cells; returning true stops deepening (current result is returned). */
  shouldStop?(): boolean;
}

/** Fixed seeds: index < settings.samples are used. Never randomized. */
export const SEARCH_SEEDS: readonly PRNGSeed[] = [
  '1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20',
];

interface Matrix extends ValueMatrix {
  /** children[i][j]: first-seed child position (kept for deepening). */
  children: SimPosition[][];
  /** cellKey(i, j) → analytic class blend (root boundary cells only). */
  blends: Map<number, CellBlend>;
  /** Boundary cells whose analytic classes went unsampled (probe budget). */
  diagnostics: KoOddsMismatch[];
}

function countFainted(battle: ReturnType<typeof positionBattle>): number {
  return battle.sides[0].pokemon.filter(p => p.fainted).length +
    battle.sides[1].pokemon.filter(p => p.fainted).length;
}

/**
 * The ONE place the sigmoid applies: every leaf evaluation becomes win-prob
 * units (2p−1), so cell averages, the equilibrium solve, and regret all live
 * in probability space — variance is genuinely valuable when behind (Jensen)
 * instead of being flattened by score-space means. Ended battles clamp to
 * exact ±1 (the sigmoid saturates near but not at ±1). Shared by the sync
 * search, the executor (worker path), and MCTS — all engine modes must live
 * in the same value space.
 */
// Re-exported for engine-side consumers (the calibration harness's auto
// dispatch); the constant itself lives in types.ts so the UI can share it
// without importing the sim.
export { AUTO_MCTS_FAINTED_FRACTION } from './types';

/** Fainted bodies over total bodies, both sides — the phase signal for the win-prob mapping. */
export function battleFaintedFraction(battle: ReturnType<typeof positionBattle>): number {
  let fainted = 0;
  let total = 0;
  for (const side of battle.sides) {
    for (const pokemon of side.pokemon) {
      total += 1;
      if (pokemon.fainted || pokemon.hp <= 0) fainted += 1;
    }
  }
  return total > 0 ? fainted / total : 0;
}

export function leafValue(battle: ReturnType<typeof positionBattle>, matchupCache: MatchupCache): number {
  const raw = evaluatePosition(battle, matchupCache);
  if (battle.ended) return raw > 0 ? 1 : raw < 0 ? -1 : 0;
  return wpUnits(raw, battle.gameType === 'doubles', battleFaintedFraction(battle));
}

/** Move ids named in a (possibly combined) choice string. */
const choiceMoveIds = (choice: string): string[] => choice.split(',')
  .map(part => part.trim().split(' '))
  .filter(tokens => tokens[0] === 'move')
  .map(tokens => tokens[1]);

/** The pair includes an accuracy roll or a random-call move — seeds diverge. */
function rollSensitivePair(battle: ReturnType<typeof positionBattle>, p1Choice: string, p2Choice: string): boolean {
  return [...choiceMoveIds(p1Choice), ...choiceMoveIds(p2Choice)].some(id => {
    const move = battle.dex.moves.get(id);
    if (!move.exists) return false;
    if (RANDOM_CALL_MOVES.has(move.id)) return true;
    return typeof move.accuracy === 'number' && move.accuracy < 100;
  });
}

/**
 * Damage-roll grouping (foul-play style): a cell where nothing fainted is
 * roll-insensitive — one sim suffices. Cells where a KO happened get the
 * full seed spread, and so do cells whose pair carries an accuracy roll or
 * a random-call move (Sleep Talk) — the seed decides those outcomes.
 * A child that ENDED the game is exact only when no such roll was involved:
 * draft T64 priced a 90%-accurate Overheat as a CERTAIN +1.00 off one seed
 * that hit, so terminal roll cells always take at least three seeds, even
 * in single-sample sweeps — a ±1 claim is the strongest output the engine
 * makes.
 */
function sampleCell(
  root: SimPosition,
  rootFainted: number,
  p1Choice: string,
  p2Choice: string,
  samples: number,
  matchupCache: MatchupCache,
  blendRoot = false,
): { value: number; ended: boolean; firstChild: SimPosition; blend?: CellBlend; diagnostic?: KoOddsMismatch } {
  const rootBattle = positionBattle(root);
  const plan = blendRoot ? planCellEvents(rootBattle, p1Choice, p2Choice) : null;
  if (!plan || plan.kind !== 'events') {
    const firstChild = advancePosition(root, p1Choice, p2Choice, SEARCH_SEEDS[0]);
    const firstBattle = positionBattle(firstChild);
    const ended = firstBattle.ended;
    // Averaging wp-units = averaging win probabilities across rolls: the
    // KO-boundary roll groups carry their true value ("30% this crit wins")
    // instead of a flattened score mean.
    let sum = leafValue(firstBattle, matchupCache);
    const rollMoves = rollSensitivePair(rootBattle, p1Choice, p2Choice);
    const draws = ended
      ? (rollMoves ? Math.max(samples, 3) : 1)
      : (countFainted(firstBattle) > rootFainted || rollMoves ? samples : 1);
    for (let s = 1; s < draws; s++) {
      const child = advancePosition(root, p1Choice, p2Choice, SEARCH_SEEDS[s]);
      sum += leafValue(positionBattle(child), matchupCache);
    }
    return { value: sum / draws, ended, firstChild };
  }

  // Blend path (round 6): draw with logs, classify children into outcome
  // classes, weight the class means analytically — a 43% kill roll cannot
  // sample 5/5 and grade certain anymore. Any deviation from the fold's
  // occurrence model falls back to the plain seed average.
  const draws: { child: SimPosition; log: string[]; leaf: number; ended: boolean }[] = [];
  const drawSeed = (seed: PRNGSeed) => {
    const { child, log } = advancePositionWithLog(root, p1Choice, p2Choice, seed);
    const battle = positionBattle(child);
    draws.push({ child, log, leaf: leafValue(battle, matchupCache), ended: battle.ended });
  };
  const baseDraws = Math.max(1, Math.min(samples, SEARCH_SEEDS.length));
  for (let s = 0; s < baseDraws; s++) drawSeed(SEARCH_SEEDS[s]);

  const fallback = () => ({
    value: draws.slice(0, baseDraws).reduce((sum, draw) => sum + draw.leaf, 0) / baseDraws,
    ended: draws[0].ended,
    firstChild: draws[0].child,
  });

  const first = observeOrder(draws.map(draw => draw.log), plan.events);
  if (first === null) return fallback();
  const expected = foldClassWeights(plan.events, first);
  const classes = new Map<string, { leafSum: number; count: number; hasFirst: boolean; ended: boolean }>();
  const classify = (draw: (typeof draws)[number], isFirst: boolean): boolean => {
    const key = classifyChild(draw.log, plan.events);
    if (key === null || !expected.has(key)) return false;
    const entry = classes.get(key) ?? { leafSum: 0, count: 0, hasFirst: false, ended: true };
    entry.leafSum += draw.leaf;
    entry.count += 1;
    entry.hasFirst = entry.hasFirst || isFirst;
    entry.ended = entry.ended && draw.ended;
    classes.set(key, entry);
    return true;
  };
  for (let index = 0; index < draws.length; index++) {
    if (!classify(draws[index], index === 0)) return fallback();
  }
  // Chase analytically-expected classes the base draws missed.
  let probeIndex = 0;
  while (
    [...expected.keys()].some(key => !classes.has(key)) &&
    draws.length < BOUNDARY_DRAW_BUDGET && probeIndex < PROBE_SEEDS.length
  ) {
    drawSeed(PROBE_SEEDS[probeIndex++]);
    if (!classify(draws[draws.length - 1], false)) return fallback();
  }

  const missing = [...expected.keys()].filter(key => !classes.has(key));
  let weightTotal = 0;
  for (const [key, weight] of expected) if (classes.has(key)) weightTotal += weight;
  if (weightTotal <= 0) return fallback();

  let value = 0;
  const blendClasses: CellBlendClass[] = [];
  for (const [key, weight] of expected) {
    const cls = classes.get(key);
    if (!cls) continue;
    const normalized = weight / weightTotal; // 1.0 total when nothing is missing
    value += normalized * (cls.leafSum / cls.count);
    blendClasses.push({ weight: normalized, leafSum: cls.leafSum, count: cls.count, hasFirst: cls.hasFirst });
  }
  const blend: CellBlend = { classes: blendClasses, firstLeaf: draws[0].leaf };
  const ended = draws.every(draw => draw.ended);
  const diagnostic: KoOddsMismatch | undefined = missing.length > 0
    ? {
      i: -1, j: -1, p1Choice, p2Choice, missing, // i/j stamped by the caller
      analytic: Object.fromEntries(expected),
      sampled: Object.fromEntries([...classes].map(([key, cls]) => [key, cls.count])),
    }
    : undefined;
  return { value, ended, firstChild: draws[0].child, blend, ...(diagnostic ? { diagnostic } : {}) };
}

/** Sub-matrix cap for candidate restriction (base moves always survive). */
export const RESTRICT_K = 8;

/**
 * Combined-option cap for doubles. Unlike the singles sub-search cap this is
 * mandatory everywhere (root included): the raw slot product reaches hundreds
 * of options per side, and a full matrix over it would take minutes.
 */
export const RESTRICT_K_DOUBLES = 16;
/** Distinct move-pair cores competing on hints before gimmick variants enter. */
const BASE_CORE_BUDGET = 12;
/** Top cores whose Tera/Mega/Ultra variants fill the remaining slots. */
const GIMMICK_CORE_BUDGET = 4;
const isCombined = (options: ChoiceOption[]) => options.some(option => option.choice.includes(','));

/** Floor hint for any status move: Protect, redirection, speed control stay rankable. */
const SUPPORT_HINT = 0.25;
/** Fake Out on the turn it works: damage plus one neutralized foe action. */
const FLINCH_BONUS = 0.3;
/** Boost payoff counted for ~2 future attacks. */
const SETUP_HORIZON = 2;
/** Spread moves hit both foes, at the doubles spread penalty. */
const SPREAD_FACTOR = 0.75;

const clampStage = (stage: number) => Math.max(-6, Math.min(6, stage));

/** Summed per-slot static threat hints for combined doubles options. */
function combinedOptionHints(
  position: SimPosition,
  side: 'p1' | 'p2',
  options: ChoiceOption[],
): number[] {
  const battle = positionBattle(position);
  const sideState = battle.sides[side === 'p1' ? 0 : 1];
  const foeActives = sideState.foe.active;
  const foes = foeActives.filter((foe): foe is Pokemon => !!foe && !foe.fainted);
  const actors = sideState.active.filter((active): active is Pokemon => !!active && !active.fainted);

  /** Damage-fraction gain a self-boosting move would buy over SETUP_HORIZON turns. */
  const setupEquity = (attacker: Pokemon, moveId: string): number => {
    const move = battle.dex.moves.get(moveId);
    const boosts = (move.boosts || move.self?.boosts || undefined) as { atk?: number; spa?: number } | undefined;
    if (!boosts || (!boosts.atk && !boosts.spa)) return 0;
    let equity = 0;
    for (const foe of foes) {
      const threat = pairThreat(attacker, foe, battle);
      const now = boostedFraction(threat, attacker, foe);
      const then = boostedFraction(threat, attacker, foe, {
        atk: clampStage(attacker.boosts.atk + (boosts.atk ?? 0)),
        spa: clampStage(attacker.boosts.spa + (boosts.spa ?? 0)),
      });
      equity = Math.max(equity, (then - now) * SETUP_HORIZON);
    }
    return equity;
  };

  const partHint = (part: string, partIndex: number): number => {
    const tokens = part.trim().split(' ');
    if (tokens[0] === 'switch') {
      const candidate = sideState.pokemon[parseInt(tokens[1], 10) - 1];
      if (!candidate || foes.length === 0) return 0;
      return Math.max(...foes.map(foe =>
        boostedFraction(pairThreat(candidate, foe, battle), candidate, foe) -
        boostedFraction(pairThreat(foe, candidate, battle), foe, candidate)));
    }
    if (tokens[0] !== 'move') return 0;
    const attacker = actors[partIndex];
    if (!attacker || foes.length === 0) return 0;
    const move = battle.dex.moves.get(tokens[1]);
    if (move.category === 'Status') return Math.max(SUPPORT_HINT, setupEquity(attacker, tokens[1]));
    if (move.target === 'allAdjacentFoes' || move.target === 'allAdjacent') {
      return foes.reduce((sum, foe) => sum + singleMoveFraction(attacker, foe, tokens[1], battle), 0) * SPREAD_FACTOR;
    }
    const targetLoc = tokens.length > 2 ? parseInt(tokens[2], 10) : NaN;
    let damage: number;
    if (Number.isFinite(targetLoc) && targetLoc > 0) {
      const foe = foeActives[targetLoc - 1];
      damage = foe && !foe.fainted ? singleMoveFraction(attacker, foe, tokens[1], battle) : 0;
    } else {
      damage = Math.max(...foes.map(foe => singleMoveFraction(attacker, foe, tokens[1], battle)));
    }
    if (move.id === 'fakeout' && attacker.activeMoveActions === 0) damage += FLINCH_BONUS;
    return damage;
  };

  return options.map(option =>
    option.choice.split(',').reduce((sum, part, partIndex) => sum + partHint(part, partIndex), 0));
}

/** Ranks combined doubles options by summed per-slot static threat hints. */
function restrictCombined(
  position: SimPosition,
  side: 'p1' | 'p2',
  options: ChoiceOption[],
  keep?: (PlayedAction | null)[],
): ChoiceOption[] {
  if (options.length <= RESTRICT_K_DOUBLES) return options;
  // Distinct cores compete on hints first — a gimmick variant scores the same
  // hint as its base, so without the core budget three variants of each top
  // damage pair crowded out every status/setup combo. Gimmick variants of the
  // strongest cores then fill the remaining slots.
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

  // The actually played combo must stay rankable even when the hint scoring
  // wouldn't keep it — otherwise played-vs-best regret has nothing to read.
  // Its gimmick siblings ride along so "played, but with Mega/Tera" is always
  // a comparable line. A hidden slot (flinch) falls back to the best-hint
  // consistent combo — the same charitable candidate the analysis grades.
  if (keep) {
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
  return restricted;
}

/**
 * Field moves that FAIL deterministically against a standing condition —
 * clicking them is a pass with a real-looking label (GPL T25: Stealth Rock
 * ranked while rocks were already up). `foe` = the side the hazard lands
 * on; screens/tailwind check the mover's own side. If a player actually
 * clicks one, the turn reads as unmatched (charitable) rather than graded.
 */
const NOOP_FIELD_MOVES: Record<string, (own: Side, foe: Side) => boolean> = {
  stealthrock: (_own, foe) => !!foe.sideConditions['stealthrock'],
  spikes: (_own, foe) => ((foe.sideConditions['spikes'] as { layers?: number } | undefined)?.layers ?? 0) >= 3,
  toxicspikes: (_own, foe) => ((foe.sideConditions['toxicspikes'] as { layers?: number } | undefined)?.layers ?? 0) >= 2,
  stickyweb: (_own, foe) => !!foe.sideConditions['stickyweb'],
  reflect: own => !!own.sideConditions['reflect'],
  lightscreen: own => !!own.sideConditions['lightscreen'],
  auroraveil: own => !!own.sideConditions['auroraveil'],
  tailwind: own => !!own.sideConditions['tailwind'],
  safeguard: own => !!own.sideConditions['safeguard'],
  mist: own => !!own.sideConditions['mist'],
};

type Side = ReturnType<typeof positionBattle>['sides'][number];

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
  const own = battle.sides[side === 'p1' ? 0 : 1];
  const foe = battle.sides[side === 'p1' ? 1 : 0];
  const foeSleeps = sleepClauseActive(battle, sleepClause) &&
    foe.pokemon.some(pokemon => !pokemon.fainted && pokemon.status === 'slp');
  const filtered = options.filter(option => {
    if (!option.choice.startsWith('move ')) return true;
    const moveId = option.choice.split(' ')[1];
    if (foeSleeps && battle.dex.moves.get(moveId).status === 'slp') return false;
    const check = NOOP_FIELD_MOVES[moveId];
    return !check || !check(own, foe);
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
  const options = legalChoices(position, side, opts);
  if (isCombined(options)) return restrictCombined(position, side, options, opts?.keep);
  return dropNoopMoves(positionBattle(position), side, options, opts?.sleepClause);
}

/** Moves that switch the user out — really PAIRS of move + incoming mon. */
const PIVOT_MOVE_IDS = new Set([
  'uturn', 'voltswitch', 'flipturn', 'partingshot', 'teleport', 'batonpass',
  'chillyreception', 'shedtail',
]);

/**
 * Pivot moves are pairs: the move PLUS the incoming Pokémon, chosen in the
 * same turn. The root matrix enumerates them ("U-turn → Clefable") so the
 * ranking can price each follow-up instead of hiding a greedy mid-turn
 * resolution inside one row (GPL T25). Root singles only: sub-searches and
 * doubles keep the greedy resolution — their bare `move uturn` stays valid.
 */
function expandPivotPairs(position: SimPosition, side: 'p1' | 'p2', options: ChoiceOption[]): ChoiceOption[] {
  if (isCombined(options)) return options;
  if (!options.some(option => PIVOT_MOVE_IDS.has(option.choice.split(' ')[1]))) return options;
  const battle = positionBattle(position);
  const sideState = battle.sides[side === 'p1' ? 0 : 1];
  const bench = sideState.pokemon
    .map((pokemon, index) => ({ pokemon, slot: index + 1 }))
    .filter(({ pokemon }) => !pokemon.isActive && !pokemon.fainted);
  if (bench.length === 0) return options;
  const expanded: ChoiceOption[] = [];
  for (const option of options) {
    const tokens = option.choice.split(' ');
    if (tokens[0] !== 'move' || !PIVOT_MOVE_IDS.has(tokens[1])) {
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
/** Static hints for singles options: damage fraction for moves, threat differential for switches. */
function singlesOptionHints(position: SimPosition, side: 'p1' | 'p2', options: ChoiceOption[]): number[] {
  const battle = positionBattle(position);
  const sideState = battle.sides[side === 'p1' ? 0 : 1];
  const opponent = battle.sides[side === 'p1' ? 1 : 0].active[0];
  const active = sideState.active[0];
  const hint = (option: ChoiceOption): number => {
    if (!opponent || opponent.fainted) return 0;
    if (option.choice.startsWith('move ')) {
      if (!active || active.fainted) return 0;
      return singleMoveFraction(active, opponent, option.choice.split(' ')[1], battle);
    }
    const slot = parseInt(option.choice.split(' ')[1], 10);
    const candidate = sideState.pokemon[slot - 1];
    if (!candidate) return 0;
    return boostedFraction(pairThreat(candidate, opponent, battle), candidate, opponent) -
      boostedFraction(pairThreat(opponent, candidate, battle), opponent, candidate);
  };
  return options.map(hint);
}

/**
 * Static per-option threat hints — the SAME machinery candidate restriction
 * ranks with, exported so the MCTS expansion order can reuse it (zero sim
 * advances). Combined doubles options sum per-slot hints (support floor,
 * setup equity, spread factor); singles use damage fraction for moves and
 * the threat differential for switches.
 */
export function optionHints(position: SimPosition, side: 'p1' | 'p2', options: ChoiceOption[]): number[] {
  if (isCombined(options)) return combinedOptionHints(position, side, options);
  return singlesOptionHints(position, side, options);
}

function restrictOptions(position: SimPosition, side: 'p1' | 'p2', options: ChoiceOption[]): ChoiceOption[] {
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

function buildMatrix(
  position: SimPosition,
  p1Options: ChoiceOption[],
  p2Options: ChoiceOption[],
  samples: number,
  depth: number,
  callbacks: SearchCallbacks | undefined,
  progress: { done: number; total: number },
  matchupCache: MatchupCache,
  blendRoot = false,
): Matrix {
  const rootFainted = countFainted(positionBattle(position));
  const values: number[][] = [];
  const ended: boolean[][] = [];
  const children: SimPosition[][] = [];
  const blends = new Map<number, CellBlend>();
  const diagnostics: KoOddsMismatch[] = [];

  for (let i = 0; i < p1Options.length; i++) {
    values.push([]);
    ended.push([]);
    children.push([]);
    for (let j = 0; j < p2Options.length; j++) {
      const cell = sampleCell(position, rootFainted, p1Options[i].choice, p2Options[j].choice, samples, matchupCache, blendRoot);
      values[i].push(cell.value);
      ended[i].push(cell.ended);
      children[i].push(cell.firstChild);
      if (cell.blend) blends.set(cellKey(i, j), cell.blend);
      if (cell.diagnostic) diagnostics.push({ ...cell.diagnostic, i, j });
      progress.done += 1;
      callbacks?.onProgress?.({ done: progress.done, total: progress.total, depth });
    }
  }

  return { p1Options, p2Options, values, ended, children, blends, diagnostics };
}

/**
 * Score-focused depth-1 search: deepening sub-searches only consume the
 * score, the interval, and each side's top choice — so maximin permits
 * exact alpha/beta row and column cutoffs over an on-demand cell memo.
 * Results match `searchPosition` for those fields (ties resolve identically:
 * first encounter wins, matching the stable sort). The `expected` of the
 * returned tops approximates as the guarantee value; rankings beyond [0]
 * are not produced.
 */
export function subSearchDepth1(
  serializedBattle: string,
  settings: EvalSettings,
  matchupCache: MatchupCache = createMatchupCache(),
): EvalResult {
  const root = createRootPosition(serializedBattle);
  const battle = positionBattle(root);
  if (battle.ended) {
    return { score: leafValue(battle, matchupCache), interval: 0, depthCompleted: settings.depth, perSide: { p1: [], p2: [] } };
  }
  const tera = settings.tera ?? true;
  const p1Options = searchOptions(root, 'p1', { tera, keep: settings.keepPlayed?.p1Slots, sleepClause: settings.sleepClause });
  const p2Options = searchOptions(root, 'p2', { tera, keep: settings.keepPlayed?.p2Slots, sleepClause: settings.sleepClause });
  if (p1Options.length === 0 || p2Options.length === 0) {
    return searchPosition(serializedBattle, settings, undefined, matchupCache);
  }

  const rootFainted = countFainted(battle);
  const cellMemo = new Map<number, number>();
  const cellValue = (i: number, j: number): number => {
    const key = cellKey(i, j);
    let value = cellMemo.get(key);
    if (value === undefined) {
      value = sampleCell(root, rootFainted, p1Options[i].choice, p2Options[j].choice, settings.samples, matchupCache).value;
      cellMemo.set(key, value);
    }
    return value;
  };

  // Pass A: v1 = max_i min_j with alpha cutoffs.
  let v1 = -Infinity;
  let bestI = 0;
  let bestIPunish = 0;
  for (let i = 0; i < p1Options.length; i++) {
    let rowMin = Infinity;
    let punish = 0;
    let cut = false;
    for (let j = 0; j < p2Options.length; j++) {
      const value = cellValue(i, j);
      if (value < rowMin) {
        rowMin = value;
        punish = j;
      }
      if (rowMin < v1) {
        cut = true;
        break;
      }
    }
    if (!cut && rowMin > v1) {
      v1 = rowMin;
      bestI = i;
      bestIPunish = punish;
    }
  }

  // Pass B: v2 = min_j max_i with beta cutoffs, reusing the memo.
  let v2 = Infinity;
  let bestJ = 0;
  let bestJPunish = 0;
  for (let j = 0; j < p2Options.length; j++) {
    let colMax = -Infinity;
    let punish = 0;
    let cut = false;
    for (let i = 0; i < p1Options.length; i++) {
      const value = cellValue(i, j);
      if (value > colMax) {
        colMax = value;
        punish = i;
      }
      if (colMax > v2) {
        cut = true;
        break;
      }
    }
    if (!cut && colMax < v2) {
      v2 = colMax;
      bestJ = j;
      bestJPunish = punish;
    }
  }

  // Pruned path: no full matrix exists, so ev falls back to the guarantee.
  const p1Top: RankedChoice = {
    choice: p1Options[bestI].choice, label: p1Options[bestI].label,
    worstCase: v1, expected: v1, ev: v1, punishedBy: p2Options[bestIPunish].label,
  };
  const p2Top: RankedChoice = {
    choice: p2Options[bestJ].choice, label: p2Options[bestJ].label,
    worstCase: -v2, expected: -v2, ev: -v2, punishedBy: p1Options[bestJPunish].label,
  };
  return {
    score: (v1 + v2) / 2,
    interval: Math.max(0, v2 - v1),
    depthCompleted: 1,
    perSide: { p1: [p1Top], p2: [p2Top] },
  };
}

/**
 * Dispatches deepening sub-searches: depth-1 leaves take the pruned path,
 * deeper sub-searches run full-rank but with restricted candidates (their
 * cost is quadratic in the option count and they only feed cell values).
 */
function subSearch(serializedBattle: string, settings: EvalSettings, matchupCache: MatchupCache): EvalResult {
  return settings.depth === 1
    ? subSearchDepth1(serializedBattle, settings, matchupCache)
    : searchPosition(serializedBattle, settings, undefined, matchupCache, true);
}

export function searchPosition(
  serializedBattle: string,
  settings: EvalSettings,
  callbacks?: SearchCallbacks,
  matchupCache: MatchupCache = createMatchupCache(),
  restrictCandidates = false,
): EvalResult {
  const root = createRootPosition(serializedBattle);
  const battle = positionBattle(root);
  if (battle.ended) {
    const score = leafValue(battle, matchupCache);
    return { score, interval: 0, depthCompleted: settings.depth, perSide: { p1: [], p2: [] } };
  }

  const rootValue = leafValue(battle, matchupCache);
  const tera = settings.tera ?? true;
  let p1Options = searchOptions(root, 'p1', { tera, keep: settings.keepPlayed?.p1Slots, sleepClause: settings.sleepClause });
  let p2Options = searchOptions(root, 'p2', { tera, keep: settings.keepPlayed?.p2Slots, sleepClause: settings.sleepClause });
  if (restrictCandidates) {
    p1Options = restrictOptions(root, 'p1', p1Options);
    p2Options = restrictOptions(root, 'p2', p2Options);
  } else {
    // Root matrix only: sub-searches keep the greedy pivot resolution.
    p1Options = expandPivotPairs(root, 'p1', p1Options);
    p2Options = expandPivotPairs(root, 'p2', p2Options);
  }
  const progress = { done: 0, total: Math.max(p1Options.length * p2Options.length, 1) };

  // Root matrices blend boundary cells analytically; restricted sub-searches
  // keep the plain seed average (their consumers read only score/tops).
  const matrix = buildMatrix(root, p1Options, p2Options, settings.samples, 1, callbacks, progress, matchupCache, !restrictCandidates);
  const attachKoDiagnostics = (target: EvalResult) => {
    if (matrix.diagnostics.length > 0) target.koDiagnostics = matrix.diagnostics;
  };
  // Root options carry their own move's analytic kill odds (vs the standing
  // opposing active) for the narrative layers — computed once per side.
  const koOddsMaps = restrictCandidates ? null : (() => {
    const p1Odds = koOddsForOptions(battle, 'p1', p1Options.map(option => option.choice));
    const p2Odds = koOddsForOptions(battle, 'p2', p2Options.map(option => option.choice));
    return {
      p1: new Map(p1Options.map((option, index) => [option.choice, p1Odds[index]])),
      p2: new Map(p2Options.map((option, index) => [option.choice, p2Odds[index]])),
    };
  })();
  const attachKoOdds = (target: EvalResult) => {
    if (!koOddsMaps) return;
    for (const side of ['p1', 'p2'] as const) {
      for (const row of target.perSide[side]) {
        const odds = koOddsMaps[side].get(row.choice);
        if (odds) row.koOdds = odds;
      }
    }
  };
  // Pre-deepening statics: the trend baseline. Every trend the tiebreak
  // compares is uniformly 1-ply-vs-static — mixed ply counts inside one
  // comparison are the depth-asymmetry trap.
  const staticValues = matrix.values.map(row => [...row]);
  const trendMap = new Map<number, number>();
  let ranked: Ranked = rankFromMatrix(matrix, rootValue);
  let result = toResult(ranked, 1);
  attachKoDiagnostics(result);
  attachKoOdds(result);
  callbacks?.onPartial?.(result);

  let stopped = false;
  const pvByCell = new Map<number, PvStep[]>();
  for (let depth = 2; depth <= settings.depth && !stopped; depth++) {
    if (callbacks?.shouldStop?.()) break;

    // Deepening a cell usually moves its value, which shifts a row's worst
    // case onto a sibling that is still shallow — so expansion iterates:
    // re-rank, chase the current punishing cells, repeat under a budget.
    // Cells are re-expanded per level (deeper sub-searches overwrite).
    const expandedThisLevel = new Set<number>();
    const budget = TOP_EXPANSION * 2;
    let used = 0;
    while (used < budget && !stopped) {
      const wanted = selectExpansionCells(matrix, ranked, budget - used)
        .filter(([i, j]) => !expandedThisLevel.has(cellKey(i, j)));
      if (wanted.length === 0) break;

      for (const [i, j] of wanted) {
        if (callbacks?.shouldStop?.()) {
          stopped = true;
          break;
        }
        // Deepen the first-seed child one level shallower with a single
        // sample (the child is seed-specific); its midpoint score replaces
        // the cell's static value.
        const child = matrix.children[i][j];
        // keepPlayed is a root-position hint — child positions have their
        // own choice space where those actions mean nothing.
        const sub = subSearch(child.serialized, { ...settings, depth: (depth - 1) as 1 | 2, samples: 1, keepPlayed: undefined }, matchupCache);
        if (depth === 2) trendMap.set(cellKey(i, j), sub.score - staticValues[i][j]);
        // A blended cell re-blends through the first-seed child's class —
        // one deepened branch must not overwrite the mixture.
        const cellBlend = matrix.blends.get(cellKey(i, j));
        matrix.values[i][j] = cellBlend ? reblendValue(cellBlend, sub.score) : sub.score;
        expandedThisLevel.add(cellKey(i, j));
        const subTopP1 = sub.perSide.p1[0];
        const subTopP2 = sub.perSide.p2[0];
        if (subTopP1 || subTopP2) {
          pvByCell.set(cellKey(i, j), [
            { p1: subTopP1?.label ?? '—', p2: subTopP2?.label ?? '—' },
            ...(subTopP1?.line ?? []),
          ]);
        }
        used += 1;
        callbacks?.onProgress?.({ done: used, total: budget, depth });
      }
      if (stopped) break;
      ranked = rankFromMatrix(matrix, rootValue);
    }
    if (stopped) break;

    ranked = rankFromMatrix(matrix, rootValue);
    attachLines(matrix, ranked, pvByCell);
    result = toResult(ranked, depth);
    attachKoDiagnostics(result);
    attachKoOdds(result);
    callbacks?.onPartial?.(result);
  }

  // Horizon-trend layers: root search over singles-shaped lists only
  // (combined doubles probes cost far more than a label swap is worth);
  // sub-searches skip them — ordering inside a tie cannot move a cell value.
  if (!stopped && !restrictCandidates && !isCombined(p1Options) && !isCombined(p2Options)) {
    for (const [i, j] of selectTieProbeCells(matrix, result, trendMap)) {
      const sub = subSearch(matrix.children[i][j].serialized, { ...settings, depth: 1, samples: 1, keepPlayed: undefined }, matchupCache);
      trendMap.set(cellKey(i, j), sub.score - staticValues[i][j]);
    }
    // 2b: fold the tied rows' trends into their values (no re-solve) — a
    // bleeding stall separates from a building switch BY VALUE (draft T50).
    applyTrendExtrapolation(matrix, result, trendMap);
    applyTrendTiebreak(matrix, result, trendMap);
  }
  return result;
}

/**
 * Single-threaded SearchExecutor over this module's sim primitives — the
 * reference implementation the orchestrator parity test pins against, and
 * the fallback when no worker pool is available.
 */
export function createLocalExecutor(serializedBattle: string): SearchExecutor {
  const matchupCache = createMatchupCache();
  const root = createRootPosition(serializedBattle);
  return {
    async choices(tera, keepPlayed, sleepClause) {
      const battle = positionBattle(root);
      // The choices RPC serves the orchestrated ROOT — pivot pairs expand
      // here exactly as in searchPosition (the sync path), or the app's
      // worker-pool matrix shows a bare "U-turn" row the sync pins never see.
      const p1 = expandPivotPairs(root, 'p1', searchOptions(root, 'p1', { tera, keep: keepPlayed?.p1Slots, sleepClause }));
      const p2 = expandPivotPairs(root, 'p2', searchOptions(root, 'p2', { tera, keep: keepPlayed?.p2Slots, sleepClause }));
      return {
        p1, p2,
        rootValue: leafValue(battle, matchupCache),
        rootEnded: battle.ended,
        koOdds: {
          p1: koOddsForOptions(battle, 'p1', p1.map(option => option.choice)),
          p2: koOddsForOptions(battle, 'p2', p2.map(option => option.choice)),
        },
      };
    },
    async evalCells(jobs, onDone) {
      const out: CellValue[] = [];
      const rootFainted = countFainted(positionBattle(root));
      let completed = 0;
      for (const job of jobs) {
        // evalCells only ever serves the orchestrated ROOT — blend like the
        // sync path's root matrix.
        const cell = sampleCell(root, rootFainted, job.p1Choice, job.p2Choice, job.samples, matchupCache, true);
        out.push({
          i: job.i, j: job.j, value: cell.value, ended: cell.ended,
          ...(cell.blend ? { blend: cell.blend } : {}),
          ...(cell.diagnostic ? { diagnostic: { ...cell.diagnostic, i: job.i, j: job.j } } : {}),
        });
        completed += 1;
        onDone?.(completed);
      }
      return out;
    },
    async subSearch(job) {
      const child = advancePosition(root, job.p1Choice, job.p2Choice, SEARCH_SEEDS[0]);
      return subSearch(child.serialized, job.settings, matchupCache);
    },
  };
}
