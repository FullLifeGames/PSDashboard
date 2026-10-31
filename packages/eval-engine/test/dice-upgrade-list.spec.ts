import { describe, expect, test } from 'vitest';
import { upgradeChecks } from '../../../scripts/upgrade-pkmn.mjs';

/**
 * Round 82 (forced dice), step A7d (gate answer 1b): a plain run plays a sample of the dice sweeps, so the checks a new
 * simulator needs before it ships name the full ones (`DICE_SWEEPS=full`), which read every move of every rule set.
 */
describe('the checks the upgrade script prints', () => {
  const text = upgradeChecks('0.10.9');

  test('they name the full dice sweeps with the command that runs them', () => {
    expect(text).toContain('DICE_SWEEPS=full npx vitest run --project eval-engine packages/eval-engine/test/dice-');
  });

  test('they keep the checks they had', () => {
    expect(text).toContain('The @pkmn train stands at 0.10.9');
    expect(text).toContain('T103');
    expect(text).toContain('EVAL_SIM_FAST=0 and EVAL_SIM_FAST=1');
    expect(text).toContain('batch check');
  });
});
