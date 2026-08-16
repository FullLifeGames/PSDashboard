import type { GameReport } from '../src/lib/eval/report';
import type { TurnAnalysis } from '../src/lib/eval/analysis';
import { summarizeTurn } from '../src/lib/eval/summary';
import { BASELINE_PINNED, FEEDBACK_REPLAYS, type FeedbackItem, type ReportClaim, type TurnClaim } from './corpus';

/**
 * Pure comparison brain of the drift harness. WARN-ONLY by construction:
 * every status is report content — nothing here throws or fails a test.
 * Pinned in regression/feedback-claims.spec.ts.
 */

/**
 * 'error' is never produced by the evaluator — the RUNNER constructs it when
 * a replay could not be graded at all (wedged sweep, empty extraction), so
 * the report carries the breakage instead of silently omitting the items.
 */
export type ClaimStatus = 'ok' | 'drift' | 'gap-open' | 'gap-moved' | 'pending' | 'error';

export interface ClaimResult {
  item: FeedbackItem;
  status: ClaimStatus;
  /** Human-readable mismatches / current values, verbatim into the report. */
  details: string[];
}

export function isReportClaim(claim: TurnClaim | ReportClaim): claim is ReportClaim {
  return 'keyMoments' in claim;
}

function turnClaimMismatches(
  claim: TurnClaim,
  analysis: TurnAnalysis | null,
  report: GameReport | null,
  turn: number,
  playerNames?: [string, string],
): string[] {
  if (!analysis) return [`turn ${turn} has no analysis (coverage hole in the sweep)`];
  const out: string[] = [];
  if (claim.attribution && !claim.attribution.includes(analysis.attribution)) {
    out.push(`attribution is '${analysis.attribution}', expected one of [${claim.attribution.join(', ')}]`);
  }
  const sideAnalysis = claim.side ? analysis[claim.side] : null;
  if (claim.riskPaidOff !== undefined) {
    if (!claim.side) out.push('claim has riskPaidOff but no side');
    else if (!!sideAnalysis?.riskPaidOff !== claim.riskPaidOff) {
      out.push(`${claim.side}.riskPaidOff is ${!!sideAnalysis?.riskPaidOff}, expected ${claim.riskPaidOff}`);
    }
  }
  if (claim.tier !== undefined) {
    if (!claim.side) out.push('claim has tier but no side');
    else {
      const actual = sideAnalysis?.tier ?? 'none';
      if (actual !== claim.tier) out.push(`${claim.side}.tier is '${actual}', expected '${claim.tier}'`);
    }
  }
  if (claim.playedLabelIncludes !== undefined) {
    if (!claim.side) out.push('claim has playedLabelIncludes but no side');
    else {
      const label = sideAnalysis?.played?.label ?? '';
      if (!label.includes(claim.playedLabelIncludes)) {
        out.push(`${claim.side} played '${label || '(unmatched)'}', expected it to include '${claim.playedLabelIncludes}'`);
      }
    }
  }
  if (claim.keyMoment !== undefined) {
    const isKey = !!report?.keyMoments.some(moment => moment.turn === turn);
    if (isKey !== claim.keyMoment) out.push(`keyMoment membership is ${isKey}, expected ${claim.keyMoment}`);
  }
  if (claim.summaryIncludes && claim.summaryIncludes.length > 0) {
    // Narrative pins render the SAME summary the UI shows. Missing names are
    // a loud mismatch, never a silent pass.
    if (!playerNames) out.push('claim has summaryIncludes but no player names were provided');
    else {
      const summary = summarizeTurn(analysis, playerNames);
      for (const fragment of claim.summaryIncludes) {
        if (!summary.includes(fragment)) out.push(`summary is missing '${fragment}'`);
      }
    }
  }
  return out;
}

