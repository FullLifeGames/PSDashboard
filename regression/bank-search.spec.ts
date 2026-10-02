import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLocalTreeExecutor, searchPosition, searchTreesOrchestrated } from '@fulllifegames/eval-engine';
import { bankSampleCount, bankSearch, bankSettings } from './bank-search';

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

const header = (format: string) => `|gametype|singles\n|gen|9\n|tier|[Gen 9] ${format}\n|player|p1|A|\n|player|p2|B|\n`;

test('Tera like the app: no click -> none, ladder click -> everyone, draft click -> only the species that clicked', () => {
  const noClick = header('OU') + '|switch|p1a: Chomp|Garchomp, M|100/100\n';
  const click = noClick + '|-terastallize|p1a: Chomp|Fire\n';
  expect(bankSettings({ id: 'gen9ou-1', formatid: 'gen9ou', log: noClick }).tera).toBe(false);
  expect(bankSettings({ id: 'gen9ou-2', formatid: 'gen9ou', log: click }).tera).toBe(true);
  expect(bankSettings({ id: 'gen9draft-3', formatid: 'gen9draft', log: click }).tera).toEqual({ p1: ['Garchomp'], p2: [] });
});

test('draws per cell: only 1, 3 or 5 (five fixed seeds), anything else throws', () => {
  expect(bankSampleCount(undefined)).toBe(1);
  expect(bankSampleCount('3')).toBe(3);
  expect(bankSampleCount('5')).toBe(5);
  expect(() => bankSampleCount('7')).toThrow(/1, 3 or 5/);
  expect(() => bankSampleCount('2')).toThrow(/1, 3 or 5/);
});
