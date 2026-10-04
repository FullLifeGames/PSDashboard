import { afterEach, expect, test, vi } from 'vitest';
import { configureSearchBudget, SEARCH_BUDGET_DEFAULT, searchBudget } from '@fulllifegames/eval-engine';
import { adoptSearchBudgetStamp, readSearchBudget, SEARCH_BUDGET_STORAGE_KEY } from '../src/lib/eval/search-budget-setting';
import { evalStoreKey, evalStorePrefix } from '../src/lib/eval-cache-store';
import { resolveAutoLeadSettings, resolveAutoTurnSettings } from '../src/hooks/evaluation/prefs';

function stubStorage(values: Record<string, string>): void {
  vi.stubGlobal('localStorage', { getItem: (key: string) => values[key] ?? null, setItem: () => undefined });
}

afterEach(() => { vi.unstubAllGlobals(); configureSearchBudget(null); });

test('the browser switch: missing or a typo means the default, never a crash', () => {
  stubStorage({});
  expect(readSearchBudget()).toEqual(SEARCH_BUDGET_DEFAULT);
  stubStorage({ [SEARCH_BUDGET_STORAGE_KEY]: 'tres=8' });
  expect(readSearchBudget()).toEqual(SEARCH_BUDGET_DEFAULT);
  stubStorage({ [SEARCH_BUDGET_STORAGE_KEY]: 'trees=8' });
  expect(readSearchBudget().trees).toBe(8);
});

test('a stamped message configures the worker, an unstamped one leaves it alone', () => {
  adoptSearchBudgetStamp({ searchBudget: { ...SEARCH_BUDGET_DEFAULT, iterations: 1200 } });
  expect(searchBudget().iterations).toBe(1200);
  adoptSearchBudgetStamp({});
  expect(searchBudget().iterations).toBe(1200);
});

test('cache keys: unchanged at the default, tagged under a form', () => {
  const plain = evalStoreKey('r:1:x', 1, 1, 'matrix', true);
  const prefix = evalStorePrefix('r');
  expect(plain.startsWith('v56|')).toBe(true);
  expect(prefix).toBe('v56|r:');
  configureSearchBudget({ ...SEARCH_BUDGET_DEFAULT, trees: 8 });
  expect(evalStoreKey('r:1:x', 1, 1, 'matrix', true)).toBe(plain.replace(/^v56\|/, 'v56~t8-i600-d1-s1-f0|'));
  expect(evalStorePrefix('r')).toBe('v56~t8-i600-d1-s1-f0|r:');
});

test('the team-preview lead stays on the early matrix under auto, whatever the tree threshold', () => {
  // Round 61 review: the bank never samples turn 0, so the lead keeps the early matrix until a measurement moves it.
  expect(resolveAutoLeadSettings()).toEqual({ depth: 1, samples: 1, mode: 'matrix' });
  configureSearchBudget({ ...SEARCH_BUDGET_DEFAULT, earlyDepth: 2, earlySamples: 3 });
  expect(resolveAutoLeadSettings()).toEqual({ depth: 2, samples: 3, mode: 'matrix' });
});

test('the app resolves auto through the budget', () => {
  // Round 61 default: the tree from the first turn.
  expect(resolveAutoTurnSettings(0)).toEqual({ depth: 1, samples: 1, mode: 'mcts' });
  configureSearchBudget({ ...SEARCH_BUDGET_DEFAULT, treeFrom: 0.25, earlyDepth: 2 });
  expect(resolveAutoTurnSettings(0.1)).toEqual({ depth: 2, samples: 1, mode: 'matrix' });
  expect(resolveAutoTurnSettings(0.5)).toEqual({ depth: 1, samples: 1, mode: 'mcts' });
});
