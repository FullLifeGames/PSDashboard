import { configureSearchBudget, parseSearchBudget, SEARCH_BUDGET_DEFAULT, type SearchBudget } from '@fulllifegames/eval-engine';

/**
 * The search budget's measurement switch, without a UI knob (a key=value list, see the engine's search/budget.ts): the main thread
 * reads it, uses it for the auto resolution and the tree count and stamps it on every worker message (workers have no localStorage);
 * a typo means the default.
 */
export const SEARCH_BUDGET_STORAGE_KEY = 'ps-replay-interceptor:search-budget';

export function readSearchBudget(): SearchBudget {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SEARCH_BUDGET_STORAGE_KEY) : null;
    return parseSearchBudget(raw) ?? SEARCH_BUDGET_DEFAULT;
  } catch {
    // Storage unavailable or a typo in the switch: the default.
    return SEARCH_BUDGET_DEFAULT;
  }
}

/** The budget for this page; configures the main thread's engine on the way. */
export function searchBudgetStamp(): SearchBudget {
  const budget = readSearchBudget();
  configureSearchBudget(budget === SEARCH_BUDGET_DEFAULT ? null : budget);
  return budget;
}

/** The help texts' words for one game type's tree threshold, read from the budget; null = the tree on every turn. */
export function treeThresholdText(split: SearchBudget['singles']): string | null {
  return split.treeFrom <= 0 ? null : `${Math.round(split.treeFrom * 100)}% of all Pokémon have fainted`;
}

export function adoptSearchBudgetStamp(message: { searchBudget?: SearchBudget }): void {
  if (message.searchBudget) configureSearchBudget(message.searchBudget);
}
