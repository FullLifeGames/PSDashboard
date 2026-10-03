import { configureSearchBudget, parseSearchBudget, SEARCH_BUDGET_DEFAULT, type SearchBudget } from '@fulllifegames/eval-engine';

/**
 * Round 61: the search budget's measurement switch, without a UI knob (a
 * key=value list, see the engine's search/budget.ts). The main thread reads
 * it, uses it for the auto resolution and the tree count, and stamps it on
 * every worker message (workers have no localStorage). A typo means the
 * default.
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

/** Worker side: a stamped message reconfigures the worker; an unstamped one leaves it alone. */
export function adoptSearchBudgetStamp(message: { searchBudget?: SearchBudget }): void {
  if (message.searchBudget) configureSearchBudget(message.searchBudget);
}
