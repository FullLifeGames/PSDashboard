import { brierScore, fitConstantK, type OutcomeSample } from './fit-helpers';

/**
 * The calibration harness's printed aggregate, line for line the same as
 * scripts/calibration-lib.mjs summarize(): sign accuracy and mean |score|
 * per phase, sign accuracy per gametype, the fitted K per pool, Brier per
 * phase under the pooled K, then (round 34) the hq tranche and the
 * luck-adjusted view, and the confidence buckets last.
 */
export interface SummarySample {
  id: string;
  turn: number;
  phase: 'early' | 'mid' | 'late';
  gameType: 'singles' | 'doubles';
  score: number;
  faintedFraction: number;
  p1Won: boolean;
  quality: 'hq' | 'std';
  luckAgainstFavored: boolean;
}

const PHASES = ['early', 'mid', 'late'] as const;
const right = (s: SummarySample): boolean => (s.score > 0) === s.p1Won;
const asOutcome = (s: SummarySample): OutcomeSample => ({ score: s.score, faintedFraction: s.faintedFraction, won: s.p1Won });
const pct = (subset: SummarySample[]): string => (100 * subset.filter(right).length / subset.length).toFixed(0);

/** Brier per phase under a pooled K, '-' for an empty phase. */
function phaseBriers(samples: SummarySample[], pooledK: number): string {
  return PHASES.map(phase => {
    const subset = samples.filter(s => s.phase === phase).map(asOutcome);
    return subset.length === 0 ? '-' : brierScore(subset, pooledK).toFixed(4);
  }).join('/');
}

function phaseLines(samples: SummarySample[]): string[] {
  const lines: string[] = [];
  for (const phase of PHASES) {
    const inPhase = samples.filter(sample => sample.phase === phase);
    if (inPhase.length === 0) continue;
    const meanAbs = inPhase.reduce((sum, sample) => sum + Math.abs(sample.score), 0) / inPhase.length;
    lines.push(`${phase}: n=${inPhase.length} sign-accuracy=${pct(inPhase)}% mean|score|=${meanAbs.toFixed(2)}`);
  }
  for (const gameType of ['singles', 'doubles'] as const) {
    const inType = samples.filter(sample => sample.gameType === gameType);
    if (inType.length === 0) continue;
    lines.push(`${gameType}: n=${inType.length} sign-accuracy=${pct(inType)}%`);
  }
  return lines;
}

function bucketLines(samples: SummarySample[]): string[] {
  const buckets: [number, number][] = [[0, 0.2], [0.2, 0.4], [0.4, 0.7], [0.7, 1.01]];
  const lines: string[] = [];
  for (const [lo, hi] of buckets) {
    const inBucket = samples.filter(sample => Math.abs(sample.score) >= lo && Math.abs(sample.score) < hi);
    if (inBucket.length === 0) continue;
    lines.push(`|score| ${lo.toFixed(1)}–${hi > 1 ? '1.0' : hi.toFixed(1)}: n=${inBucket.length} favored-side-wins=${pct(inBucket)}%`);
  }
  return lines;
}

export function summaryLines(samples: SummarySample[]): string[] {
  const fitK = (subset: SummarySample[]): number => fitConstantK(subset.map(asOutcome));
  const pooledK = fitK(samples);
  const lines = phaseLines(samples);
  lines.push(
    `winprob K: pooled=${pooledK.toFixed(2)} ` +
    `singles=${fitK(samples.filter(sample => sample.gameType === 'singles')).toFixed(2)} ` +
    `doubles=${fitK(samples.filter(sample => sample.gameType === 'doubles')).toFixed(2)}`,
  );
  for (const phase of PHASES) {
    const subset = samples.filter(s => s.phase === phase).map(asOutcome);
    if (subset.length === 0) continue;
    lines.push(`${phase} brier=${brierScore(subset, pooledK).toFixed(4)}`);
  }
  // Round 34: the hq tranche (smogtours or rating >= 1700) and the view
  // without luck against the favored side, both under the pooled K so the
  // lines stay comparable with the full bank.
  const hq = samples.filter(sample => sample.quality === 'hq');
  if (hq.length > 0) lines.push(`hq: n=${hq.length} sign-accuracy=${pct(hq)}% brier early/mid/late=${phaseBriers(hq, pooledK)}`);
  const clean = samples.filter(sample => !sample.luckAgainstFavored);
  lines.push(`luck-adjusted: n=${clean.length} excluded=${samples.length - clean.length} brier early/mid/late=${phaseBriers(clean, pooledK)}`);
  lines.push(...bucketLines(samples));
  return lines;
}
