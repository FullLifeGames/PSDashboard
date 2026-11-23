import { toId } from '@fulllifegames/replay-core';
import { dieKey, type DieName, type ForcedDie } from './types.ts';

/**
 * A proc die (an ability's or item's chance when its holder is hit) shows in the log only when it came true, so one the forced turn draws and
 * the log does not show is forced not to happen; else a seed's yes gives a body an infatuation, burn or paralysis the game never showed.
 */

const PROC_KINDS: ReadonlySet<string> = new Set(['ability-proc', 'item-proc']);

const EFFECT = /\b(?:ability|item): ([^|\]]+)/g;

/** The effects a block's lines name, each with its line; the text after `ability:` or `item:` is the effect's name in the Dex. */
function shownEffects(lines: readonly string[]): { id: string; line: string }[] {
  return lines.flatMap(line => [...line.matchAll(EFFECT)].map(match => ({ id: toId(match[1]), line })));
}

/** Effect Spore's pick of a status (Gens 3 and 4) is its own die, told apart by `:option`; it is no chance and never forced to not happen. */
const isChance = (name: DieName): boolean => PROC_KINDS.has(name.kind) && !!name.effectId && !name.effectId.includes(':');

/**
 * The proc dice to force quiet: every proc die the forced turn drew (`drawn`, by die key) that the list does not force already and that
 * no line of the block names. A line names the proc when it shows the effect and one of the die's two bodies (the holder or the user of the
 * move): `|-status|p1a: X|par|[from] ability: Static|[of] p2a: Y` for the hit, `|-activate|p2a: Y|item: Focus Band` for a band.
 */
export function quietProcs(drawn: ReadonlyMap<string, DieName>, forced: readonly ForcedDie[], lines: readonly string[]): ForcedDie[] {
  const taken = new Set(forced.map(die => dieKey(die.name)));
  const shown = shownEffects(lines);
  const quiet: ForcedDie[] = [];
  for (const [key, name] of drawn) {
    if (!isChance(name) || taken.has(key)) continue;
    const bodies = [name.slot, name.targetSlot].filter((slot): slot is string => !!slot).map(slot => `${slot}:`);
    if (shown.some(entry => entry.id === name.effectId && bodies.some(body => entry.line.includes(body)))) continue;
    quiet.push({ name, result: { happens: false } });
  }
  return quiet;
}
