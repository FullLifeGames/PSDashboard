import { toId } from '@fulllifegames/replay-core';
import { dieKey, type DieName, type ForcedDie } from './types.ts';

// A proc die shows in the log only when it came true: one the log lacks is forced not to happen.

const PROC_KINDS: ReadonlySet<string> = new Set(['ability-proc', 'item-proc']);

const EFFECT = /\b(?:ability|item): ([^|\]]+)/g;

function shownEffects(lines: readonly string[]): { id: string; line: string }[] {
  return lines.flatMap(line => [...line.matchAll(EFFECT)].map(match => ({ id: toId(match[1]), line })));
}

// Effect Spore's status pick (Gens 3 and 4) is its own die, told apart by `:option`: no chance, never forced quiet.
const isChance = (name: DieName): boolean => PROC_KINDS.has(name.kind) && !!name.effectId && !name.effectId.includes(':');

/** The proc dice to force quiet: drawn by the forced turn, not forced yet, and named by no line of the block. */
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
