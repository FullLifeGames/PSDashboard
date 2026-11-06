import { toId } from '@fulllifegames/replay-core';
import { dieKey, type DieName, type ForcedDie } from './types.ts';

/**
 * Round 86 (the log's dice, T306): the phantom procs. An ability or an item that draws a chance when its holder is hit (Cute Charm, Static,
 * Flame Body, Poison Point, Cursed Body, Effect Spore, the attacker's Poison Touch and Toxic Chain, the Focus Band) is a die of kind
 * `ability-proc` or `item-proc`. The log shows such a die only when it came true, as a line that names the effect (`[from] ability:
 * Cute Charm`, `item: Focus Band`). The rebuild forces the dice the log shows and leaves the rest to the hidden dice of the frozen seed, so
 * a seed that says yes gave a body an infatuation, a burn or a paralysis that the game never showed (573756: Conscripts carried `attract`
 * from turn 2 to turn 10). A proc die the forced turn draws and the log does not show on that hit is forced not to happen.
 */

/** The kinds this module reads: the module's own names for a proc of an ability and of an item. */
const PROC_KINDS: ReadonlySet<string> = new Set(['ability-proc', 'item-proc']);

const EFFECT = /\b(?:ability|item): ([^|\]]+)/g;

/** The effects a block's lines name, each with the line that names it. The text after `ability:` or `item:` is the effect's name in the Dex. */
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
