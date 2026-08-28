import { createMatchupCache, unansweredMons, type MatchupCache } from './eval-function';
import {
  advancePosition, createRootPosition, positionBattle,
  type ChoiceOption, type SimPosition,
} from './forward-model';
import { koOddsForOptions, planCellEvents } from './cell-blend';
import { cellKey, rankFromMatrix, toResult as rankedToResult } from './rank';
import { leafValue, optionHints, searchOptions, SEARCH_SEEDS } from './search';
import type { EvalResult, EvalSettings, KoOddsInfo, MctsTreeStats, SearchProgress, TeraAllowance, UnansweredProfile } from './types';

/**
 * DUCT (decoupled UCT) Monte-Carlo tree search — the "think deeper" mode.
 * Both sides select their choice independently via UCB over their own
 * statistics (the correct formulation for simultaneous moves), new leaves
 * are valued by the static eval (no rollouts, foul-play style), and values
 * backpropagate along the joint path. Fully deterministic: chance is fixed
 * per-cell at creation time from the iteration-indexed seed list.
 */

export const MCTS_ITERATIONS = 600;
const EXPLORATION = 0.8;
const PARTIAL_EVERY = 150;
const PV_MIN_VISITS = 8;
const PV_MAX_STEPS = 3;

/**
 * Progressive widening: a node exposes only its strongest-by-hint unvisited
 * options, and the window grows with the node's visits. The old rule forced
 * EVERY unvisited option through a real visit first — on the doubles 16×16
 * root that sweep ate the 600 iterations before UCB could discriminate
 * (measured doubles −3 vs the matrix on the 2026-08-11 corpus). Hints are
 * static (optionHints — the restriction's own ranking), so ordering stays
 * deterministic; the window still reaches every option asymptotically.
 */
export const WIDENING_BASE = 4;
export const WIDENING_VISITS_PER_SLOT = 8;
export const wideningWindow = (count: number, visits: number): number =>
  Math.min(count, WIDENING_BASE + Math.floor(visits / WIDENING_VISITS_PER_SLOT));

/** Hint-descending option order (ties keep list order — deterministic). */
const hintOrder = (hints: number[]): number[] =>
  hints.map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .map(entry => entry.index);

export interface MctsCallbacks {
  onProgress?(progress: SearchProgress): void;
  onPartial?(result: EvalResult): void;
  shouldStop?(): boolean;
}

/** Root per-option kill odds, index-aligned with the node's option lists. */
type RootKoOdds = { p1: (KoOddsInfo | null)[]; p2: (KoOddsInfo | null)[] };

interface Node {
  position: SimPosition;
  ended: boolean;
  /** Static eval, p1 perspective. */
  value: number;
  p1Options: ChoiceOption[];
  p2Options: ChoiceOption[];
  p1N: number[];
  p1W: number[];
  p2N: number[];
  p2W: number[];
  /** Hint-descending expansion order per side (indices into the option lists). */
  p1Order: number[];
  p2Order: number[];
  visits: number;
  children: Map<number, Node>;
}

function makeNode(
  position: SimPosition,
  tera: TeraAllowance,
  matchupCache: MatchupCache,
  keepPlayed?: EvalSettings['keepPlayed'],
  sleepClause?: boolean,
): Node {
  const battle = positionBattle(position);
  const ended = battle.ended;
  const p1Options = ended ? [] : searchOptions(position, 'p1', { tera, keep: keepPlayed?.p1Slots, sleepClause });
  const p2Options = ended ? [] : searchOptions(position, 'p2', { tera, keep: keepPlayed?.p2Slots, sleepClause });
  return {
    position,
    ended,
    // Same wp-unit value space as the matrix mode — mode switches must not
    // change what a number means.
    value: leafValue(battle, matchupCache),
    p1Options,
    p2Options,
    p1N: new Array(p1Options.length).fill(0),
    p1W: new Array(p1Options.length).fill(0),
    p2N: new Array(p2Options.length).fill(0),
    p2W: new Array(p2Options.length).fill(0),
    p1Order: hintOrder(ended || p1Options.length === 0 ? [] : optionHints(position, 'p1', p1Options)),
    p2Order: hintOrder(ended || p2Options.length === 0 ? [] : optionHints(position, 'p2', p2Options)),
    visits: 0,
    children: new Map(),
  };
}

/**
 * UCB pick over one side's decoupled stats. Unvisited options still come
 * first, but only inside the progressive-widening window and best hint
 * first — weak options beyond the window stay closed until the node has
 * earned the visits to afford them.
 */
