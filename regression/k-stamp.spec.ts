import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { parseKTable } from './fit-families';

/**
 * Round 74 (T163): the K stamp of a capture (EVAL_FIT_ROOT_K) comes from the code, scripts/k-stamp.mjs, never from
 * a hand. The root-scale report refuses a capture whose stamp differs from today's table. The stamp script calls the
 * leaf's own resolver (winprobK); packages/eval-engine/test/eval-winprob.spec.ts pins that resolver's five family
 * values, and this spec pins the stamp to the same five, so the three agree. Root specs do not import package
 * sources, hence the literals.
 */
describe('scripts/k-stamp.mjs writes the K table the leaf resolves', () => {
  const run = () => spawnSync(process.execPath, ['scripts/k-stamp.mjs'], { cwd: process.cwd(), encoding: 'utf8' });

  test('parseKTable reads the stamp for every rule set and game type', () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    const stamp = parseKTable(result.stdout);
    for (const ruleset of ['standard', 'vgc', 'champions'] as const) {
      for (const gameType of ['singles', 'doubles'] as const) expect(stamp(ruleset)[gameType], `${ruleset} ${gameType}`).toEqual(JSON.parse(result.stdout)[ruleset][gameType]);
    }
  });

  test('the stamp holds the five candidate family values', () => {
    const stamp = JSON.parse(run().stdout);
    expect(stamp).toEqual({
      standard: { singles: { k0: 2.81, k1: 0.8 }, doubles: { k0: 2.95, k1: 1.11 } },
      vgc: { singles: { k0: 2.28, k1: 1.49 }, doubles: { k0: 2.09, k1: 1.13 } },
      champions: { singles: { k0: 2.05, k1: 3.22 }, doubles: { k0: 1.8, k1: 3.07 } },
    });
  });
});
