import type { ParserState, PendingMove } from './parser-state.ts';

/** What a hit that left 1 HP shows on the public bar: the simulator rounds the bar up. */
const ONE_PERCENT = 0.01;

/**
 * An item or ability line of a Pokémon inside the pending move, before its own damage line (round 69): Focus Sash prints
 * `-enditem`, Focus Band and Endure `-activate`, Sturdy `-ability`. The line names no item; any of them in front of a damage line
 * that leaves the Pokémon at 1 percent says the hit was held back, so the damage is a lower bound (`survivedAtOne`).
 */
export function noteSurvivalMarker(state: ParserState, line: string) {
  const { lastMove } = state;
  const ident = line.split('|')[2] ?? '';
  if (!/^\|-(?:activate|enditem|ability)\|/.test(line) || !lastMove || ident === lastMove.attacker || lastMove.hits.has(ident)) return;
  lastMove.marked.add(ident);
}

/** The target kept at most one percent of its HP, and a marker fired inside the move before the damage line. */
export const survivedAtOne = (move: PendingMove, ident: string, remaining: number) =>
  remaining > 0 && remaining <= ONE_PERCENT && move.marked.has(ident);
