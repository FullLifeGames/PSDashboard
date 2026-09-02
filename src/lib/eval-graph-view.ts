import { computeBlunders } from './eval/graph';
import { winPercent } from './eval/winprob';
import type { LeadAnalysis } from './eval/leads';
import { sideIndex } from './ids';

export const GRAPH_HEIGHT = 72;
export const GRAPH_PAD_X = 6;

export interface GraphScales {
  x: (turn: number) => number;
  y: (score: number) => number;
}

export function graphScales(width: number, first: number, lastTurn: number): GraphScales {
  const x = (turn: number) => lastTurn === first
    ? width / 2
    : GRAPH_PAD_X + ((turn - first) / (lastTurn - first)) * (width - 2 * GRAPH_PAD_X);
  const y = (score: number) => GRAPH_HEIGHT / 2 - score * (GRAPH_HEIGHT / 2 - 7);
  return { x, y };
}

export interface GapLink { x1: number; y1: number; x2: number; y2: number }

/**
 * Consecutive non-null runs become path segments; gaps get a faint dashed
 * connector so an isolated final point (late-game reconstruction gaps end
 * in the decided ±1 position) reads as the line's ending, not debris.
 */
export function mainLinePaths(scores: (number | null)[], { x, y }: GraphScales): { segments: string[]; gapLinks: GapLink[] } {
  const segments: string[] = [];
  const gapLinks: GapLink[] = [];
  let current: string[] = [];
  let previousPoint: { x: number; y: number } | null = null;
  let inGap = false;
  scores.forEach((score, index) => {
    if (score === null) {
      if (current.length > 1) segments.push(`M ${current.join(' L ')}`);
      current = [];
      inGap = previousPoint !== null;
      return;
    }
    const px = x(index + 1);
    const py = y(score);
    if (inGap && previousPoint) {
      gapLinks.push({ x1: previousPoint.x, y1: previousPoint.y, x2: px, y2: py });
      inGap = false;
    }
    current.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    previousPoint = { x: px, y: py };
  });
  if (current.length > 1) segments.push(`M ${current.join(' L ')}`);
  return { segments, gapLinks };
}

export interface VariationSeries { startTurn: number; scores: (number | null)[] }
export interface VariationPoint { turn: number; px: number; py: number; score: number }

/** The x-domain stretches past the replay when the variation is longer. */
export function lastVariationTurnOf(variation: VariationSeries | null | undefined): number {
  return variation
    ? variation.scores.reduce<number>((max, value, index) => (value !== null ? index + 1 : max), 0)
    : 0;
}

/** Variation overlay: anchored at the branch point's main value; points
 *  are only the ACTUALLY evaluated variation positions. */
export function variationOverlay(
  variation: VariationSeries | null | undefined, scores: (number | null)[], { x, y }: GraphScales,
): { points: VariationPoint[]; path: string; end: number } {
  const points: VariationPoint[] = [];
  let path = '';
  if (variation) {
    const anchorScore = scores[variation.startTurn - 1];
    const coords: string[] = anchorScore !== null && anchorScore !== undefined
      ? [`${x(variation.startTurn).toFixed(1)},${y(anchorScore).toFixed(1)}`]
      : [];
    variation.scores.forEach((score, index) => {
      const turn = index + 1;
      if (score === null || score === undefined || turn <= variation.startTurn) return;
      const px = x(turn);
      const py = y(score);
      coords.push(`${px.toFixed(1)},${py.toFixed(1)}`);
      points.push({ turn, px, py, score });
    });
    if (coords.length > 1) path = `M ${coords.join(' L ')}`;
  }
  const end = points.length > 0
    ? points[points.length - 1].turn
    : (variation ? variation.startTurn + 1 : 0);
  return { points, path, end };
}

export type DecidedSignal = { side: 'p1' | 'p2'; species: string } | null;
export interface DecidedSpan { x1: number; x2: number; side: 'p1' | 'p2'; species: string }

/**
 * Round 15: consecutive decided turns of the same side become one thin
 * strip along that side's edge; a lone decided turn draws as a dot (round
 * linecap). The calibrated line itself is never bent.
 */
export function decidedSpans(
  decided: DecidedSignal[] | undefined, scores: (number | null)[], x: GraphScales['x'],
): DecidedSpan[] {
  const spans: DecidedSpan[] = [];
  if (!decided) return spans;
  let run: { start: number; end: number; side: 'p1' | 'p2'; species: string } | null = null;
  const flush = () => {
    if (run) spans.push({ x1: x(run.start), x2: x(run.end), side: run.side, species: run.species });
    run = null;
  };
  decided.forEach((signal, index) => {
    const turn = index + 1;
    if (!signal || scores[index] === null) { flush(); return; }
    if (run && run.side === signal.side) { run.end = turn; return; }
    flush();
    run = { start: turn, end: turn, side: signal.side, species: signal.species };
  });
  flush();
  return spans;
}

