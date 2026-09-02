import type { Field } from '@smogon/calc';

/**
 * Sim condition ids mapped onto @smogon/calc's field labels. The damage
 * previews, the kill-odds pricing, and the spread fit all read these, so
 * the tables live in the replay core rather than in the engine.
 */

type CalcFieldOptions = ConstructorParameters<typeof Field>[0];
type CalcWeather = NonNullable<CalcFieldOptions>['weather'];
type CalcTerrain = NonNullable<CalcFieldOptions>['terrain'];

export const WEATHER_BY_ID: Record<string, NonNullable<CalcWeather>> = {
  raindance: 'Rain',
  primordialsea: 'Heavy Rain',
  sunnyday: 'Sun',
  desolateland: 'Harsh Sunshine',
  sandstorm: 'Sand',
  hail: 'Hail',
  snow: 'Snow',
  snowscape: 'Snow',
  deltastream: 'Strong Winds',
};

export const TERRAIN_BY_ID: Record<string, NonNullable<CalcTerrain>> = {
  electricterrain: 'Electric',
  grassyterrain: 'Grassy',
  psychicterrain: 'Psychic',
  mistyterrain: 'Misty',
};
