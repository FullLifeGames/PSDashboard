import { AUTO_MCTS_FAINTED_FRACTION } from '../types.ts';

/**
 * Round 61 (T97, T98): every search budget the round measures, one object
 * for the app and the bank. The default is the search before round 61. A
 * measurement switch without a UI knob picks a form: EVAL_SEARCH_BUDGET
 * under Node, the localStorage key ps-replay-interceptor:search-budget in
 * the browser (stamped on every worker message). Syntax: a comma list of
 * key=value over the default (trees, iterations, early-depth,
 * early-samples, tree-from).
 */
export interface SearchBudget {
  /** Trees of the tree search (root parallelization). */
  trees: number;
  /** Iterations per tree. */
  iterations: number;
  /** Matrix depth of auto turns below treeFrom. */
  earlyDepth: 1 | 2 | 3;
  /** Draws per cell of auto turns below treeFrom (five fixed seeds). */
  earlySamples: 1 | 3 | 5;
  /** Fainted fraction from which auto turns run the tree. */
  treeFrom: number;
}

export const SEARCH_BUDGET_DEFAULT: SearchBudget = {
  trees: 4, iterations: 600, earlyDepth: 1, earlySamples: 1, treeFrom: AUTO_MCTS_FAINTED_FRACTION,
};

/** Each switch key: the field it sets and the values it accepts (draws stay within the five fixed seeds). */
const RULES: Record<string, { field: keyof SearchBudget; accepts(value: number): boolean }> = {
  trees: { field: 'trees', accepts: value => Number.isInteger(value) && value >= 1 && value <= 64 },
  iterations: { field: 'iterations', accepts: value => Number.isInteger(value) && value >= 50 && value <= 20_000 },
  'early-depth': { field: 'earlyDepth', accepts: value => value === 1 || value === 2 || value === 3 },
  'early-samples': { field: 'earlySamples', accepts: value => value === 1 || value === 3 || value === 5 },
  'tree-from': { field: 'treeFrom', accepts: value => value >= 0 && value <= 1 },
};

/** null for a missing or empty switch; a typo or an out-of-range value throws. */
export function parseSearchBudget(raw: string | null | undefined): SearchBudget | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const budget: Record<keyof SearchBudget, number> = { ...SEARCH_BUDGET_DEFAULT };
  for (const part of raw.split(',')) {
    const [key, text] = part.split('=').map(piece => piece.trim());
    if (!Object.hasOwn(RULES, key)) throw new Error(`search budget: unknown key ${key} in "${raw}"`);
    const value = text ? Number(text) : Number.NaN;
    if (!RULES[key].accepts(value)) throw new Error(`search budget: ${key}=${text ?? ''} is out of range in "${raw}"`);
    budget[RULES[key].field] = value;
  }
  return budget as SearchBudget;
}

let current: SearchBudget | null = null;
let configured = false;

const nodeEnv = (): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EVAL_SEARCH_BUDGET;

/** The host's choice; null = the default. */
export function configureSearchBudget(next: SearchBudget | null): void {
  configured = true;
  current = next;
}

/** The budget in force; an unconfigured Node host reads EVAL_SEARCH_BUDGET once. */
export function searchBudget(): SearchBudget {
  if (!configured) configureSearchBudget(parseSearchBudget(nodeEnv()));
  return current ?? SEARCH_BUDGET_DEFAULT;
}

/** '' at the default, so stored results keep their keys; a form gets its own tag. */
export function searchBudgetTag(): string {
  const budget = searchBudget();
  if (JSON.stringify(budget) === JSON.stringify(SEARCH_BUDGET_DEFAULT)) return '';
  return `t${budget.trees}-i${budget.iterations}-d${budget.earlyDepth}-s${budget.earlySamples}-f${budget.treeFrom}`;
}

/** The auto mode at one position: the early matrix below treeFrom, the tree at or above. */
export function autoTurnSettings(faintedFraction: number): { depth: 1 | 2 | 3; samples: 1 | 3 | 5; mode: 'matrix' | 'mcts' } {
  const budget = searchBudget();
  return faintedFraction >= budget.treeFrom
    ? { depth: 1, samples: 1, mode: 'mcts' }
    : { depth: budget.earlyDepth, samples: budget.earlySamples, mode: 'matrix' };
}
