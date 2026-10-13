import { FEATURE_WEIGHTS, featureWeights, type EvalFeatures, type StaticRuleset } from './weights.ts';

/**
 * Round 69 (S9, T102, decision 17): the model form of the static. A weight
 * that runs with the game is `base + addend x the share of fainted mons`
 * (the fit prices the addend as the column `<feature>@phase`, g x faintedFraction).
 * Standard singles takes the form on bodies and matchup: fitted on the
 * r69-b0 capture (10,350 positions of 1,363 sets, the table at the S8 state,
 * out of fold better than the table in 20 of 20 seeds, log-loss -21 bp, Brier
 * -7 bp, no flagged band): bodies 148.3 [114, 179] + 232.0 [157, 336] x share,
 * matchup 136.8 [44, 233] + 327.3 [121, 608] x share. The model that put the
 * phase on every priced column (coverage, hazards, boostsBiting) read another
 * 3.6 bp better, in 19 of 20 seeds against this one: short of the pre-registered
 * 20, and with more columns, so this one stands.
 *
 * The status fold rides on the form: `statusFix` weighs what `bodies` weighs
 * (the table's statusFix is the weight of bodies, 200; the form's statusFix is
 * the form's bodies), so a body whose ability changes what a status costs is
 * priced at the phase weight of bodies. The other four families keep their
 * tables. The switch gives the table's score back exactly:
 * `EVAL_STATIC_FORM=0` in Node, `setStaticForm(false)` in a test.
 */
export interface PhaseForm {
  base: Partial<Record<keyof EvalFeatures, number>>;
  phase: Partial<Record<keyof EvalFeatures, number>>;
}

export const STANDARD_SINGLES_FORM: PhaseForm = {
  base: { bodies: 148, matchup: 137, statusFix: 148 },
  phase: { bodies: 232, matchup: 327, statusFix: 232 },
};

/** The form of a game type under a rule set, or null where the family keeps its table. It follows the singles table: a VGC singles game reads both. */
export function phaseFormOf(doubles: boolean, ruleset: StaticRuleset = 'standard'): PhaseForm | null {
  return featureWeights(doubles, ruleset) === FEATURE_WEIGHTS ? STANDARD_SINGLES_FORM : null;
}

/** A form as the terms the score adds to the table's sum: (base - table weight + addend x share) x feature. */
export interface PhaseTerm { key: keyof EvalFeatures; shift: number; addend: number }

export const termsOf = (form: PhaseForm, table: Readonly<Record<keyof EvalFeatures, number>>): PhaseTerm[] =>
  (Object.keys(form.phase) as (keyof EvalFeatures)[]).map(key => ({ key, shift: (form.base[key] ?? table[key]) - table[key], addend: form.phase[key] ?? 0 }));

export const STANDARD_SINGLES_TERMS: readonly PhaseTerm[] = termsOf(STANDARD_SINGLES_FORM, FEATURE_WEIGHTS);

interface ProcessLike { env?: Record<string, string | undefined> }

let override: boolean | null = null;
let resolved: boolean | null = null;

/** Whether the form is on: the test's setStaticForm, else off only under EVAL_STATIC_FORM=0 (read once). */
export function staticFormOn(): boolean {
  if (override !== null) return override;
  resolved ??= (globalThis as { process?: ProcessLike }).process?.env?.EVAL_STATIC_FORM !== '0';
  return resolved;
}

/** Tests and probes: true or false forces the switch, null reads the environment again. */
export function setStaticForm(on: boolean | null): void {
  override = on;
  resolved = null;
}
