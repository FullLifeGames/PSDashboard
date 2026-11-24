/** Position "turn T" is the state before turn T is played; variation entry k plays turn startTurn + k. */

export type ViewLine = 'main' | 'variation';

export interface TimelinePosition {
  turn: number;
  line: ViewLine;
}

export interface VariationSpan {
  startTurn: number;
  length: number;
}

export function variationTip(span: VariationSpan): number {
  return span.startTurn + span.length;
}

/** The position at startTurn is the shared prefix (no variation move has run), so coverage starts one turn later. */
export function variationCovers(span: VariationSpan | null, turn: number): boolean {
  return span !== null && span.length > 0 && turn > span.startTurn && turn <= variationTip(span);
}

// The frame waits at startTurn for |turn|: the pointer then takes the first covered turn (turn 0 reads 1).
// An ended variation has no turn at its tip: the frame stays on the last played turn, the pointer takes the tip.
export function pointerAtFrame(frameTurn: number | null, span: VariationSpan | null, ended: boolean): number | null {
  if (frameTurn === null || span === null || span.length === 0) return null;
  const tip = variationTip(span);
  if (ended && frameTurn >= tip - 1) return tip;
  return Math.min(Math.max(frameTurn, span.startTurn + 1), tip);
}

export function sliderMax(replayMax: number, span: VariationSpan | null): number {
  return span && span.length > 0 ? Math.max(replayMax, variationTip(span)) : replayMax;
}

/** Outside variation coverage only 'main' exists; past the replay end only the variation does. */
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

// truncate cuts the tail silently; replace (main line while a variation exists) needs the confirm. The line is sticky
// across turns the variation does not cover, so a move there replaces instead of extending the variation.
export type DeviationKind = 'open' | 'extend' | 'truncate' | 'replace';

export function classifyDeviation(span: VariationSpan | null, position: TimelinePosition): DeviationKind {
  if (!span || span.length === 0) return 'open';
  if (position.line === 'variation' && variationCovers(span, position.turn)) {
    return position.turn >= variationTip(span) ? 'extend' : 'truncate';
  }
  return 'replace';
}

export function keptEntries(span: VariationSpan, position: TimelinePosition): number {
  return Math.min(Math.max(0, position.turn - span.startTurn), span.length);
}
