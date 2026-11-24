import { configureSearchBudget, parseSearchBudget, SEARCH_BUDGET_DEFAULT, type SearchBudget } from '@fulllifegames/eval-engine';

/** The search budget's measurement switch (key=value list, see search/budget.ts); a typo means the default. */
// Workers have no localStorage: the main thread reads the switch and stamps it on every worker message.
export const SEARCH_BUDGET_STORAGE_KEY = 'ps-replay-interceptor:search-budget';

export function readSearchBudget(): SearchBudget {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SEARCH_BUDGET_STORAGE_KEY) : null;
    return parseSearchBudget(raw) ?? SEARCH_BUDGET_DEFAULT;
  } catch {
    return SEARCH_BUDGET_DEFAULT;
  }
}

/** The budget for this page; configures the main thread's engine on the way. */
export function searchBudgetStamp(): SearchBudget {
  const budget = readSearchBudget();
  configureSearchBudget(budget === SEARCH_BUDGET_DEFAULT ? null : budget);
  return budget;
}

export function treeThresholdText(split: SearchBudget['singles']): string | null {
  return split.treeFrom <= 0 ? null : `${Math.round(split.treeFrom * 100)}% of all Pokémon have fainted`;
}

export function adoptSearchBudgetStamp(message: { searchBudget?: SearchBudget }): void {
  if (message.searchBudget) configureSearchBudget(message.searchBudget);
}
