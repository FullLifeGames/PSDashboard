import type { Battle, Pokemon } from '@pkmn/sim';
import { secondaryChances } from '../dice/secondaries.ts';

/**
 * The secondary effects of a root cell as outcome classes. A hit that does not kill splits by the entries of the move's
 * `secondaries` that came true (a 30 percent burn is the class `hit-nokill+brn` beside `hit-nokill`), with the weights the chances
 * give. The chances come from the simulator through `dice/secondaries.ts` (Serene Grace, Sheer Force, Shield Dust, a King's Rock
 * flinch), and a draw says which entries came true by its dice record (`DiceSink` of `forward/scripted-prng.ts`), not by a line of
 * the log. An effect that stops the target's move this turn (the flinch: a volatile whose condition has a `BeforeMove` handler and
 * lasts one turn) cuts the second mover: its event is `none` in that class.
 */

export interface EventSecondary {
  effectId: string;
  chance: number;
  truncates: boolean;
}

export interface SecondaryDie {
  slot: string;
  moveId: string;
  effectId: string;
  happened: boolean;
}

type ConditionLike = { exists?: boolean; duration?: number; onBeforeMove?: unknown };

/** A condition that costs the target its move this turn: it lasts one turn and has a `BeforeMove` handler (the flinch). */
export function truncates(dex: Battle['dex'], effectId: string): boolean {
  const condition = dex.conditions.get(effectId) as unknown as ConditionLike;
  return !!condition.exists && condition.duration === 1 && typeof condition.onBeforeMove === 'function';
}

/**
 * The entries a damaging move of `userSlot` draws against `defender` (an active body), after the user's and the target's rules, or
 * null when the simulator refuses the question (the caller keeps the cell seed-priced). A status move draws none.
 */
export function eventSecondaries(battle: Battle, userSlot: string, moveId: string, defender: Pokemon): EventSecondary[] | null {
  if (battle.dex.moves.get(moveId).category === 'Status') return [];
  try {
    return secondaryChances(battle, userSlot, moveId, defender.getSlot()).map(entry => ({ ...entry, truncates: truncates(battle.dex, entry.effectId) }));
  } catch {
    return null;
  }
}

export interface HitClass {
  tokens: string[];
  weight: number;
  cuts: boolean;
}

/**
 * Every subset of the entries (each entry is one independent die) as a class; two entries of one effect (a move's flinch and a
 * King's Rock's) land in one class when either came true. No entries: the one class without a token.
 */
export function hitClasses(secondary: readonly EventSecondary[] | undefined): HitClass[] {
  const entries = secondary ?? [];
  const classes = new Map<string, HitClass>();
  for (let mask = 0; mask < 1 << entries.length; mask++) {
    let weight = 1;
    const came = new Set<string>();
    entries.forEach((entry, index) => {
      if (mask & (1 << index)) {
        weight *= entry.chance;
        came.add(entry.effectId);
      } else {
        weight *= 1 - entry.chance;
      }
    });
    if (weight <= 0) continue;
    const tokens = [...came].sort();
    const key = tokens.join('+');
    const found = classes.get(key);
    if (found) found.weight += weight;
    else classes.set(key, { tokens, weight, cuts: tokens.some(token => entries.some(entry => entry.effectId === token && entry.truncates)) });
  }
  return [...classes.values()];
}

export const hitKey = (tokens: readonly string[]): string => ['hit-nokill', ...tokens].join('+');

export function dieTokens(dice: readonly SecondaryDie[], side: 'p1' | 'p2', moveId: string, secondary: readonly EventSecondary[] | undefined): string[] {
  const known = new Set((secondary ?? []).map(entry => entry.effectId));
  const came = dice.filter(die => die.happened && die.slot.startsWith(side) && die.moveId === moveId && known.has(die.effectId)).map(die => die.effectId);
  return [...new Set(came)].sort();
}

/**
 * Whether a cell's events draw a secondary die: its draws record the dice, and a missing class is forced by script, never chased with probe
 * seeds.
 */
export const hasSecondary = (events: readonly { secondary?: readonly EventSecondary[] }[]): boolean => events.some(event => !!event.secondary?.length);

/**
 * The mass under which a class that carries a secondary effect is left unpriced: a forced draw for it would cost more than it moves (the
 * pair plan's floor).
 */
export const MIN_CLASS_MASS = 0.01;

export const isTokened = (classKey: string): boolean => classKey.includes('+');

/**
 * The outcome of a script key (`hit-nokill+brn+flinch`) as its base outcome and the entries' effect ids that came true. An effect id
 * may hold a plus itself (`boosts:atk+def`), so the entries of the cell tell the ids apart, never a split at every plus.
 */
export function splitOutcome(outcome: string, secondary: readonly EventSecondary[] = []): { base: string; tokens: string[] } {
  const cut = outcome.indexOf('+');
  if (cut < 0) return { base: outcome, tokens: [] };
  const rest = `+${outcome.slice(cut + 1)}+`;
  return { base: outcome.slice(0, cut), tokens: secondary.map(entry => entry.effectId).filter(id => rest.includes(`+${id}+`)) };
}

export const worthForcing = (classKey: string, share: number): boolean => !isTokened(classKey) || share >= MIN_CLASS_MASS;
