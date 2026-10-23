import { toId, type RulesDex } from '@fulllifegames/replay-core';

/** Snapshot display names of terrain and weather, translated to the sim's condition ids (the Dex of the battle's generation and mod). */
export function terrainIdFromSnapshot(terrain: string, dex: RulesDex): string {
  if (!terrain) return '';
  const terrainCondition = dex.conditions.get(`${terrain} Terrain`);
  return terrainCondition.exists ? terrainCondition.id : toId(terrain);
}

/**
 * @pkmn/client snapshots report weather by display name (its WEATHERS map:
 * "Sand", "Sun", …) — the sim only knows condition ids. Writing an untranslated
 * name into the sim silently disables every weather residual (the gen 3
 * Sandstorm-does-no-damage report).
 */
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
