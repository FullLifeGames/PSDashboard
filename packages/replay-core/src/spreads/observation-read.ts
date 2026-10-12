import { Field, Move } from '@smogon/calc';
import type { CalcGeneration } from '../calc-gen.ts';
import { WEATHER_BY_ID } from '../calc-field.ts';
import { toId } from '../ids.ts';
import type { DamageObservation } from '../types.ts';

/** Client condition ids the shared calc map doesn't spell out. */
const WEATHER_ALIASES: Record<string, string> = {
  sand: 'sandstorm', rain: 'raindance', sun: 'sunnyday',
};

const weatherFor = (raw: string) => WEATHER_BY_ID[WEATHER_ALIASES[toId(raw)] ?? toId(raw)];

/** The side of an observation's defender: the one the parser read, else the other side (observations of older caches, singles). */
export function defenderSideOf(obs: DamageObservation): 'p1' | 'p2' {
  return obs.defenderSide ?? (obs.attackerSide === 'p1' ? 'p2' : 'p1');
}

/** The field one observed hit was played on: the game type, the weather and the defender's screens (Reflect weighs x2732/4096 in doubles). */
export function fieldOf(obs: DamageObservation): Field {
  const screens = new Set(obs.screens);
  return new Field({
    gameType: obs.doubles ? 'Doubles' : 'Singles',
    weather: weatherFor(obs.weather),
    defenderSide: {
      isReflect: screens.has('reflect'),
      isLightScreen: screens.has('lightscreen'),
      isAuroraVeil: screens.has('auroraveil'),
    },
  });
}

/**
 * The move of an observation as the calculator builds it. The calculator cuts a move aimed at all adjacent targets to 0.75 on a
 * Doubles field; the simulator cuts exactly when the move line names `[spread]` (two targets at the start, even if one protects).
 * A doubles hit without the mark had one target and takes the full damage, so the move reads as a single-target move.
 */
export function moveOf(gen: CalcGeneration, moveId: string, obs: DamageObservation): Move {
  return obs.doubles && !obs.spread ? new Move(gen, moveId, { overrides: { target: 'normal' } }) : new Move(gen, moveId);
}
