import { readFileSync, readdirSync } from 'fs';
import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * Round 82 (forced dice), step A7d (gate answer 1b): the full dice sweeps run only with `DICE_SWEEPS=full`. Without it
 * `sweepSelection` hands every sweep the same small sample of its list, so a plain run and the CI jobs of the engine project
 * stay light and still play every sweep. Every sweep file takes its moves and rows through it.
 */

async function fixtures(mode: string | undefined) {
  vi.resetModules();
  if (mode === undefined) vi.unstubAllEnvs();
  else vi.stubEnv('DICE_SWEEPS', mode);
  return import('./dice-fixtures');
}

afterEach(() => vi.unstubAllEnvs());

const LIST = Array.from({ length: 100 }, (_, index) => `item${index}`);

describe('sweepSelection', () => {
  test('without the variable it gives a fixed small sample of a long list, spread over the list', async () => {
    const { sweepSelection, SWEEPS_FULL } = await fixtures(undefined);
    expect(SWEEPS_FULL).toBe(false);
    const sample = sweepSelection(LIST, 'moves');
    expect(sample.length).toBeGreaterThan(0);
    expect(sample.length).toBeLessThanOrEqual(8);
    expect(sample.every(item => LIST.includes(item))).toBe(true);
    expect(new Set(sample).size).toBe(sample.length);
    expect(sample).toEqual(LIST.filter(item => sample.includes(item)));
    expect(LIST.indexOf(sample[sample.length - 1]) - LIST.indexOf(sample[0])).toBeGreaterThan(LIST.length / 2);
    expect(sweepSelection(LIST, 'moves')).toEqual(sample);
    expect(sweepSelection([...LIST], 'moves')).toEqual(sample);
  });

  test('a short list stays whole, and an empty one stays empty', async () => {
    const { sweepSelection } = await fixtures(undefined);
    expect(sweepSelection(['a', 'b'], 'moves')).toEqual(['a', 'b']);
    expect(sweepSelection([], 'moves')).toEqual([]);
  });

  test('every named list has a sample, the seeds and the rows too', async () => {
    const { sweepSelection } = await fixtures(undefined);
    for (const sweep of ['moves', 'rows', 'seeds']) expect(sweepSelection(LIST, sweep).length, sweep).toBeLessThan(LIST.length);
  });

  test('a call with no sweep name gives the whole list (the census checks read it so)', async () => {
    const { sweepSelection } = await fixtures(undefined);
    expect(sweepSelection(LIST)).toEqual(LIST);
  });

  test('with DICE_SWEEPS=full every list stays whole', async () => {
    const { sweepSelection, SWEEPS_FULL } = await fixtures('full');
    expect(SWEEPS_FULL).toBe(true);
    for (const sweep of ['moves', 'rows', 'seeds']) expect(sweepSelection(LIST, sweep)).toEqual(LIST);
  });

  test('any other value of the variable is no full run', async () => {
    const { SWEEPS_FULL } = await fixtures('1');
    expect(SWEEPS_FULL).toBe(false);
  });
});

describe('every sweep takes its lists through sweepSelection', () => {
  const dir = new URL('./', import.meta.url);
  const files = readdirSync(dir).filter(name => /^dice-.*(sweep|offer).*\.spec\.ts$/.test(name) && name !== 'dice-sweep-selection.spec.ts');
  const source = (name: string): string => readFileSync(new URL(name, dir), 'utf-8');

  test('the sweep files are all found', () => {
    expect(files).toEqual(expect.arrayContaining([
      'dice-ability-sweep.spec.ts', 'dice-accuracy-sweep.spec.ts', 'dice-crit-sweep.spec.ts', 'dice-end-sweep.spec.ts', 'dice-hits-sweep.spec.ts',
      'dice-offer.spec.ts', 'dice-offer-order.spec.ts', 'dice-offer-turn.spec.ts', 'dice-order-sweep.spec.ts', 'dice-roll-sweep.spec.ts',
      'dice-secondary-sweep.spec.ts', 'dice-stall-sweep.spec.ts', 'dice-status-sweep.spec.ts',
    ]));
  });

  test.each(files)('%s names no Dex list of its own and reads its moves or rows through the selection', name => {
    const text = source(name);
    expect(text, `${name} walks a Dex list itself`).not.toMatch(/\.(moves|abilities|items|species)\.all\(\)/);
    expect(text, `${name} bypasses the selection`).toMatch(/sweepSelection|sweepMoves|sweepRows|everyTenth/);
  });

  test.each(files.filter(name => /for \(const seed of SEEDS\)|SEEDS\.flatMap/.test(source(name))))('%s walks its seeds through the selection', name => {
    expect(source(name), `${name} walks every seed`).not.toMatch(/for \(const seed of SEEDS\)|SEEDS\.flatMap/);
  });
});
