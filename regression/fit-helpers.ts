/**
 * Shared probabilistic-scoring helpers for the fit (EVAL_FIT) and
 * calibration (EVAL_CALIBRATION) harnesses. One logistic model everywhere:
 * P(p1 wins) = sigmoid((k0 + k1·faintedFraction) · score). k1 = 0 recovers
 * the constant-K model the app shipped with.
 */
export interface OutcomeSample { score: number; faintedFraction: number; won: boolean }

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export const probOf = (s: OutcomeSample, k0: number, k1: number): number =>
  sigmoid((k0 + k1 * s.faintedFraction) * s.score);

export function brierScore(samples: OutcomeSample[], k0: number, k1 = 0): number {
  return samples.reduce((sum, s) => sum + (probOf(s, k0, k1) - (s.won ? 1 : 0)) ** 2, 0) / samples.length;
}

export function logLossScore(samples: OutcomeSample[], k0: number, k1 = 0): number {
  return samples.reduce((sum, s) => {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, probOf(s, k0, k1)));
    return sum - (s.won ? Math.log(p) : Math.log(1 - p));
  }, 0) / samples.length;
}

/** 500-iteration GD — replaces the two inline fitters (eval-fit, eval-calibration). */
export function fitConstantK(samples: OutcomeSample[]): number {
  let k = 1.5;
  for (let iter = 0; iter < 500; iter++) {
    let grad = 0;
    for (const s of samples) grad += (probOf(s, k, 0) - (s.won ? 1 : 0)) * s.score / samples.length;
    k -= 1.0 * grad;
  }
  return k;
}

export function fitPhaseK(samples: OutcomeSample[]): { k0: number; k1: number } {
  let k0 = 1.5;
  let k1 = 0;
  for (let iter = 0; iter < 500; iter++) {
    let g0 = 0;
    let g1 = 0;
    for (const s of samples) {
      const err = probOf(s, k0, k1) - (s.won ? 1 : 0);
      g0 += err * s.score / samples.length;
      g1 += err * s.score * s.faintedFraction / samples.length;
    }
    k0 -= 1.0 * g0;
    k1 -= 1.0 * g1;
  }
  return { k0, k1 };
}

export const phaseBucket = (ff: number): 'early' | 'mid' | 'late' =>
  ff < 1 / 6 ? 'early' : ff < 1 / 2 ? 'mid' : 'late';
