import { createMatchupCache, unansweredMons } from './eval-function.ts';
import { advancePositionWithLog, createRootPosition, legalChoices, positionBattle } from './forward-model.ts';
import { foldClassWeights, koOddsForOptions, observeOrder, planCellEvents, type CellEvent } from './cell-blend.ts';
import { cellKey, rankFromMatrix, toResult as rankedToResult } from './rank.ts';
import { attachKoOdds, hasUnansweredContent, koOddsMapsFor } from './search/root-payload.ts';
import { playedBoundsOf } from './branch/action-bound.ts';
import { matrixCells, topVisitedIndex, treeScore } from './mcts-merge.ts';
import { floorLabels } from './turn-analysis/worst-answer.ts';
import { cellStats, makeNode, principalVariation, rowLines, treeMatrix, type Node } from './search/mcts-node.ts';
import { backpropagate, selectAndExpand } from './search/descent.ts';
import { passAfterResult } from './search/line-pass.ts';
import { cellSeeds, positionSalt } from './search/root-quantile.ts';
import type { ExpansionContext, RootClassBook } from './search/expansion.ts';
import { forcedWinFor } from './search/forced-win.ts';
import { applyForcedWin, forcedWinInput } from './search/forced-win-apply.ts';
import { perfSync } from './perf-trace.ts';
import { searchBudget, SEARCH_BUDGET_DEFAULT } from './search/budget.ts';
import { benchOrder, callbacksToGiven, resultToGiven, treeToGiven } from './search/bench-order.ts';
import { pairPlanAnswer } from './pair/root-plan.ts';
import { findPlayedOption } from './turn-analysis/played-match.ts';
import type { PlayedBounds } from './played.ts';
import type {
  CellOutcomeClass, EvalResult, EvalSettings, KoOddsInfo, MctsTreeStats, PlannedCell, SearchProgress, TeraAllowance, UnansweredProfile,
} from './types.ts';

// DUCT (decoupled UCT) Monte-Carlo tree search: leaves valued by the static eval, chance fixed per cell.

/** Iterations per tree at the default budget; the budget in force (search/budget.ts) sets the real count. */
export const MCTS_ITERATIONS = SEARCH_BUDGET_DEFAULT.iterations;
const PARTIAL_EVERY = 150;
export { WIDENING_BASE, WIDENING_VISITS_PER_SLOT, wideningWindow } from './search/mcts-node.ts';

/** Progress, partial-result and stop hooks of one search run. */
export interface MctsCallbacks {
  onProgress?(progress: SearchProgress): void;
  onPartial?(result: EvalResult): void;
  shouldStop?(): boolean;
}

type RootKoOdds = { p1: (KoOddsInfo | null)[]; p2: (KoOddsInfo | null)[] };

// The RANKINGS are the matrix mode's equilibrium solve over the tree-informed cells; visits allocate effort only.
// The SCORE keeps the visit mean: the full-delegation equilibrium score diluted across thin static cells.
function toResult(
  root: Node,
  maxDepth: number,
  koOdds?: RootKoOdds,
  unanswered?: UnansweredProfile,
  playedBounds?: PlayedBounds,
): EvalResult {
  if (root.ended || root.p1Options.length === 0 || root.p2Options.length === 0 || root.visits === 0) {
    return { score: root.value, interval: 0, depthCompleted: maxDepth, perSide: { p1: [], p2: [] } };
  }
  const { values, ended } = treeMatrix(root);
  const ranked = rankFromMatrix(
    { p1Options: root.p1Options, p2Options: root.p2Options, values, ended },
    root.value,
  );
  const result = rankedToResult(ranked, maxDepth);
  const i = topVisitedIndex(root.p1N);
  const j = topVisitedIndex(root.p2N);
  const v1 = i >= 0 ? root.p1W[i] / root.p1N[i] : root.value;
  const v2 = j >= 0 ? root.p2W[j] / root.p2N[j] : root.value;
  result.score = treeScore((v1 + v2) / 2, result.score);
  result.interval = Math.abs(v2 - v1);
  if (result.perSide.p1.length > 0) {
    const line = principalVariation(root);
    if (line.length > 1) result.perSide.p1[0].line = line.slice(1);
  }
  // Rows are ranked (reordered), so the odds match by choice string and only real events attach.
  if (koOdds) attachKoOdds(result, koOddsMapsFor(root.p1Options, root.p2Options, koOdds));
  if (unanswered && hasUnansweredContent(unanswered)) result.unanswered = unanswered;
  if (playedBounds) result.playedBounds = playedBounds;
  return result;
}

