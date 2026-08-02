import { createMatchupCache, evaluatePosition, type MatchupCache } from './eval-function';
import {
  advancePosition, createRootPosition, positionBattle,
  type ChoiceOption, type SimPosition,
} from './forward-model';
import { cellKey } from './rank';
import { searchOptions, SEARCH_SEEDS } from './search';
import type { EvalResult, EvalSettings, MctsTreeStats, RankedChoice, SearchProgress } from './types';

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

export interface MctsCallbacks {
  onProgress?(progress: SearchProgress): void;
  onPartial?(result: EvalResult): void;
  shouldStop?(): boolean;
}

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
  visits: number;
  children: Map<number, Node>;
}

function makeNode(position: SimPosition, tera: boolean, matchupCache: MatchupCache): Node {
  const battle = positionBattle(position);
  const ended = battle.ended;
  const p1Options = ended ? [] : searchOptions(position, 'p1', { tera });
  const p2Options = ended ? [] : searchOptions(position, 'p2', { tera });
  return {
    position,
    ended,
    value: evaluatePosition(battle, matchupCache),
    p1Options,
    p2Options,
    p1N: new Array(p1Options.length).fill(0),
    p1W: new Array(p1Options.length).fill(0),
    p2N: new Array(p2Options.length).fill(0),
    p2W: new Array(p2Options.length).fill(0),
    visits: 0,
    children: new Map(),
  };
}

/** UCB pick over one side's decoupled stats; unvisited options come first. */
function pick(n: number[], w: number[], visits: number, maximize: boolean): number {
  let best = -1;
  let bestScore = -Infinity;
  for (let index = 0; index < n.length; index++) {
    if (n[index] === 0) return index;
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

function toResult(root: Node, maxDepth: number): EvalResult {
  const rank = (options: ChoiceOption[], n: number[], w: number[], ownSign: 1 | -1): RankedChoice[] =>
    options
      .map((option, index) => ({ option, index }))
      .filter(entry => n[entry.index] > 0)
      .sort((a, b) => n[b.index] - n[a.index] || a.index - b.index)
      .map(entry => {
        const mean = ownSign * (w[entry.index] / n[entry.index]);
        // Most-visited reply within this row/column becomes the punisher.
        let punishedBy: string | null = null;
        let punishVisits = 0;
        for (const [key, child] of root.children) {
          const i = Math.floor(key / 10_000);
          const j = key % 10_000;
          const mine = ownSign === 1 ? i : j;
          if (mine !== entry.index) continue;
          if (child.visits > punishVisits) {
            punishVisits = child.visits;
            punishedBy = ownSign === 1 ? root.p2Options[j].label : root.p1Options[i].label;
          }
        }
        const ranked: RankedChoice = {
          choice: entry.option.choice,
          label: entry.option.label,
          worstCase: mean,
          expected: mean,
          punishedBy,
        };
        return ranked;
      });

  const p1 = rank(root.p1Options, root.p1N, root.p1W, 1);
  const p2 = rank(root.p2Options, root.p2N, root.p2W, -1);
  if (p1.length > 0) {
    const line = principalVariation(root);
    if (line.length > 1) p1[0].line = line.slice(1);
  }

  const v1 = p1.length > 0 ? p1[0].worstCase : root.value;
  const v2 = p2.length > 0 ? -p2[0].worstCase : root.value;
  return {
    score: root.visits > 0 ? (v1 + v2) / 2 : root.value,
    interval: Math.abs(v2 - v1),
    depthCompleted: maxDepth,
    perSide: { p1, p2 },
  };
}

function runMcts(
  serializedBattle: string,
  settings: EvalSettings,
  callbacks?: MctsCallbacks,
  seedOffset = 0,
): { root: Node; maxDepth: number; result: EvalResult } {
  const matchupCache = createMatchupCache();
  const tera = settings.tera ?? true;
  const root = makeNode(createRootPosition(serializedBattle), tera, matchupCache);
  if (root.ended || root.p1Options.length === 0 || root.p2Options.length === 0) {
    return {
      root,
      maxDepth: 1,
      result: { score: root.value, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } },
    };
  }

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
      const i = pick(node.p1N, node.p1W, node.visits, true);
      const j = pick(node.p2N, node.p2W, node.visits, false);
      path.push({ node, i, j });
      const key = cellKey(i, j);
      let child = node.children.get(key);
      if (!child) {
        // Expansion: the cell's chance outcome is fixed at creation time.
        // The offset rotates the seed schedule so parallel trees explore
        // different chance outcomes.
        const seed = SEARCH_SEEDS[(iteration + seedOffset) % SEARCH_SEEDS.length];
        const position = advancePosition(node.position, node.p1Options[i].choice, node.p2Options[j].choice, seed);
        child = makeNode(position, tera, matchupCache);
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
      callbacks?.onPartial?.(toResult(root, maxDepth));
    }
  }

  const result = toResult(root, maxDepth);
  callbacks?.onPartial?.(result);
  return { root, maxDepth, result };
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
  const { root, maxDepth, result } = runMcts(serializedBattle, settings, callbacks, seedOffset);
  return {
    p1Options: root.p1Options.map(option => ({ choice: option.choice, label: option.label })),
    p2Options: root.p2Options.map(option => ({ choice: option.choice, label: option.label })),
    p1N: root.p1N,
    p1W: root.p1W,
    p2N: root.p2N,
    p2W: root.p2W,
    visits: root.visits,
    depth: maxDepth,
    result,
  };
}