const pct = (score: number) => winPercent(score);

/**
 * A node IS the estimate before its turn; the movement INTO it was the
 * previous turn's doing. Clicks stay on the node's own turn (a shifted
 * click felt like landing one node back) — the tooltip names the producer
 * and the selection glow shows the clicked turn's own movement.
 */
export function nodeLabel(args: {
  turn: number; score: number; blunders: Set<number>; first: number;
  decided: DecidedSignal[] | undefined; playerNames: [string, string];
}): string {
  const { turn, score, blunders, first, decided, playerNames } = args;
  const swing = blunders.has(turn) ? ' · blunder swing' : '';
  const producer = turn - 1 >= first ? (turn - 1 === 0 ? 'the lead decision' : `turn ${turn - 1}`) : null;
  const arrival = producer ? ` (what ${producer} produced)` : '';
  const state = decided?.[turn - 1];
  const decidedNote = state ? ` · practically decided: ${state.species}` : '';
  return `Before turn ${turn}${arrival}: ${playerNames[0]} ${pct(score)}% · ${playerNames[1]} ${100 - pct(score)}%${swing}${decidedNote}`;
}

/** Tooltip of a main-line hit column: the node's label, or why the turn has no point. */
export function hitTitle(args: {
  index: number; score: number | null; evalErrors: (string | null)[] | undefined;
  blunders: Set<number>; first: number; decided: DecidedSignal[] | undefined; playerNames: [string, string];
}): string {
  const { index, score, evalErrors } = args;
  // Gap turns (reconstruction wedges, unswept ends) stay clickable —
  // the turn view then offers "Analyze this position".
  if (score === null) {
    return evalErrors?.[index]
      ? `Turn ${index + 1} · could not be evaluated: ${evalErrors[index]} · click to open`
      : `Turn ${index + 1} · not analyzed yet · click to open, then Analyze this position`;
  }
  return nodeLabel({ ...args, turn: index + 1, score });
}

export function variationHitTitle(playerNames: [string, string], point: VariationPoint): string {
  return `Variation, before turn ${point.turn}: ${playerNames[0]} ${pct(point.score)}% · ${playerNames[1]} ${100 - pct(point.score)}%`;
}

/** The T0 diamond's tooltip: the preview estimate plus each side's best and played lead. */
export function leadTooltip(playerNames: [string, string], leadScore: number, leadDetail: LeadAnalysis | null | undefined): string {
  const lines = [`Team preview: ${playerNames[0]} ${pct(leadScore)}% · ${playerNames[1]} ${100 - pct(leadScore)}%`];
  const stripLead = (label: string) => label.replace(/^Lead /, '');
  for (const side of ['p1', 'p2'] as const) {
    const detail = leadDetail?.[side];
    if (!detail?.best) continue;
    const name = playerNames[sideIndex(side)];
    const best = stripLead(detail.best.label);
    const played = detail.played ? stripLead(detail.played.label) : null;
    lines.push(played === best
      ? `${name} best lead: ${best} (played)`
      : `${name} best lead: ${best}${played ? ` · played: ${played}` : ''}`);
  }
  lines.push('Click to open the lead analysis.');
  return lines.join('\n');
}

/**
 * The selected turn's movement: its node → the next node (what that play
 * produced), drawn as a thicker glow under the line.
 */
export function highlightEdge(args: {
  currentTurn: number; scores: (number | null)[]; hasLead: boolean; leadScore: number | null | undefined;
  first: number; scales: GraphScales;
}): GapLink | null {
  const { currentTurn, scores, hasLead, leadScore, first, scales: { x, y } } = args;
  const turns = scores.length;
  const edgeFrom = currentTurn >= 1 ? scores[currentTurn - 1] : (hasLead ? leadScore! : null);
  const edgeTo = currentTurn >= 0 && currentTurn < turns ? scores[currentTurn] : null;
  return edgeFrom !== null && edgeFrom !== undefined && edgeTo !== null && currentTurn >= first
    ? { x1: x(currentTurn), y1: y(edgeFrom), x2: x(currentTurn + 1), y2: y(edgeTo) }
    : null;
}

/** The pointer's score on ITS line, or null when there is nothing to mark. */
export function ringScore(args: {
  currentLine: 'main' | 'variation' | undefined; variation: VariationSeries | null | undefined;
  scores: (number | null)[]; currentTurn: number; hasLead: boolean; leadScore: number | null | undefined; first: number;
}): number | null {
  const { currentLine, variation, scores, currentTurn, hasLead, leadScore, first } = args;
  const score = currentLine === 'variation'
    ? variation?.scores[currentTurn - 1] ?? null
    : (currentTurn >= 1 ? scores[currentTurn - 1] ?? null : (hasLead && currentTurn === 0 ? leadScore! : null));
  if (score === null || score === undefined || currentTurn < first) return null;
  return score;
}

export const graphBlunders = (scores: (number | null)[]) => new Set(computeBlunders(scores));