function pick(n: number[], w: number[], visits: number, maximize: boolean, order: number[]): number {
  const window = wideningWindow(n.length, visits);
  let best = -1;
  let bestScore = -Infinity;
  for (let rank = 0; rank < order.length; rank++) {
    const index = order[rank];
    if (n[index] === 0) {
      if (rank < window) return index;
      continue;
    }
    const mean = w[index] / n[index];
    const exploit = maximize ? mean : -mean;
    const score = exploit + EXPLORATION * Math.sqrt(Math.log(visits + 1) / n[index]);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}

function principalVariation(node: Node): { p1: string; p2: string }[] {
  const steps: { p1: string; p2: string }[] = [];
  let current = node;
  for (let step = 0; step < PV_MAX_STEPS; step++) {
    if (current.ended || current.p1Options.length === 0 || current.p2Options.length === 0) break;
    let bestKey = -1;
    let bestVisits = 0;
    let bestI = 0;
    let bestJ = 0;
    for (const [key, child] of current.children) {
      if (child.visits > bestVisits) {
        bestVisits = child.visits;
        bestKey = key;
        bestI = Math.floor(key / 10_000);
        bestJ = key % 10_000;
      }
    }
    if (bestKey < 0 || bestVisits < PV_MIN_VISITS) break;
    steps.push({ p1: current.p1Options[bestI].label, p2: current.p2Options[bestJ].label });
    current = current.children.get(bestKey)!;
  }
  return steps;
}

/**
 * Tree-informed root cell: the mean of every leaf value backed through the
 * cell (a child's own p1W marginals sum to its pass-through reward; its
 * creation-time static covers the expansion pass) blended with ONE extra
 * static-prior visit — the selection-over-noise guard, so a single wild
 * playout cannot own a cell. Unexpanded cells fall back to the root static.
 */
function treeCellValue(root: Node, i: number, j: number): number {
  const child = root.children.get(cellKey(i, j));
  if (!child) return root.value;
  const total = child.p1W.reduce((sum, w) => sum + w, 0) + child.value;
  return (total + child.value) / (child.visits + 1);
}

/** Most-visited index (ties keep the lower index — the old rank order). */
function topVisitedIndex(n: number[]): number {
  let best = -1;
  let bestN = 0;
  for (let index = 0; index < n.length; index++) {
    if (n[index] > bestN) {
      bestN = n[index];
      best = index;
    }
  }
  return best;
}

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
  const values = root.p1Options.map((_, i) =>
    root.p2Options.map((_, j) => treeCellValue(root, i, j)));
  const ended = root.p1Options.map((_, i) =>
    root.p2Options.map((_, j) => root.children.get(cellKey(i, j))?.ended ?? false));
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
  if (koOdds) {
    // Mirrors attachKoOdds in search.ts:736 — rows are ranked (reordered),
    // so match by choice string, attach only real events.
    const maps = {
      p1: new Map(root.p1Options.map((option, index) => [option.choice, koOdds.p1[index] ?? null])),
      p2: new Map(root.p2Options.map((option, index) => [option.choice, koOdds.p2[index] ?? null])),
    };
    for (const side of ['p1', 'p2'] as const) {
      for (const row of result.perSide[side]) {
        const odds = maps[side].get(row.choice);
        if (odds) row.koOdds = odds;
      }
    }
  }
  // Round 13: root narrative payload, same contract as search.ts.
  if (unanswered && (unanswered.p1.length > 0 || unanswered.p2.length > 0 ||
    (unanswered.p1Entry?.length ?? 0) > 0 || (unanswered.p2Entry?.length ?? 0) > 0 ||
    unanswered.decided !== undefined || unanswered.nearDecided !== undefined)) result.unanswered = unanswered;
  return result;
}

function runMcts(
  serializedBattle: string,
  settings: EvalSettings,
  callbacks?: MctsCallbacks,
  seedOffset = 0,
): { root: Node; maxDepth: number; result: EvalResult; koOdds?: RootKoOdds } {
  const matchupCache = createMatchupCache();
  const tera = settings.tera ?? true;
  // keepPlayed applies to the root only — children have their own spaces.
  const root = makeNode(createRootPosition(serializedBattle), tera, matchupCache, settings.keepPlayed, settings.sleepClause);
  if (root.ended || root.p1Options.length === 0 || root.p2Options.length === 0) {
    return {
      root,
      maxDepth: 1,
      result: { score: root.value, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } },
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

  let maxDepth = 1;
  for (let iteration = 0; iteration < MCTS_ITERATIONS; iteration++) {
    if (callbacks?.shouldStop?.()) break;

    // Selection: descend through existing children via decoupled UCB.
    const path: { node: Node; i: number; j: number }[] = [];
    let node = root;
    let leafValue = node.value;
    let depth = 1;
    for (;;) {
      if (node.ended || node.p1Options.length === 0 || node.p2Options.length === 0) {
        leafValue = node.value;
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
        const position = advancePosition(node.position, node.p1Options[i].choice, node.p2Options[j].choice, seed);
        child = makeNode(position, tera, matchupCache, undefined, settings.sleepClause);
        node.children.set(key, child);
        leafValue = child.value;
        child.visits += 1;
        depth += 1;
        break;
      }
      node = child;
      depth += 1;
    }
    maxDepth = Math.max(maxDepth, depth);

    // Backpropagation along the joint path.
    for (const step of path) {
      step.node.visits += 1;
      step.node.p1N[step.i] += 1;
      step.node.p1W[step.i] += leafValue;
      step.node.p2N[step.j] += 1;
      step.node.p2W[step.j] += leafValue;
    }

    const done = iteration + 1;
    callbacks?.onProgress?.({ done, total: MCTS_ITERATIONS, depth: maxDepth });
    if (done % PARTIAL_EVERY === 0 && done < MCTS_ITERATIONS) {
      callbacks?.onPartial?.(toResult(root, maxDepth, koOdds, unanswered));
    }
  }

  const result = toResult(root, maxDepth, koOdds, unanswered);
  callbacks?.onPartial?.(result);
  return { root, maxDepth, result, koOdds };
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
  const { root, maxDepth, result, koOdds } = runMcts(serializedBattle, settings, callbacks, seedOffset);
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
    })),
    result,
  };
}