function reportIteration(
  callbacks: MctsCallbacks | undefined,
  root: Node,
  progress: { done: number; total: number },
  maxDepth: number,
  koOdds: RootKoOdds,
  unanswered: UnansweredProfile,
  playedBounds: PlayedBounds | undefined,
): void {
  const { done, total } = progress;
  callbacks?.onProgress?.({ done, total, depth: maxDepth });
  if (done % PARTIAL_EVERY === 0 && done < total) {
    callbacks?.onPartial?.(toResult(root, maxDepth, koOdds, unanswered, playedBounds));
  }
}

// A lone tree has no strata to spread, and a tree past the budget's count keeps the stream.
function treeQuantiles(serializedBattle: string, seedOffset: number, trees: number | undefined): RootClassBook['quantiles'] {
  if (trees === undefined || trees < 2 || seedOffset < 0 || seedOffset >= trees) return undefined;
  return { salt: positionSalt(serializedBattle), offset: seedOffset, trees };
}

function runMcts(
  serializedBattle: string,
  settings: EvalSettings,
  callbacks?: MctsCallbacks,
  seedOffset = 0,
  trees?: number,
): { root: Node; maxDepth: number; result: EvalResult; koOdds?: RootKoOdds; rootClassKeys: Map<number, string>; rootClassWeights: Map<number, number>; ctx?: ExpansionContext } {
  const matchupCache = createMatchupCache(settings.ruleset);
  const tera = settings.tera ?? true;
  // keepPlayed applies to the root only — children have their own spaces.
  const root = makeNode(createRootPosition(serializedBattle, settings.ruleset), tera, matchupCache, settings.keepPlayed, settings.sleepClause);
  if (root.ended || root.p1Options.length === 0 || root.p2Options.length === 0) {
    return {
      root,
      maxDepth: 1,
      result: { score: root.value, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } },
      rootClassKeys: new Map(),
      rootClassWeights: new Map(),
    };
  }

  const rootBattle = positionBattle(root.position);
  const koOdds: RootKoOdds = {
    p1: koOddsForOptions(rootBattle, 'p1', root.p1Options.map(option => option.choice)),
    p2: koOddsForOptions(rootBattle, 'p2', root.p2Options.map(option => option.choice)),
  };
  const unanswered = unansweredMons(rootBattle, matchupCache);
  const playedBounds = playedBoundsOf(rootBattle, settings.keepPlayed?.fell);
  const ctx: ExpansionContext = {
    tera, matchupCache, sleepClause: settings.sleepClause,
  };
  const book: RootClassBook = { battle: rootBattle, events: new Map(), keys: new Map(), weights: new Map() };
  book.quantiles = treeQuantiles(serializedBattle, seedOffset, trees);

  let maxDepth = 1;
  const iterations = searchBudget().iterations;
  for (let iteration = 0; iteration < iterations; iteration++) {
    if (callbacks?.shouldStop?.()) break;
    const { path, leaf, depth } = selectAndExpand(root, iteration, seedOffset, ctx, book);
    maxDepth = Math.max(maxDepth, depth);
    backpropagate(path, leaf);
    reportIteration(callbacks, root, { done: iteration + 1, total: iterations }, maxDepth, koOdds, unanswered, playedBounds);
  }

  const result = toResult(root, maxDepth, koOdds, unanswered, playedBounds);
  callbacks?.onPartial?.(result);
  return { root, maxDepth, result, koOdds, rootClassKeys: book.keys, rootClassWeights: book.weights, ctx };
}

