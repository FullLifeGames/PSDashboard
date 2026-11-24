import type { ParserState, PendingMove } from './parser-state.ts';

// A hit that left 1 HP shows 1 percent: the simulator rounds the bar up.
const ONE_PERCENT = 0.01;

/** Focus Sash prints `-enditem`, Focus Band and Endure `-activate`, Sturdy `-ability`: a held hit at 1 percent. */
export function noteSurvivalMarker(state: ParserState, line: string) {
  const { lastMove } = state;
  const ident = line.split('|')[2] ?? '';
  if (!/^\|-(?:activate|enditem|ability)\|/.test(line) || !lastMove || ident === lastMove.attacker || lastMove.hits.has(ident)) return;
  lastMove.marked.add(ident);
}

export const survivedAtOne = (move: PendingMove, ident: string, remaining: number) =>
  remaining > 0 && remaining <= ONE_PERCENT && move.marked.has(ident);
