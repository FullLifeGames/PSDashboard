import type { PRNGSeed } from '@pkmn/sim';
import {
  createMatchupCache, evaluatePosition, pairThreat, singleMoveFraction, type MatchupCache,
} from './eval-function';
import {
  advancePosition, createRootPosition, legalChoices, positionBattle,
  type ChoiceOption, type SimPosition,
} from './forward-model';
import {
  attachLines, cellKey, rankFromMatrix, selectExpansionCells, toResult, TOP_EXPANSION,
  type PvStep, type Ranked, type ValueMatrix,
} from './rank';
import type { CellValue, SearchExecutor } from './orchestrator';
import type { EvalResult, EvalSettings, RankedChoice, SearchProgress } from './types';

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
}

function countFainted(battle: ReturnType<typeof positionBattle>): number {
  return battle.sides[0].pokemon.filter(p => p.fainted).length +
    battle.sides[1].pokemon.filter(p => p.fainted).length;
}

/**
 * Damage-roll grouping (foul-play style): a cell where nothing fainted is
 * roll-insensitive — one sim suffices. Only cells where a KO happened get
 * the full seed spread, because that's where rolls change the outcome. An
 * already-ended child is exact (±1) and also samples once.
 */
function sampleCell(
  root: SimPosition,
  rootFainted: number,
  p1Choice: string,
  p2Choice: string,
  samples: number,
  matchupCache: MatchupCache,
): { value: number; ended: boolean; firstChild: SimPosition } {
  const firstChild = advancePosition(root, p1Choice, p2Choice, SEARCH_SEEDS[0]);
  const firstBattle = positionBattle(firstChild);
  const ended = firstBattle.ended;
  let sum = evaluatePosition(firstBattle, matchupCache);
  const draws = !ended && countFainted(firstBattle) > rootFainted ? samples : 1;
  for (let s = 1; s < draws; s++) {
    const child = advancePosition(root, p1Choice, p2Choice, SEARCH_SEEDS[s]);
    sum += evaluatePosition(positionBattle(child), matchupCache);
  }
  return { value: sum / draws, ended, firstChild };
}

/** Sub-matrix cap for candidate restriction (base moves always survive). */
export const RESTRICT_K = 8;

/**
 * Caps a wide option list for deep sub-searches: every base move is kept
 * (cheap insurance against proxy blind spots like fixed-damage moves), and
 * Tera variants plus switches compete for the remaining slots by static
 * threat hints. Deterministic; an approximation by design — never applied
 * to the top-level matrix the user sees.
 */
function restrictOptions(position: SimPosition, side: 'p1' | 'p2', options: ChoiceOption[]): ChoiceOption[] {
  if (options.length <= RESTRICT_K) return options;
  const battle = positionBattle(position);
  const sideState = battle.sides[side === 'p1' ? 0 : 1];
  const opponent = battle.sides[side === 'p1' ? 1 : 0].active[0];
  const active = sideState.active[0];

  const isBaseMove = (option: ChoiceOption) =>
    option.choice.startsWith('move ') && !option.choice.endsWith(' terastallize');
  const baseMoves = options.filter(isBaseMove);
  const rest = options.filter(option => !isBaseMove(option));

  const hint = (option: ChoiceOption): number => {
    if (!opponent || opponent.fainted) return 0;
    if (option.choice.startsWith('move ')) {
      if (!active || active.fainted) return 0;
      return singleMoveFraction(active, opponent, option.choice.split(' ')[1], battle);
    }
    const slot = parseInt(option.choice.split(' ')[1], 10);
    const candidate = sideState.pokemon[slot - 1];
    if (!candidate) return 0;
    return pairThreat(candidate, opponent, battle).fraction - pairThreat(opponent, candidate, battle).fraction;
  };

  const kept = rest
    .map((option, index) => ({ option, index, value: hint(option) }))
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
): Matrix {
  const rootFainted = countFainted(positionBattle(position));
  const values: number[][] = [];
  const ended: boolean[][] = [];
  const children: SimPosition[][] = [];

  for (let i = 0; i < p1Options.length; i++) {
    values.push([]);
    ended.push([]);
    children.push([]);
    for (let j = 0; j < p2Options.length; j++) {
      const cell = sampleCell(position, rootFainted, p1Options[i].choice, p2Options[j].choice, samples, matchupCache);
      values[i].push(cell.value);
      ended[i].push(cell.ended);
      children[i].push(cell.firstChild);
      progress.done += 1;
      callbacks?.onProgress?.({ done: progress.done, total: progress.total, depth });
    }
  }

  return { p1Options, p2Options, values, ended, children };
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
    return { score: evaluatePosition(battle, matchupCache), interval: 0, depthCompleted: settings.depth, perSide: { p1: [], p2: [] } };
  }
  const tera = settings.tera ?? true;
  const p1Options = legalChoices(root, 'p1', { tera });
  const p2Options = legalChoices(root, 'p2', { tera });
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

  const p1Top: RankedChoice = {
    choice: p1Options[bestI].choice, label: p1Options[bestI].label,
    worstCase: v1, expected: v1, punishedBy: p2Options[bestIPunish].label,
  };
  const p2Top: RankedChoice = {
    choice: p2Options[bestJ].choice, label: p2Options[bestJ].label,
    worstCase: -v2, expected: -v2, punishedBy: p1Options[bestJPunish].label,
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
    const score = evaluatePosition(battle, matchupCache);
    return { score, interval: 0, depthCompleted: settings.depth, perSide: { p1: [], p2: [] } };
  }

  const rootValue = evaluatePosition(battle, matchupCache);
  const tera = settings.tera ?? true;
  let p1Options = legalChoices(root, 'p1', { tera });
  let p2Options = legalChoices(root, 'p2', { tera });
  if (restrictCandidates) {
    p1Options = restrictOptions(root, 'p1', p1Options);
    p2Options = restrictOptions(root, 'p2', p2Options);
  }
  const progress = { done: 0, total: Math.max(p1Options.length * p2Options.length, 1) };

  const matrix = buildMatrix(root, p1Options, p2Options, settings.samples, 1, callbacks, progress, matchupCache);
  let ranked: Ranked = rankFromMatrix(matrix, rootValue);
  let result = toResult(ranked, 1);
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
        const sub = subSearch(child.serialized, { ...settings, depth: (depth - 1) as 1 | 2, samples: 1 }, matchupCache);
        matrix.values[i][j] = sub.score;
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
    callbacks?.onPartial?.(result);
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
    async choices(tera) {
      const battle = positionBattle(root);
      return {
        p1: legalChoices(root, 'p1', { tera }),
        p2: legalChoices(root, 'p2', { tera }),
        rootValue: evaluatePosition(battle, matchupCache),
        rootEnded: battle.ended,
      };
    },
    async evalCells(jobs, onDone) {
      const out: CellValue[] = [];
      const rootFainted = countFainted(positionBattle(root));
      let completed = 0;
      for (const job of jobs) {
        const cell = sampleCell(root, rootFainted, job.p1Choice, job.p2Choice, job.samples, matchupCache);
        out.push({ i: job.i, j: job.j, value: cell.value, ended: cell.ended });
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