/** Runs the tree on the board with its bench in canonical order and names its choices in the given board's slots. */
export function mctsSearch(
  serializedBattle: string,
  settings: EvalSettings,
  callbacks?: MctsCallbacks,
): EvalResult {
  const order = benchOrder(serializedBattle);
  if (!order) return mctsSearchOn(serializedBattle, settings, callbacks);
  return resultToGiven(order, mctsSearchOn(order.serialized, settings, callbacksToGiven(order, callbacks)));
}

function mctsSearchOn(serializedBattle: string, settings: EvalSettings, callbacks?: MctsCallbacks): EvalResult {
  const { result } = runMcts(serializedBattle, settings, callbacks);
  if (settings.prove !== false) {
    applyForcedWin(result, perfSync('prover', () => forcedWinFor(createRootPosition(serializedBattle, settings.ruleset), forcedWinInput(result, settings))));
  }
  return result;
}

/** One parallel tree's run: root statistics plus its own ranked result, on the canonical bench in the given slots. */
export function mctsTreeSearch(
  serializedBattle: string,
  settings: EvalSettings,
  seedOffset: number,
  callbacks?: MctsCallbacks,
): MctsTreeStats {
  const order = benchOrder(serializedBattle);
  if (!order) return treeSearchOn(serializedBattle, settings, seedOffset, callbacks);
  return treeToGiven(order, treeSearchOn(order.serialized, settings, seedOffset, callbacksToGiven(order, callbacks)));
}

const sortedClasses = (weights: Map<string, number>): CellOutcomeClass[] =>
  [...weights].map(([key, weight]) => ({ key, weight })).sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

/** The outcome classes of a rolled root cell (weights sum to 1); an order the log does not settle gives none. */
export function classesOf(root: Node, p1Choice: string, p2Choice: string, events: CellEvent[]): CellOutcomeClass[] | undefined {
  const first = events.length === 1
    ? events[0].side
    : observeOrder([advancePositionWithLog(root.position, p1Choice, p2Choice, cellSeeds(root.position, p1Choice, p2Choice)[0]).log], events);
  return first ? sortedClasses(foldClassWeights(events, first)) : undefined;
}

// The cells a replay turn's card reads: the played row against every column, every row against the played column.
// A full grid would draw a pair plan for each of some 170 to 300 cells.
function planPlayedCross(root: Node, settings: EvalSettings): PlannedCell[] | undefined {
  const rowOption = findPlayedOption(root.p1Options, settings.keepPlayed?.p1Slots);
  const columnOption = findPlayedOption(root.p2Options, settings.keepPlayed?.p2Slots);
  const row = rowOption ? root.p1Options.indexOf(rowOption) : -1;
  const column = columnOption ? root.p2Options.indexOf(columnOption) : -1;
  if (row < 0 && column < 0) return undefined;
  const cross = new Set<number>();
  if (row >= 0) root.p2Options.forEach((_, j) => cross.add(cellKey(row, j)));
  if (column >= 0) root.p1Options.forEach((_, i) => cross.add(cellKey(i, column)));
  const matchupCache = createMatchupCache(settings.ruleset);
  const planned: PlannedCell[] = [];
  for (const key of [...cross].sort((a, b) => a - b)) {
    const i = Math.floor(key / 10_000);
    const j = key % 10_000;
    try {
      const answer = pairPlanAnswer(root.position, key, root.p1Options[i].choice, root.p2Options[j].choice, matchupCache);
      if (answer) planned.push(answer);
    } catch {
      // A narrative payload: a cell the plan cannot read stays unplanned, the search result is untouched.
    }
  }
  return planned;
}

// A failed cell (a guard tripped) is left out of `plannedCells`. A doubles root has no analytic plan or boundary list:
// the pair plan decides it in the verify step, and it ships the played cross instead.
function planRootCells(root: Node, settings: EvalSettings): { boundaryCells: number[]; plannedCells: PlannedCell[] | undefined } {
  const battle = positionBattle(root.position);
  if (battle.gameType === 'doubles') return { boundaryCells: [], plannedCells: planPlayedCross(root, settings) };
  const boundaryCells: number[] = [];
  const plannedCells: PlannedCell[] = [];
  for (let i = 0; i < root.p1Options.length; i++) {
    for (let j = 0; j < root.p2Options.length; j++) {
      const { choice: p1Choice } = root.p1Options[i];
      const { choice: p2Choice } = root.p2Options[j];
      const plan = planCellEvents(battle, p1Choice, p2Choice);
      if (plan.kind === 'fail') continue;
      if (plan.kind === 'none') {
        plannedCells.push({ key: cellKey(i, j), plan: 'none' });
        continue;
      }
      boundaryCells.push(cellKey(i, j));
      const classes = classesOf(root, p1Choice, p2Choice, plan.events);
      plannedCells.push({ key: cellKey(i, j), plan: 'events', ...(classes ? { classes } : {}) });
    }
  }
  return { boundaryCells, plannedCells };
}