function reportClaimMismatches(claim: ReportClaim, report: GameReport | null): string[] {
  if (!report) return ['no game report was produced'];
  const out: string[] = [];
  const wantKey = new Map(claim.keyMoments.map(entry => [entry.turn, entry.attribution]));
  for (const moment of report.keyMoments) {
    const want = wantKey.get(moment.turn);
    if (want === undefined) out.push(`extra key moment at turn ${moment.turn} ('${moment.attribution}')`);
    else if (want !== moment.attribution) out.push(`key moment turn ${moment.turn} attribution is '${moment.attribution}', expected '${want}'`);
    wantKey.delete(moment.turn);
  }
  for (const [turn] of wantKey) out.push(`missing key moment at turn ${turn}`);
  const pairKey = (entry: { turn: number; side: 'p1' | 'p2' }) => `${entry.turn}:${entry.side}`;
  const diffPairs = (label: string, want: { turn: number; side: 'p1' | 'p2' }[], got: { turn: number; side: 'p1' | 'p2' }[]) => {
    const wanted = new Set(want.map(pairKey));
    for (const entry of got) {
      if (!wanted.delete(pairKey(entry))) out.push(`extra ${label} ${pairKey(entry)}`);
    }
    for (const missing of wanted) out.push(`missing ${label} ${missing}`);
  };
  diffPairs('misplay', claim.misplays, report.misplays.map(({ turn, side }) => ({ turn, side })));
  diffPairs('read', claim.reads, report.reads.map(({ turn, side }) => ({ turn, side })));
  if (report.turningPoint !== claim.turningPoint) {
    out.push(`turningPoint is ${report.turningPoint}, expected ${claim.turningPoint}`);
  }
  return out;
}

export function evaluateItem(
  item: FeedbackItem,
  analyses: (TurnAnalysis | null)[],
  report: GameReport | null,
  /** Needed only by narrative pins (summaryIncludes) — the replay's player names. */
  playerNames?: [string, string],
): ClaimResult {
  if (item.kind === 'truth') {
    if (!item.expect) return { item, status: 'pending', details: ['truth not yet pinned (pre-baseline)'] };
    const mismatches = isReportClaim(item.expect)
      ? reportClaimMismatches(item.expect, report)
      : turnClaimMismatches(item.expect, analyses[(item.turn ?? 1) - 1] ?? null, report, item.turn ?? 1, playerNames);
    return { item, status: mismatches.length === 0 ? 'ok' : 'drift', details: mismatches };
  }
  if (!item.observed) return { item, status: 'pending', details: ['gap baseline not yet recorded'] };
  const mismatches = turnClaimMismatches(item.observed, analyses[(item.turn ?? 1) - 1] ?? null, report, item.turn ?? 1, playerNames);
  return mismatches.length === 0
    ? { item, status: 'gap-open', details: [] }
    : { item, status: 'gap-moved', details: mismatches };
}

/** Schema gate — the only corpus-side RED conditions. */
export function validateCorpus(
  corpus: FeedbackItem[],
  turnsByReplay: Record<string, number>,
  pinned: boolean = BASELINE_PINNED,
): string[] {
  const errors: string[] = [];
  const known = new Set<string>(FEEDBACK_REPLAYS);
  corpus.forEach((item, index) => {
    const where = `item ${index} (${item.replay}${item.turn !== undefined ? ` t${item.turn}` : ''})`;
    if (!known.has(item.replay) || turnsByReplay[item.replay] === undefined) {
      errors.push(`${where}: unknown replay`);
      return;
    }
    if (item.turn !== undefined && (item.turn < 1 || item.turn > turnsByReplay[item.replay])) {
      errors.push(`${where}: turn out of range 1..${turnsByReplay[item.replay]}`);
    }
    if (item.kind === 'gap' && item.expect) errors.push(`${where}: gap items must not carry expect`);
    if (item.kind === 'truth' && (item.observed || item.desired)) errors.push(`${where}: truth items must not carry observed/desired`);
    if (item.kind === 'truth' && pinned && !item.expect) errors.push(`${where}: truth unpinned after baseline`);
    if (item.turn === undefined && item.expect && !isReportClaim(item.expect)) {
      errors.push(`${where}: whole-game truth needs a ReportClaim`);
    }
    if (item.turn !== undefined && item.expect && isReportClaim(item.expect)) {
      errors.push(`${where}: turn-scoped truth cannot carry a ReportClaim`);
    }
  });
  return errors;
}
