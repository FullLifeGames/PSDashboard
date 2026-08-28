/**
 * Pure position model of the unified timeline: one main line (the replay)
 * plus at most ONE variation. Position "turn T" always means the state
 * BEFORE turn T is played; variation entry k plays turn startTurn + k.
 */

export type ViewLine = 'main' | 'variation';

export interface TimelinePosition {
  turn: number;
  line: ViewLine;
}

export interface VariationSpan {
  /** Turn of the first variation move (= the branch point's turn). */
  startTurn: number;
  /** Number of executed variation entries. */
  length: number;
}

/** Position after the last executed entry — where play continues. */
export function variationTip(span: VariationSpan): number {
  return span.startTurn + span.length;
}

/**
 * Turns where a variation POSITION exists. The position at startTurn itself
 * is the shared prefix (no variation move has run yet), so coverage starts
 * one turn later.
 */
export function variationCovers(span: VariationSpan | null, turn: number): boolean {
  return span !== null && span.length > 0 && turn > span.startTurn && turn <= variationTip(span);
}

export function sliderMax(replayMax: number, span: VariationSpan | null): number {
  return span && span.length > 0 ? Math.max(replayMax, variationTip(span)) : replayMax;
}

/**
 * Clamps a pointer to positions that exist: outside variation coverage only
 * 'main' exists; past the replay end only the variation does.
 */
export function normalizePosition(
  position: TimelinePosition,
  replayMax: number,
  span: VariationSpan | null,
): TimelinePosition {
  const max = sliderMax(replayMax, span);
  const turn = Math.min(Math.max(1, position.turn), max);
  if (position.line === 'variation' && !variationCovers(span, turn)) return { turn, line: 'main' };
  if (position.line === 'main' && turn > replayMax) {
    return variationCovers(span, turn) ? { turn, line: 'variation' } : { turn: replayMax, line: 'main' };
  }
  return { turn, line: position.line };
}

/**
 * Chess rules for an EXECUTED move at a position:
 * - open: no variation yet — the move opens one.
 * - extend: at the tip — normal play.
 * - truncate: inside the variation — the tail is silently cut.
 * - replace: on the main line while a variation exists — needs the confirm.
 */
export type DeviationKind = 'open' | 'extend' | 'truncate' | 'replace';

export function classifyDeviation(span: VariationSpan | null, position: TimelinePosition): DeviationKind {
  if (!span || span.length === 0) return 'open';
  if (position.line === 'variation') {
    return position.turn >= variationTip(span) ? 'extend' : 'truncate';
  }
  return 'replace';
}

/** Entries that survive an extend/truncate deviation at this position. */
export function keptEntries(span: VariationSpan, position: TimelinePosition): number {
  return Math.min(Math.max(0, position.turn - span.startTurn), span.length);
}
