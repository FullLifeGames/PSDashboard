import { existsSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { context, observations } from './correction-identity';
import { CORPUS, rebuildThrough } from './rebuild-through';

vi.mock('../../packages/eval-engine/src/branch/corrections.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../../packages/eval-engine/src/branch/corrections')>();
  const { observed } = await import('./correction-identity');
  return { ...original, correctActivesFromProtocol: observed(original.correctActivesFromProtocol as never) as never };
});

interface Row { family: string; id: string; turn: number; what: string }
const ROWS: Row[] = [
  { family: 'singles', id: 'smogtours-gen6ubers-902024', turn: 23, what: 'Ditto copies Darkrai behind a Ho-Oh that falls on arrival' },
  { family: 'singles', id: 'smogtours-gen9uu-809612', turn: 7, what: 'Ditto copies the foe after a faint' },
  { family: 'singles', id: 'gen9ou-2662174231', turn: 1, what: 'a start after the second entry' },
  { family: 'Doubles OU', id: 'gen9doublesou-2693875773', turn: 2, what: 'a start of the final entrant' },
  { family: 'Doubles OU', id: 'gen9doublesou-2695095953', turn: 2, what: 'a boost of the final entrant' },
  { family: 'VGC SV', id: 'gen9vgc2025regg-2323897611', turn: 2, what: 'Ditto copies in the second slot' },
  { family: 'VGC SV', id: 'gen9vgc2026regf-2523931924', turn: 1, what: 'a boost of the final entrant' },
  { family: 'Champions OU', id: 'gen9championsou-2693919298', turn: 5, what: 'a start of the final entrant' },
  { family: 'Champions OU', id: 'gen9championsou-2693056518', turn: 15, what: 'Ditto copies the foe' },
  { family: 'Champions VGC', id: 'gen9championsvgc2026regmc-2688660543', turn: 2, what: 'a boost of the final entrant' },
  { family: 'Champions VGC', id: 'gen9championsvgc2026regmc-2692161644', turn: 2, what: 'a boost in the second slot' },
];

describe('the correction of a block changes nothing on a board that already matches the log', () => {
  for (const row of ROWS) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.family} ${row.id} turn ${row.turn}: ${row.what}`, async () => {
      observations.length = 0;
      context.game = row.id;
      await rebuildThrough(row.id, row.turn);
      const passing = observations.filter(seen => seen.passing);
      expect(passing.length, 'the rebuild reaches the census block').toBeGreaterThan(0);
      expect(passing.filter(seen => seen.matched).length, 'a block the simulator already played').toBeGreaterThan(0);
      expect(passing.filter(seen => seen.matched).flatMap(seen => seen.differences.map(difference => `turn ${seen.turn}: ${difference}`))).toEqual([]);
    }, 300_000);
  }
});
