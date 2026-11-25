import { describe, expect, test } from 'vitest';
import { upgradeChecks } from '../../scripts/upgrade-pkmn.mjs';

// A plain run plays a sample of the dice sweeps, so the checks name the full ones (`DICE_SWEEPS=full`).
describe('the checks the upgrade script prints', () => {
  const text = upgradeChecks('0.10.9');

  test('they name the full dice sweeps with the command that runs them', () => {
    expect(text).toContain('DICE_SWEEPS=full npx vitest run --project eval-engine packages/eval-engine/test/dice-');
  });

  test('they name the other full sweeps, which the job "Full sweeps, the other specs" runs in three parts', () => {
    expect(text).toContain('Full sweeps, the other specs');
    expect(text).toContain('.github/workflows/test.yml');
  });

  test('they keep the checks they had', () => {
    expect(text).toContain('The @pkmn train stands at 0.10.9');
    expect(text).toContain('harden the speed layer for it (hash gate, census over Gen 1 to 9)');
    expect(text).not.toMatch(/\bT\d+\b|#\d+/);
    expect(text).toContain('EVAL_SIM_FAST=0 and EVAL_SIM_FAST=1');
    expect(text).toContain('batch check');
  });
});
