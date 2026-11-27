import type { Battle, Pokemon } from '@pkmn/sim';
import { secondaryChances } from '../dice/secondaries.ts';

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

/** A condition that costs the target its move this turn: lasts one turn, has a `BeforeMove` handler (the flinch). */
export function truncates(dex: Battle['dex'], effectId: string): boolean {
  const condition = dex.conditions.get(effectId) as unknown as ConditionLike;
  return !!condition.exists && condition.duration === 1 && typeof condition.onBeforeMove === 'function';
}

/** The entries a damaging move draws against `defender` (a bench body read in its slot); null on refusal. */
export function eventSecondaries(battle: Battle, userSlot: string, moveId: string, defender: Pokemon): EventSecondary[] | null {
  if (battle.dex.moves.get(moveId).category === 'Status') return [];
  const incoming = defender.isActive ? undefined : defender.side.pokemon.indexOf(defender);
  try {
    return secondaryChances(battle, userSlot, moveId, incoming === undefined ? defender.getSlot() : `${defender.side.id}a`, incoming).map(entry => ({ ...entry, truncates: truncates(battle.dex, entry.effectId) }));
  } catch {
    return null;
  }
}

export interface HitClass {
  tokens: string[];
  weight: number;
  cuts: boolean;
}

/** Every subset of the entries as a class; two entries of one effect (a flinch of move and item) share one. */
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

export const hasSecondary = (events: readonly { secondary?: readonly EventSecondary[] }[]): boolean => events.some(event => !!event.secondary?.length);

/** The mass under which a class with a secondary effect stays unpriced: a forced draw would cost more than it moves. */
export const MIN_CLASS_MASS = 0.01;

export const isTokened = (classKey: string): boolean => classKey.includes('+');

/** A script key as base outcome and effect ids; an id may hold a plus (`boosts:atk+def`): never split at each plus. */
export function splitOutcome(outcome: string, secondary: readonly EventSecondary[] = []): { base: string; tokens: string[] } {
  const cut = outcome.indexOf('+');
  if (cut < 0) return { base: outcome, tokens: [] };
  const rest = `+${outcome.slice(cut + 1)}+`;
  return { base: outcome.slice(0, cut), tokens: secondary.map(entry => entry.effectId).filter(id => rest.includes(`+${id}+`)) };
}

export const worthForcing = (classKey: string, share: number): boolean => !isTokened(classKey) || share >= MIN_CLASS_MASS;
