/**
 * The zero-sum matrix game's equilibrium: regret-matching self-play over
 * the value matrix. Pure, deterministic.
 */

const EQUILIBRIUM_ITERATIONS = 4000;

export interface MatrixSolution {
  /** Solved value of the zero-sum game (p1 perspective). */
  value: number;
  p1Mix: number[];
  p2Mix: number[];
}

/**
 * Regret-matching self-play on the zero-sum matrix game (Hart & Mas-Colell).
 * The AVERAGE strategies converge to a Nash equilibrium — the current
 * strategies do not, so only the averages are returned. Deterministic: a
 * fixed iteration count and no randomness.
 */
export function solveMatrixGame(values: number[][]): MatrixSolution {
  const rows = values.length;
  const cols = rows > 0 ? values[0].length : 0;
  if (rows === 0 || cols === 0) return { value: 0, p1Mix: [], p2Mix: [] };

  const regret1 = new Array<number>(rows).fill(0);
  const regret2 = new Array<number>(cols).fill(0);
  const sum1 = new Array<number>(rows).fill(0);
  const sum2 = new Array<number>(cols).fill(0);

  const mixFromRegret = (regret: number[]): number[] => {
    let total = 0;
    for (const r of regret) total += Math.max(0, r);
    if (total <= 0) return regret.map(() => 1 / regret.length);
    return regret.map(r => Math.max(0, r) / total);
  };

  for (let t = 0; t < EQUILIBRIUM_ITERATIONS; t++) {
    const mix1 = mixFromRegret(regret1);
    const mix2 = mixFromRegret(regret2);
    for (let i = 0; i < rows; i++) sum1[i] += mix1[i];
    for (let j = 0; j < cols; j++) sum2[j] += mix2[j];

    const rowEv = values.map(row => row.reduce((sum, cell, j) => sum + cell * mix2[j], 0));
    const colEv = new Array<number>(cols).fill(0);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) colEv[j] += values[i][j] * mix1[i];
    }
    const v = rowEv.reduce((sum, ev, i) => sum + ev * mix1[i], 0);
    for (let i = 0; i < rows; i++) regret1[i] += rowEv[i] - v;
    for (let j = 0; j < cols; j++) regret2[j] += v - colEv[j];
  }

  const normalize = (sums: number[]): number[] => {
    const total = sums.reduce((sum, entry) => sum + entry, 0);
    return sums.map(entry => entry / total);
  };
  const p1Mix = normalize(sum1);
  const p2Mix = normalize(sum2);
  let value = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) value += values[i][j] * p1Mix[i] * p2Mix[j];
  }
  return { value, p1Mix, p2Mix };
}
