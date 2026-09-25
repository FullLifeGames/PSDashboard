/**
 * Round 59 (T91): the speed layer for @pkmn/sim 0.10.11. Three levers, each
 * behind the switch in state.ts: rule tables built once per format
 * (rule-table.ts), battles copied instead of deserialized (clone.ts), and a
 * pre-check that answers event dispatches nobody listens to (dispatch.ts).
 * Results never change, only time (spec
 * docs/superpowers/specs/2026-09-24-round-59-design.md).
 *
 * clone.ts and dispatch.ts follow the data layout and the control flow of
 * @pkmn/sim (MIT License, Copyright (c) 2011-2026 Guangcong Luo and other
 * contributors, http://pokemonshowdown.com/).
 */
import { ensureRuleTable } from './rule-table.ts';
import { simFastOn } from './state.ts';

/** Lever rules: runs before the first `new Battle` of a format (deserializeFromParsed). */
export function prepareFormat(formatid: string): void {
  if (simFastOn('rules')) ensureRuleTable(formatid);
}
