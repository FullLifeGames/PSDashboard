import type { ClaimResult } from './claims';
import type { AlignmentSummary } from '../src/lib/hax-alignment';

/**
 * Renders the drift run. The JSON's `results` array is STABLE — no wall
 * times, dates, or commit hashes inside — so two runs on identical code
 * diff empty there; volatile context lives in `meta` only.
 */

export interface DriftMeta {
  commit: string;
  date: string;
  settingsLine: string;
  wallTimes: Record<string, number>;
  noticeByReplay: Record<string, string | null>;
  /** Per-replay eval-layer failures (turn + reason) — the self-explaining gap trail. */
  evalErrorsByReplay: Record<string, { turn: number; error: string }[]>;
  /** Per-replay hax-alignment summary (null = sweep never ran / old build). */
  alignmentByReplay: Record<string, AlignmentSummary | null>;
}

const STATUS_LABEL: Record<string, string> = {
  ok: 'OK', drift: 'DRIFT', 'gap-open': 'GAP open', 'gap-moved': 'GAP moved', pending: 'PENDING',
  error: 'ERROR',
};

export function renderReport(results: ClaimResult[], meta: DriftMeta): { markdown: string; json: string } {
  const lines: string[] = [
    '# Feedback drift report',
    '',
    `- Commit: ${meta.commit} · ${meta.date}`,
    `- Settings: ${meta.settingsLine}`,
    `- Wall time: ${Object.entries(meta.wallTimes).map(([id, s]) => `${id} ${s}s`).join(' · ') || 'n/a'}`,
  ];
  const alignments = Object.entries(meta.alignmentByReplay).filter(([, summary]) => summary);
  if (alignments.length > 0) {
    lines.push(`- Hax alignment: ${alignments.map(([id, summary]) =>
      `${id} perfect ${summary!.perfectTurns}/${summary!.turns} · soft ${summary!.softResidual}` +
      `${summary!.faintResidualTurns > 0 ? ` · faint-residual ${summary!.faintResidualTurns}` : ''}` +
      `${summary!.endedMismatches > 0 ? ` · ended-mismatch ${summary!.endedMismatches}` : ''}`,
    ).join(' · ')}`);
  }
  const notices = Object.entries(meta.noticeByReplay).filter(([, notice]) => notice);
  if (notices.length > 0) {
    lines.push(`- Coverage notices: ${notices.map(([id, notice]) => `${id}: ${notice}`).join(' · ')}`);
  }
  const evalGaps = Object.entries(meta.evalErrorsByReplay).filter(([, gaps]) => gaps.length > 0);
  if (evalGaps.length > 0) {
    lines.push(`- Eval-layer gaps: ${evalGaps.map(([id, gaps]) =>
      `${id}: ${gaps.map(gap => `t${gap.turn} "${gap.error}"`).join(', ')}`).join(' · ')}`);
  }
  lines.push('');
  for (const result of results) {
    const { item } = result;
    const scope = item.turn !== undefined ? `t${item.turn}` : 'whole game';
    lines.push(`## ${STATUS_LABEL[result.status]} — ${item.replay} ${scope} (${item.kind})`);
    lines.push('');
    lines.push(item.essence);
    if (result.details.length > 0) {
      lines.push('');
      for (const detail of result.details) lines.push(`- ${detail}`);
    }
    if (item.desired) {
      lines.push('');
      lines.push(`Desired: ${item.desired}`);
    }
    lines.push('');
  }
  const json = JSON.stringify({
    meta,
    results: results.map(result => ({
      replay: result.item.replay,
      turn: result.item.turn ?? null,
      kind: result.item.kind,
      status: result.status,
      details: result.details,
    })),
  }, null, 2);
  return { markdown: lines.join('\n'), json };
}
