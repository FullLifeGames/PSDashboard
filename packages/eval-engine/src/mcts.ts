import type { PRNGSeed } from '@pkmn/sim';
import { createMatchupCache, unansweredMons, type MatchupCache } from './eval-function.ts';
import { advancePosition, advancePositionWithLog, createRootPosition, positionBattle } from './forward-model.ts';
import { classifyChild, koOddsForOptions, planCellEvents, type CellEvent } from './cell-blend.ts';
import { cellKey, rankFromMatrix, toResult as rankedToResult } from './rank.ts';
import { SEARCH_SEEDS } from './search.ts';
import { attachKoOdds, hasUnansweredContent, koOddsMapsFor } from './search/root-payload.ts';
import { topVisitedIndex } from './mcts-merge.ts';
import { makeNode, pick, principalVariation, treeMatrix, type Node } from './search/mcts-node.ts';
import type { EvalResult, EvalSettings, KoOddsInfo, MctsTreeStats, SearchProgress, TeraAllowance, UnansweredProfile } from './types.ts';

/**
 * DUCT (decoupled UCT) Monte-Carlo tree search — the "think deeper" mode.
 * Both sides select their choice independently via UCB over their own
 * statistics (the correct formulation for simultaneous moves), new leaves
 * are valued by the static eval (no rollouts, foul-play style), and values
 * backpropagate along the joint path. Fully deterministic: chance is fixed
 * per-cell at creation time from the iteration-indexed seed list. The node
 * machinery (creation, the UCB pick, the principal variation, the
 * tree-informed matrix) lives in search/mcts-node.ts.
 */

export const MCTS_ITERATIONS = 600;
const PARTIAL_EVERY = 150;

export { WIDENING_BASE, WIDENING_VISITS_PER_SLOT, wideningWindow } from './search/mcts-node.ts';

export interface MctsCallbacks {
  onProgress?(progress: SearchProgress): void;
  onPartial?(result: EvalResult): void;
  shouldStop?(): boolean;
}

/** Root per-option kill odds, index-aligned with the node's option lists. */
type RootKoOdds = { p1: (KoOddsInfo | null)[]; p2: (KoOddsInfo | null)[] };

/**
 * HYBRID SEMANTICS (corpus-gated 2026-08-11): the RANKINGS are the same
 * equilibrium solve the matrix mode runs, over the tree-informed cells —
 * visit counts allocate search effort, they are not the verdict (under
 * hint-ordered widening a hint-anchored move can stay most-visited while
 * the tree's own values refute it: draft t58 Knock Off into a Rest loop).
 * The SCORE keeps the visit-mean formulation — the tree's value
 * information concentrates where its visits went, and the full-delegation
 * equilibrium score measured −1.0 sign on the paired bed (dilution across
 * thin static cells), so the score line stays bit-identical to the
 * standing records while the recommendations upgrade.
 */
function toResult(
  root: Node,
  maxDepth: number,
  koOdds?: RootKoOdds,
  unanswered?: UnansweredProfile,
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
  result.score = (v1 + v2) / 2;
  result.interval = Math.abs(v2 - v1);
  if (result.perSide.p1.length > 0) {
    const line = principalVariation(root);
    if (line.length > 1) result.perSide.p1[0].line = line.slice(1);
  }
  // Rows are ranked (reordered), so the odds match by choice string and
  // only real events attach — the shared root-payload contract.
  if (koOdds) attachKoOdds(result, koOddsMapsFor(root.p1Options, root.p2Options, koOdds));
  // Round 13: root narrative payload, same contract as search.ts.
  if (unanswered && hasUnansweredContent(unanswered)) result.unanswered = unanswered;
  return result;
}

interface PathStep {
  node: Node;
  i: number;
  j: number;
}

/**
 * Round 33: the root's drawn outcome classes. A root cell fixes one chance
 * outcome per tree; naming that outcome (miss / hit-kill / hit-nokill, per
 * cell-blend.ts) lets the merge pool the trees' depth per class. Events are
 * planned once per root cell (one calc), the class read from the advance
 * log; unrecognized draws stay unkeyed.
 */
