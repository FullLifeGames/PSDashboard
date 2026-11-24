import { toId, type RulesDex } from '@fulllifegames/replay-core';

export function terrainIdFromSnapshot(terrain: string, dex: RulesDex): string {
  if (!terrain) return '';
  const terrainCondition = dex.conditions.get(`${terrain} Terrain`);
  return terrainCondition.exists ? terrainCondition.id : toId(terrain);
}

// @pkmn/client names weather by display name (its WEATHERS map: "Sand", "Sun"), the sim knows condition ids only:
// an untranslated name silently disables every weather residual.
const CLIENT_WEATHER_IDS: Record<string, string> = {
  sand: 'sandstorm',
  sun: 'sunnyday',
  rain: 'raindance',
  hail: 'hail',
  snow: 'snowscape',
  harshsunshine: 'desolateland',
  heavyrain: 'primordialsea',
  strongwinds: 'deltastream',
};

export function weatherIdFromSnapshot(weather: string, dex: RulesDex): string {
  if (!weather) return '';
  const mapped = CLIENT_WEATHER_IDS[toId(weather)];
  if (mapped) return mapped;
  const weatherCondition = dex.conditions.get(weather);
  return weatherCondition.exists ? weatherCondition.id : toId(weather);
}
