import { FEATURE_WEIGHTS, featureWeights, type EvalFeatures, type StaticRuleset } from './weights.ts';

/** A weight that runs with the game: `base + addend x share of fainted mons`; the fit prices the addend as `@phase`. */
export interface PhaseForm {
  base: Partial<Record<keyof EvalFeatures, number>>;
  phase: Partial<Record<keyof EvalFeatures, number>>;
}

export const STANDARD_SINGLES_FORM: PhaseForm = {
  base: { bodies: 148, matchup: 137, statusFix: 148 },
  phase: { bodies: 232, matchup: 327, statusFix: 232 },
};

/** The form of a game type and rule set; null where the family keeps its table (VGC singles follows singles). */
export function phaseFormOf(doubles: boolean, ruleset: StaticRuleset = 'standard'): PhaseForm | null {
  return featureWeights(doubles, ruleset) === FEATURE_WEIGHTS ? STANDARD_SINGLES_FORM : null;
}

export interface PhaseTerm { key: keyof EvalFeatures; shift: number; addend: number }

export const termsOf = (form: PhaseForm, table: Readonly<Record<keyof EvalFeatures, number>>): PhaseTerm[] =>
  (Object.keys(form.phase) as (keyof EvalFeatures)[]).map(key => ({ key, shift: (form.base[key] ?? table[key]) - table[key], addend: form.phase[key] ?? 0 }));

export const STANDARD_SINGLES_TERMS: readonly PhaseTerm[] = termsOf(STANDARD_SINGLES_FORM, FEATURE_WEIGHTS);

interface ProcessLike { env?: Record<string, string | undefined> }

let override: boolean | null = null;
let resolved: boolean | null = null;

/** On unless `setStaticForm` or EVAL_STATIC_FORM=0 says off (read once). */
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