interface RootClasses {
  battle: ReturnType<typeof positionBattle>;
  events: Map<number, CellEvent[] | null>;
  keys: Map<number, string>;
}

/** Expands a root child with its log and records the drawn class when the cell is a boundary cell. */
function expandRootChild(root: Node, key: number, i: number, j: number, seed: PRNGSeed, classes: RootClasses) {
  let events = classes.events.get(key);
  if (events === undefined) {
    const plan = planCellEvents(classes.battle, root.p1Options[i].choice, root.p2Options[j].choice);
    events = plan.kind === 'events' ? plan.events : null;
    classes.events.set(key, events);
  }
  const { child, log } = advancePositionWithLog(root.position, root.p1Options[i].choice, root.p2Options[j].choice, seed);
  if (events) {
    const classKey = classifyChild(log, events);
    if (classKey !== null) classes.keys.set(key, classKey);
  }
  return child;
}

/**
 * Selection: descend through existing children via decoupled UCB, expanding
 * at most one child. Returns the joint path, the leaf value the descent
 * ended on, and the depth it reached.
 */
function selectAndExpand(
  root: Node,
  iteration: number,
  seedOffset: number,
  tera: TeraAllowance,
  matchupCache: MatchupCache,
  sleepClause: boolean | undefined,
  classes: RootClasses,
): { path: PathStep[]; leaf: number; depth: number } {
  const path: PathStep[] = [];
  let node = root;
  let leaf: number;
  let depth = 1;
  for (;;) {
    if (node.ended || node.p1Options.length === 0 || node.p2Options.length === 0) {
      leaf = node.value;
      break;
    }
    const i = pick(node.p1N, node.p1W, node.visits, true, node.p1Order);
    const j = pick(node.p2N, node.p2W, node.visits, false, node.p2Order);
    path.push({ node, i, j });
    const key = cellKey(i, j);
    let child = node.children.get(key);
    if (!child) {
      // Expansion: the cell's chance outcome is fixed at creation time.
      // The offset rotates the seed schedule so parallel trees explore
      // different chance outcomes.
      const seed = SEARCH_SEEDS[(iteration + seedOffset) % SEARCH_SEEDS.length];
      // Root expansions keep their advance log for the outcome class
      // (advancePosition is advancePositionWithLog(...).child: same child).
      const position = node === root
        ? expandRootChild(root, key, i, j, seed, classes)
        : advancePosition(node.position, node.p1Options[i].choice, node.p2Options[j].choice, seed);
      child = makeNode(position, tera, matchupCache, undefined, sleepClause);
      node.children.set(key, child);
      leaf = child.value;
      child.visits += 1;
      depth += 1;
      break;
    }
    node = child;
    depth += 1;
  }
  return { path, leaf, depth };
}

/** Backpropagation along the joint path. */
function backpropagate(path: PathStep[], leaf: number): void {
  for (const step of path) {
    step.node.visits += 1;
    step.node.p1N[step.i] += 1;
    step.node.p1W[step.i] += leaf;
    step.node.p2N[step.j] += 1;
    step.node.p2W[step.j] += leaf;
  }
}

/** Progress after every iteration; a partial result every PARTIAL_EVERY iterations before the last. */
function reportIteration(
  callbacks: MctsCallbacks | undefined,
  root: Node,
  done: number,
  maxDepth: number,
  koOdds: RootKoOdds,
  unanswered: UnansweredProfile,
): void {
  callbacks?.onProgress?.({ done, total: MCTS_ITERATIONS, depth: maxDepth });
  if (done % PARTIAL_EVERY === 0 && done < MCTS_ITERATIONS) {
    callbacks?.onPartial?.(toResult(root, maxDepth, koOdds, unanswered));
  }
}

