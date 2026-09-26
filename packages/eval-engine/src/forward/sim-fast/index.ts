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
import type { Battle } from '@pkmn/sim';
import { cloneBattle } from './clone.ts';
import { attachDispatch } from './dispatch.ts';
import { guardPasses } from './guard.ts';
import { ensureRuleTable } from './rule-table.ts';
import { breakSimFast, simFastCounters, simFastOn } from './state.ts';

export { simFastOn } from './state.ts';

let templateHook: ((battle: Battle) => void) | null = null;

/** Lever rules: runs before the first `new Battle` of a format (deserializeFromParsed). */
export function prepareFormat(formatid: string): void {
  if (simFastOn('rules') && guardPasses()) ensureRuleTable(formatid);
}

/** Lever clone: a copy of a template (PRNG unset, history empty), or null when the lever is off or the copy broke. */
export function copyBattle(template: Battle): Battle | null {
  if (!simFastOn('clone') || !guardPasses()) return null;
  try {
    const copy = cloneBattle(template);
    simFastCounters.clones++;
    return copy;
  } catch (error) {
    breakSimFast('fallback', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * A battle that becomes a copy source (position template, mid-turn snapshot);
 * never written afterwards. Always a copy or a fresh deserialization, never a
 * reader's battle.
 *
 * Today's fork is a JSON round trip, which drops own keys holding undefined
 * (state.mjs:385). The sim empties Pokemon.pendingStaleness (pokemon.mjs:1518,
 * 1583, 1602), a key the constructor does not create, and refills it later
 * (setItem, :1599): the round trip appends it after the keys added
 * meanwhile, a copy that kept the empty slot fills it in place, and the key
 * order of the serialized state (endgame memo keys) differs. So the source
 * drops the empty slot, as the round trip does.
 */
export function adoptTemplate(battle: Battle): Battle {
  for (const side of battle.sides) {
    for (const pokemon of side.pokemon) {
      if (Object.hasOwn(pokemon, 'pendingStaleness') && pokemon.pendingStaleness === undefined) delete pokemon.pendingStaleness;
    }
  }
  templateHook?.(battle);
  return battle;
}

/** Test hook: sees every template as it is adopted (the frozen-template spec freezes them). */
export function setTemplateHook(hook: ((battle: Battle) => void) | null): void {
  templateHook = hook;
}

/** Lever dispatch: every battle the engine makes carries the pre-check (deserializeFromParsed and the copy paths). */
export function prepareBattle(battle: Battle): void {
  if (simFastOn('dispatch') && guardPasses()) attachDispatch(battle);
}
