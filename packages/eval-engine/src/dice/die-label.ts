import type { DieKind, DieName, DieResult, ForcedDie } from './types.ts';

/** The reader of names for dieLabel; this module imports nothing from the simulator. */

export interface DieWords {
  move(id: string): string;
  /** A status, volatile, ability or item by id; a secondary's `boosts:spd` and `self:atk` pass through as given. */
  effect(id: string): string;
  /** The effect as a common noun inside a result ("no burn", like "no crit"); absent: `effect`. */
  plain?(id: string): string;
  slot(slot: string): string;
}

const IDS: DieWords = { move: id => id, effect: id => id, slot: slot => slot };

const EFFECT_SUBJECT = new Set<DieKind>(['ability-proc', 'item-proc', 'end-of-turn', 'move-first']);

const idOf = (name: DieName): string => (name.effectId ?? '').split(':option')[0];

function subjectOf(name: DieName, words: DieWords): string {
  if (name.kind === 'speed-tie') return 'Speed tie';
  if (EFFECT_SUBJECT.has(name.kind) && name.effectId) return words.effect(idOf(name));
  return name.moveId ? `${words.move(name.moveId)}${name.hit ? ` hit ${name.hit}` : ''}` : words.slot(name.slot);
}

function chanceText(name: DieName, words: DieWords): [string, string] {
  const effect = words.effect(idOf(name));
  const noun = (words.plain ?? words.effect)(idOf(name));
  switch (name.kind) {
    case 'accuracy': return ['hits', 'misses'];
    case 'crit': return ['crit', 'no crit'];
    case 'secondary': return [noun, `no ${noun}`];
    case 'self-effect': return ['stat change', 'no stat change'];
    case 'status-check': return [`${noun} lets it move`, `${noun} stops it`];
    case 'stalling': return ['succeeds again', 'fails'];
    case 'power': return [`${effect} boost`, `no ${effect} boost`];
    case 'move-first': return ['acts first', 'does not act first'];
    default: return ['triggers', 'does not trigger'];
  }
}

function resultText(name: DieName, result: DieResult, words: DieWords): string {
  if ('hits' in result) return result.hits === 1 ? '1 hit' : `${result.hits} hits`;
  if ('step' in result) return `damage roll ${result.step + 1}`;
  if (name.kind === 'random-target' && 'option' in result) return `aims at ${words.slot(result.option)}`;
  if (name.kind === 'drag' && 'option' in result) return `dragged out for ${result.option}`;
  if ('option' in result) return result.option;
  if ('first' in result) return `${words.slot(result.first)} first`;
  return chanceText(name, words)[result.happens ? 0 : 1];
}

export function dieLabel(die: ForcedDie, words: DieWords = IDS): string {
  return `${subjectOf(die.name, words)}: ${resultText(die.name, die.result, words)}`;
}
