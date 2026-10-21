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

/**
 * What the calculator reads off the field and its two sides, not off the two Pokémon (round 69, T86), by the Dex id of the
 * ability or condition that makes it true. A Ruin or Aura ability on any active Pokémon, and a field condition, set a field flag;
 * the volatiles of the attacker and the abilities of its ally set an attacker-side flag; the abilities of the defender's ally set a
 * defender-side flag. The calculator's own check leaves out the holder itself.
 */
export const FIELD_FLAG_BY_ID: Record<string, string> = {
  beadsofruin: 'isBeadsOfRuin', swordofruin: 'isSwordOfRuin', tabletsofruin: 'isTabletsOfRuin', vesselofruin: 'isVesselOfRuin',
  aurabreak: 'isAuraBreak', fairyaura: 'isFairyAura', darkaura: 'isDarkAura',
  gravity: 'isGravity', magicroom: 'isMagicRoom', wonderroom: 'isWonderRoom',
};
export const ATTACKER_SIDE_FLAG_BY_ID: Record<string, string> = {
  helpinghand: 'isHelpingHand', charge: 'isCharge', battery: 'isBattery', powerspot: 'isPowerSpot', steelyspirit: 'isSteelySpirit',
  flowergift: 'isFlowerGift',
};
export const DEFENDER_SIDE_FLAG_BY_ID: Record<string, string> = { friendguard: 'isFriendGuard', defenderflowergift: 'isFlowerGift' };

/**
 * The fact an ally's ability books for one side of a hit, or null when the calculator reads nothing of it (round 73, T203). Flower
 * Gift weighs on both sides (the attacker's Attack, the defender's Special Defense), so the defender side books it under its own id.
 */
export function allyFactOf(role: 'attacker' | 'defender', ability: string): string | null {
  if (role === 'attacker') return ability in ATTACKER_SIDE_FLAG_BY_ID ? ability : null;
  // eslint-disable-next-line names/no-new-dex-name -- the one ability both sides read; field-ability-census.spec.ts holds it to the Dex
  const fact = ability === 'flowergift' ? 'defenderflowergift' : ability;
  return fact in DEFENDER_SIDE_FLAG_BY_ID ? fact : null;
}

export const TERRAIN_BY_ID: Record<string, NonNullable<CalcTerrain>> = {
  electricterrain: 'Electric',
  grassyterrain: 'Grassy',
  psychicterrain: 'Psychic',
  mistyterrain: 'Misty',
};
