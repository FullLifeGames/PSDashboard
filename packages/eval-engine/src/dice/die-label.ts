import type { DieKind, DieName, DieResult, ForcedDie } from './types.ts';

/**
 * Round 82 (forced dice), step A5: one text per forced die, for the history rows, the shares and the frame lines of a branch
 * (A6) and for the chips (A7). It says what the die decided, with the names a reader gives it: the caller hands in the Dex of
 * the game's rule set (`rulesDex`), so this file holds no move, ability or item name. Free of simulator imports like
 * `logged-results.ts`.
 */

/** The reader of names: the game's own Dex for moves and effects, the battle's names for the bodies. */
export interface DieWords {
  move(id: string): string;
  /** A status, a volatile, an ability or an item by its id (a secondary's `boosts:spd` and `self:atk` pass through as given). */
  effect(id: string): string;
  slot(slot: string): string;
}

/** Without a reader the ids stand in for the names. */
const IDS: DieWords = { move: id => id, effect: id => id, slot: slot => slot };

/** Kinds whose subject is the effect that holds the die, not a move. */
const EFFECT_SUBJECT = new Set<DieKind>(['ability-proc', 'item-proc', 'end-of-turn', 'move-first']);

/** The effect id without the suffix the module gives a die with several results (`effectspore:option`). */
const idOf = (name: DieName): string => (name.effectId ?? '').split(':option')[0];

function subjectOf(name: DieName, words: DieWords): string {
  if (name.kind === 'speed-tie') return 'Speed tie';
  if (EFFECT_SUBJECT.has(name.kind) && name.effectId) return words.effect(idOf(name));
  // the accuracy die of a later hit of a multi-hit move names its hit (round 89, #114); the first hit's die keeps the plain subject
  return name.moveId ? `${words.move(name.moveId)}${name.hit ? ` hit ${name.hit}` : ''}` : words.slot(name.slot);
}

/** The two words of a chance, by what the die decides: yes and no. */
function chanceText(name: DieName, words: DieWords): [string, string] {
  const effect = words.effect(idOf(name));
  switch (name.kind) {
    case 'accuracy': return ['hits', 'misses'];
    case 'crit': return ['crit', 'no crit'];
    case 'secondary': return [effect, `no ${effect}`];
    case 'self-effect': return ['stat change', 'no stat change'];
    case 'status-check': return [`${effect} lets it move`, `${effect} stops it`];
    case 'stalling': return ['succeeds again', 'fails'];
    case 'power': return [`${effect} boost`, `no ${effect} boost`];
    case 'move-first': return ['acts first', 'does not act first'];
    default: return ['triggers', 'does not trigger'];
  }
}

function resultText(name: DieName, result: DieResult, words: DieWords): string {
  if ('hits' in result) return result.hits === 1 ? '1 hit' : `${result.hits} hits`;
  if ('step' in result) return `damage roll ${result.step + 1}`;
  if ('option' in result) return result.option;
  if ('first' in result) return `${words.slot(result.first)} first`;
  return chanceText(name, words)[result.happens ? 0 : 1];
}

/** The label of a forced die: its subject, a colon and the result in words. */
export function dieLabel(die: ForcedDie, words: DieWords = IDS): string {
  return `${subjectOf(die.name, words)}: ${resultText(die.name, die.result, words)}`;
}
