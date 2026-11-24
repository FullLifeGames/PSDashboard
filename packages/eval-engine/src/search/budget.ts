import { AUTO_MCTS_FAINTED_FRACTION } from '../types.ts';

// A measurement switch: EVAL_SEARCH_BUDGET under Node, localStorage ps-replay-interceptor:search-budget in the browser.

/** The auto mode of one game type: below treeFrom the matrix, at or above it the tree. */
export interface AutoSplit {
  earlyDepth: 1 | 2 | 3;
  earlySamples: 1 | 3 | 5;
  /** Fainted fraction from which auto turns run the tree. */
  treeFrom: number;
}

/** Every search budget a measurement varies: trees, iterations, the auto split per game type, the team-preview lead. */
export interface SearchBudget {
  trees: number;
  iterations: number;
  singles: AutoSplit;
  doubles: AutoSplit;
  /** The team-preview lead under auto: the matrix in both game types, which no early split moves. */
  lead: { depth: 1 | 2 | 3; samples: 1 | 3 | 5 };
}

/** The default: doubles run the tree from turn one, singles the three-draw matrix until a quarter of bodies fell. */
export const SEARCH_BUDGET_DEFAULT: SearchBudget = {
  trees: 4, iterations: 600,
  singles: { earlyDepth: 1, earlySamples: 3, treeFrom: AUTO_MCTS_FAINTED_FRACTION },
  doubles: { earlyDepth: 1, earlySamples: 1, treeFrom: 0 },
  lead: { depth: 1, samples: 1 },
};

type Rule = { accepts(value: number): boolean; set(budget: SearchBudget, value: number): void };

const isDepth = (value: number) => value === 1 || value === 2 || value === 3;
const isDraws = (value: number) => value === 1 || value === 3 || value === 5;
const isFraction = (value: number) => value >= 0 && value <= 1;

const SPLIT_RULES: Record<string, { field: keyof AutoSplit; accepts(value: number): boolean }> = {
  'early-depth': { field: 'earlyDepth', accepts: isDepth },
  'early-samples': { field: 'earlySamples', accepts: isDraws },
  'tree-from': { field: 'treeFrom', accepts: isFraction },
};

const RULES: Record<string, Rule> = {
  trees: { accepts: value => Number.isInteger(value) && value >= 1 && value <= 64, set: (budget, value) => { budget.trees = value; } },
  iterations: { accepts: value => Number.isInteger(value) && value >= 50 && value <= 20_000, set: (budget, value) => { budget.iterations = value; } },
  'lead-depth': { accepts: isDepth, set: (budget, value) => { budget.lead.depth = value as 1 | 2 | 3; } },
  'lead-samples': { accepts: isDraws, set: (budget, value) => { budget.lead.samples = value as 1 | 3 | 5; } },
};
for (const [key, { field, accepts }] of Object.entries(SPLIT_RULES)) {
  const setIn = (split: AutoSplit, value: number) => { Object.assign(split, { [field]: value }); };
  RULES[key] = { accepts, set: (budget, value) => { setIn(budget.singles, value); setIn(budget.doubles, value); } };
  RULES[`singles-${key}`] = { accepts, set: (budget, value) => setIn(budget.singles, value) };
  RULES[`doubles-${key}`] = { accepts, set: (budget, value) => setIn(budget.doubles, value) };
}

const copyBudget = (budget: SearchBudget): SearchBudget => ({
  ...budget, singles: { ...budget.singles }, doubles: { ...budget.doubles }, lead: { ...budget.lead },
});

/** null for a missing or empty switch; a typo or an out-of-range value throws. */
export function parseSearchBudget(raw: string | null | undefined): SearchBudget | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const budget = copyBudget(SEARCH_BUDGET_DEFAULT);
  for (const part of raw.split(',')) {
    const [key, text] = part.split('=').map(piece => piece.trim());
    if (!Object.hasOwn(RULES, key)) throw new Error(`search budget: unknown key ${key} in "${raw}"`);
    const value = text ? Number(text) : Number.NaN;
    if (!RULES[key].accepts(value)) throw new Error(`search budget: ${key}=${text ?? ''} is out of range in "${raw}"`);
    RULES[key].set(budget, value);
  }
  return budget;
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

const splitTag = (split: AutoSplit) => `${split.earlyDepth}.${split.earlySamples}.${split.treeFrom}`;
// Field by field, so key order never makes two equal budgets differ.
const budgetTag = (budget: SearchBudget) =>
  `t${budget.trees}-i${budget.iterations}-s${splitTag(budget.singles)}-d${splitTag(budget.doubles)}-l${budget.lead.depth}.${budget.lead.samples}`;

/** '' at the default, so stored results keep their keys; a form gets its own tag. */
export function searchBudgetTag(): string {
  const tag = budgetTag(searchBudget());
  return tag === budgetTag(SEARCH_BUDGET_DEFAULT) ? '' : tag;
}

export function autoTurnSettings(faintedFraction: number, doubles: boolean): { depth: 1 | 2 | 3; samples: 1 | 3 | 5; mode: 'matrix' | 'mcts' } {
  const split = doubles ? searchBudget().doubles : searchBudget().singles;
  return faintedFraction >= split.treeFrom
    ? { depth: 1, samples: 1, mode: 'mcts' }
    : { depth: split.earlyDepth, samples: split.earlySamples, mode: 'matrix' };
}
