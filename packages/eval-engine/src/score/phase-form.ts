import { FEATURE_WEIGHTS, featureWeights, type EvalFeatures, type StaticRuleset } from './weights.ts';

/**
 * The model form of the static: a weight that runs with the game is `base + addend x the share of fainted mons` (the fit prices the
 * addend as the column `<feature>@phase`, g x faintedFraction). Standard singles takes it on bodies and matchup; `statusFix` weighs
 * what `bodies` weighs, so a body whose ability changes what a status costs is priced at the phase weight of bodies. The other
 * families keep their tables. `EVAL_STATIC_FORM=0` in Node or `setStaticForm(false)` in a test gives the table's score back exactly.
 */
export interface PhaseForm {
  base: Partial<Record<keyof EvalFeatures, number>>;
  phase: Partial<Record<keyof EvalFeatures, number>>;
}

export const STANDARD_SINGLES_FORM: PhaseForm = {
  base: { bodies: 148, matchup: 137, statusFix: 148 },
  phase: { bodies: 232, matchup: 327, statusFix: 232 },
};

/** The form of a game type under a rule set, or null where the family keeps its table (a VGC singles game follows the singles table). */
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
