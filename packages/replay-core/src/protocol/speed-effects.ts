import type { Pokemon } from '@pkmn/client';
import { rulesDex } from '../rules-dex.ts';
import type { RaceSpeedEffects } from '../types.ts';
import { abilitySuppressed } from './hit-facts.ts';
import { PARADOX_VOLATILES } from './paradox-reading.ts';
import type { ParserState } from './parser-state.ts';

/** One Pokémon's Speed at a point of the turn; `lowered` (paralysis, a negative stage) drops a race. */
export interface SpeedSeen {
  effects: RaceSpeedEffects;
  lowered: boolean;
}

/** The Speed state of every active Pokémon at one point of a turn. */
export type SpeedPoint = Map<Pokemon, SpeedSeen>;

// Gen 1 keeps Speed in `modifiedStats` with a history the log does not replay (gen1/scripts.js): it records no effect.
function effectsOf(state: ParserState, mon: Pokemon): RaceSpeedEffects {
  const effects: RaceSpeedEffects = {};
  if (state.genNum === 1) return effects;
  const stage = mon.boosts.spe ?? 0;
  if (stage > 0) effects.stage = stage;
  if (!abilitySuppressed(state, mon)) {
    const volatile = PARADOX_VOLATILES.find(id => (mon.volatiles[id] as { stat?: string } | undefined)?.stat === 'spe');
    if (volatile) effects.volatile = volatile;
  }
  const dex = rulesDex(state.genNum);
  const sideConditions = Object.keys(mon.side.sideConditions).filter(id => typeof (dex.conditions.get(id) as { onModifySpe?: unknown }).onModifySpe === 'function').sort();
  if (sideConditions.length > 0) effects.sideConditions = sideConditions;
  return effects;
}

/** The Speed state of every active Pokémon now; a read, the client stays as it is. */
export function speedPointOf(state: ParserState): SpeedPoint {
  return new Map(state.battle.getAllActive().map(mon => [mon, {
    effects: effectsOf(state, mon),
    lowered: mon.status === 'par' || (mon.boosts.spe ?? 0) < 0,
  }]));
}

const sameEffects = (a: RaceSpeedEffects, b: RaceSpeedEffects) => JSON.stringify(a) === JSON.stringify(b);

/** The distinct entries a mover stood under at the points, in order; absent when none holds an effect. */
export function effectsOver(points: (SpeedSeen | undefined)[]): RaceSpeedEffects[] | undefined {
  const entries: RaceSpeedEffects[] = [];
  for (const seen of points) {
    const effects = seen?.effects ?? {};
    if (!entries.some(entry => sameEffects(entry, effects))) entries.push(effects);
  }
  return entries.some(entry => Object.keys(entry).length > 0) ? entries : undefined;
}

/** The distinct entries `mon` stood under at the turn's start and at the point `seen` of an action. */
export function effectsAcross(state: ParserState, mon: Pokemon | null | undefined, seen: SpeedPoint): RaceSpeedEffects[] | undefined {
  return mon ? effectsOver([state.turnStart.get(mon), seen.get(mon)]) : undefined;
}