function treeSearchOn(
  serializedBattle: string,
  settings: EvalSettings,
  seedOffset: number,
  callbacks?: MctsCallbacks,
): MctsTreeStats {
  const { root, maxDepth, result, koOdds, rootClassKeys, rootClassWeights, ctx } = runMcts(serializedBattle, settings, callbacks, seedOffset, searchBudget().trees);
  // Boundary flags for the merge's verify selection: analytic, identical across trees, so only offset 0 pays the scan.
  // A doubles tree ships no list: the pair plan decides its boundary in the verify step (verify-select.ts).
  const doubles = positionBattle(root.position).gameType === 'doubles';
  const { boundaryCells, plannedCells } = seedOffset === 0 && !root.ended && root.p1Options.length > 0 && root.p2Options.length > 0
    ? planRootCells(root, settings)
    : { boundaryCells: [], plannedCells: undefined };
  const legal = seedOffset === 0 && doubles ? rootLegal(root, settings.tera ?? true) : {};
  const sides = positionBattle(root.position).sides;
  const living = { p1: sides[0].pokemon.filter(mon => !mon.fainted).length, p2: sides[1].pokemon.filter(mon => !mon.fainted).length };
  const cells = [...root.children.entries()].map(([key, child]) => cellStats(key, child, rootClassKeys.get(key), rootClassWeights.get(key)));
  // A single tree is never merged (mergeMctsTrees returns this result), so it writes its own cell visits.
  if (result.matrix) {
    const visits = new Map(cells.map(cell => [cell.key, cell.visits]));
    result.matrix.cells = matrixCells(root.p1Options.length, root.p2Options.length, key => visits.get(key) ?? 0, undefined, plannedCells);
  }
  // Everything the result and the merge read is final above; the pass writes below the root only.
  passAfterResult(root, result, settings, ctx, seedOffset, searchBudget().iterations, callbacks?.shouldStop);
  return {
    p1Options: root.p1Options.map(option => ({ choice: option.choice, label: option.label })),
    p2Options: root.p2Options.map(option => ({ choice: option.choice, label: option.label })),
    p1N: root.p1N,
    p1W: root.p1W,
    p2N: root.p2N,
    p2W: root.p2W,
    visits: root.visits,
    depth: maxDepth,
    rootValue: root.value,
    living,
    koOdds,
    ...(doubles ? {} : { boundaryCells }),
    ...(plannedCells ? { plannedCells } : {}),
    ...legal,
    // Every root row's lines, against this tree's own top three rows of the other side.
    rowLines: rowLines(root, { p1: result.perSide.p1.slice(0, 3).map(row => row.label), p2: result.perSide.p2.slice(0, 3).map(row => row.label) }, undefined, floorLabels(result)),
    // Map order is insertion order: deterministic under the fixed seed schedule.
    cells,
    result,
  };
}

function rootLegal(root: Node, tera: TeraAllowance): Pick<MctsTreeStats, 'p1Legal' | 'p2Legal'> {
  if (root.ended || root.p1Options.length === 0 || root.p2Options.length === 0) return {};
  const options = (side: 'p1' | 'p2') => legalChoices(root.position, side, { tera }).map(option => ({ choice: option.choice, label: option.label }));
  return { p1Legal: options('p1'), p2Legal: options('p2') };
}

export function mctsRoot(serializedBattle: string, settings: EvalSettings, seedOffset = 0): Node {
  return runMcts(serializedBattle, settings, undefined, seedOffset).root;
}