function runMcts(
  serializedBattle: string,
  settings: EvalSettings,
  callbacks?: MctsCallbacks,
  seedOffset = 0,
): { root: Node; maxDepth: number; result: EvalResult; koOdds?: RootKoOdds; rootClassKeys: Map<number, string> } {
  const matchupCache = createMatchupCache();
  const tera = settings.tera ?? true;
  // keepPlayed applies to the root only — children have their own spaces.
  const root = makeNode(createRootPosition(serializedBattle), tera, matchupCache, settings.keepPlayed, settings.sleepClause);
  if (root.ended || root.p1Options.length === 0 || root.p2Options.length === 0) {
    return {
      root,
      maxDepth: 1,
      result: { score: root.value, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } },
      rootClassKeys: new Map(),
    };
  }

  // Analytic per-option kill odds, computed once at the root (narrative
  // payload — value pricing is the verify sampler's job).
  const rootBattle = positionBattle(root.position);
  const koOdds: RootKoOdds = {
    p1: koOddsForOptions(rootBattle, 'p1', root.p1Options.map(option => option.choice)),
    p2: koOddsForOptions(rootBattle, 'p2', root.p2Options.map(option => option.choice)),
  };
  // Round 13: root unanswered-mon profile, once per root like the ko odds.
  const unanswered = unansweredMons(rootBattle, matchupCache);
  const classes: RootClasses = { battle: rootBattle, events: new Map(), keys: new Map() };

  let maxDepth = 1;
  for (let iteration = 0; iteration < MCTS_ITERATIONS; iteration++) {
    if (callbacks?.shouldStop?.()) break;
    const { path, leaf, depth } = selectAndExpand(root, iteration, seedOffset, tera, matchupCache, settings.sleepClause, classes);
    maxDepth = Math.max(maxDepth, depth);
    backpropagate(path, leaf);
    reportIteration(callbacks, root, iteration + 1, maxDepth, koOdds, unanswered);
  }

  const result = toResult(root, maxDepth, koOdds, unanswered);
  callbacks?.onPartial?.(result);
  return { root, maxDepth, result, koOdds, rootClassKeys: classes.keys };
}

export function mctsSearch(
  serializedBattle: string,
  settings: EvalSettings,
  callbacks?: MctsCallbacks,
): EvalResult {
  return runMcts(serializedBattle, settings, callbacks).result;
}

/** One parallel tree's run: root statistics plus its own ranked result. */
export function mctsTreeSearch(
  serializedBattle: string,
  settings: EvalSettings,
  seedOffset: number,
  callbacks?: MctsCallbacks,
): MctsTreeStats {
  const { root, maxDepth, result, koOdds, rootClassKeys } = runMcts(serializedBattle, settings, callbacks, seedOffset);
  // Boundary flags for the merge's verify selection. Analytic only (one
  // calc per damaging pair, no sim advances) and identical across trees,
  // and the merge reads trees[0] alone — so only the offset-0 tree pays
  // the i×j calc scan (doubles: 256 cells); sibling trees ship an empty
  // list that nothing reads.
  const boundaryCells: number[] = [];
  if (seedOffset === 0 && !root.ended && root.p1Options.length > 0 && root.p2Options.length > 0) {
    const battle = positionBattle(root.position);
    for (let i = 0; i < root.p1Options.length; i++) {
      for (let j = 0; j < root.p2Options.length; j++) {
        const plan = planCellEvents(battle, root.p1Options[i].choice, root.p2Options[j].choice);
        if (plan.kind === 'events') boundaryCells.push(cellKey(i, j));
      }
    }
  }
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
    koOdds,
    boundaryCells,
    // Root-cell stats for the merged equilibrium (Map order is insertion
    // order — deterministic under the fixed seed schedule).
    cells: [...root.children.entries()].map(([key, child]) => ({
      key,
      visits: child.visits,
      total: child.p1W.reduce((sum, w) => sum + w, 0) + child.value,
      value: child.value,
      ended: child.ended,
      ...(rootClassKeys.has(key) ? { classKey: rootClassKeys.get(key) } : {}),
    })),
    result,
  };
}
