import type { Field } from '@smogon/calc';


type CalcFieldOptions = ConstructorParameters<typeof Field>[0];
type CalcWeather = NonNullable<CalcFieldOptions>['weather'];
type CalcTerrain = NonNullable<CalcFieldOptions>['terrain'];

/** The calculator's weather label by the simulator's condition id. */
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

/** Calculator flags by the Dex id that sets them; the calculator's check leaves out the holder. */
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

export function allyFactOf(role: 'attacker' | 'defender', ability: string): string | null {
  if (role === 'attacker') return ability in ATTACKER_SIDE_FLAG_BY_ID ? ability : null;
  // eslint-disable-next-line names/no-new-dex-name -- the one ability both sides read; field-ability-census.spec.ts holds it to the Dex
  const fact = ability === 'flowergift' ? 'defenderflowergift' : ability;
  return fact in DEFENDER_SIDE_FLAG_BY_ID ? fact : null;
}

/** The calculator's terrain label by the simulator's condition id. */
export const TERRAIN_BY_ID: Record<string, NonNullable<CalcTerrain>> = {
  electricterrain: 'Electric',
  grassyterrain: 'Grassy',
  psychicterrain: 'Psychic',
  mistyterrain: 'Misty',
};
