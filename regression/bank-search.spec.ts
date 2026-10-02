import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLocalTreeExecutor, searchPosition, searchTreesOrchestrated } from '@fulllifegames/eval-engine';
import { bankSampleCount, bankSearch } from './bank-search';

const fixture = (name: string) =>
  (JSON.parse(readFileSync(`packages/eval-engine/test/fixtures/positions/${name}.json`, 'utf-8')) as { serialized: string }).serialized;

test('auto: below the threshold the bank runs the sync matrix search', async () => {
  const serialized = fixture('gen9ou-2658658993-t2');
  const result = await bankSearch({ serialized, faintedFraction: 0, depth: 1, samples: 1, mode: 'auto', settings: { tera: false } });
  expect(result).toEqual(searchPosition(serialized, { depth: 1, samples: 1, tera: false }));
});

test('auto: at the threshold the bank runs the app tree search', { timeout: 600_000 }, async () => {
  const serialized = fixture('smogtours-gen9ou-749828-t23');
  const result = await bankSearch({ serialized, faintedFraction: 0.5, depth: 1, samples: 1, mode: 'auto', settings: { tera: false } });
  expect(result).toEqual(await searchTreesOrchestrated(createLocalTreeExecutor(serialized), { depth: 1, samples: 1, mode: 'mcts', tera: false }));
});

test('draws per cell: only 1, 3 or 5 (five fixed seeds), anything else throws', () => {
  expect(bankSampleCount(undefined)).toBe(1);
  expect(bankSampleCount('3')).toBe(3);
  expect(bankSampleCount('5')).toBe(5);
  expect(() => bankSampleCount('7')).toThrow(/1, 3 or 5/);
  expect(() => bankSampleCount('2')).toThrow(/1, 3 or 5/);
});
