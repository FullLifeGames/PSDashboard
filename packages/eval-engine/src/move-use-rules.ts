import type { MoveField, MoveLike, MoveTarget, MoveUser } from './move-use.ts';

/**
 * The move's own rule at use (round 57): what the simulator's onModifyType,
 * onModifyMove and basePowerCallback of that move decide. A partial answer
 * overrides the catalog; null means a needed fact is unknown.
 */
export type Own = { type?: string; category?: string; basePower?: number } | null;
type Rule = (move: MoveLike, user: MoveUser, field: MoveField, target: MoveTarget) => Own;

const FORM_TYPES: Record<string, Record<string, string>> = {
  ivycudgel: {
    'Ogerpon-Wellspring': 'Water', 'Ogerpon-Wellspring-Tera': 'Water',
    'Ogerpon-Hearthflame': 'Fire', 'Ogerpon-Hearthflame-Tera': 'Fire',
    'Ogerpon-Cornerstone': 'Rock', 'Ogerpon-Cornerstone-Tera': 'Rock',
  },
  ragingbull: { 'Tauros-Paldea-Combat': 'Fighting', 'Tauros-Paldea-Blaze': 'Fire', 'Tauros-Paldea-Aqua': 'Water' },
  aurawheel: { 'Morpeko-Hangry': 'Dark' },
};

const byForm: Rule = (move, user) => (user.species === undefined ? null : { type: FORM_TYPES[move.id][user.species] ?? move.type });

const ITEM_TYPE: Record<string, (item: NonNullable<MoveUser['item']>) => string | undefined> = {
  judgment: item => item.onPlate,
  multiattack: item => item.onMemory,
  technoblast: item => item.onDrive,
  naturalgift: item => item.naturalGift?.type,
};

/** Plates, memories, drives, berries; Klutz ignores the item (the ability is keyed). */
const byItem: Rule = (move, user) => {
  if (user.item === undefined) return null;
  const item = user.abilities.includes('klutz') ? null : user.item;
  const type = item ? ITEM_TYPE[move.id](item) : undefined;
  if (move.id === 'naturalgift') return type && item?.naturalGift ? { type, basePower: item.naturalGift.basePower } : { basePower: 0 };
  return { type: type ?? move.type };
};

/** Revelation Dance: the first type after a Tera click (a Stellar Tera keeps the old types). */
const byUserType: Rule = (_move, user) => {
  if (!user.types || user.terastallized === undefined) return null;
  const tera = user.terastallized;
  const types = tera && tera !== 'Stellar' ? [tera] : user.types;
  const first = types[0] === 'Bird' ? '???' : types[0];
  return { type: first === '???' && types[1] ? types[1] : first };
};

const WEATHER_TYPES: Record<string, string> = {
  sunnyday: 'Fire', desolateland: 'Fire', raindance: 'Water', primordialsea: 'Water',
  sandstorm: 'Rock', hail: 'Ice', snowscape: 'Ice',
};
const TERRAIN_TYPES: Record<string, string> = {
  electricterrain: 'Electric', grassyterrain: 'Grass', mistyterrain: 'Fairy', psychicterrain: 'Psychic',
};

/** Weather Ball: the user's effective weather (Umbrella and Cloud Nine already applied by the caller), power doubled. */
const byWeather: Rule = (move, _user, field) => {
  if (field.weather === undefined) return null;
  const type = WEATHER_TYPES[field.weather];
  return type ? { type, basePower: move.basePower * 2 } : {};
};

/** Terrain Pulse: the terrain's type and double power, for a grounded user. */
const byTerrain: Rule = (move, user, field) => {
  if (field.terrain === undefined || user.grounded === undefined) return null;
  const type = user.grounded ? TERRAIN_TYPES[field.terrain] : undefined;
  return type ? { type, basePower: move.basePower * 2 } : {};
};

/** Struggle is typeless from gen 2 on. */
const byStruggle: Rule = (_move, user) => (user.gen >= 2 ? { type: '???' } : {});

export const OWN_RULES: Record<string, Rule> = {
  ivycudgel: byForm,
  ragingbull: byForm,
  aurawheel: byForm,
  judgment: byItem,
  multiattack: byItem,
  technoblast: byItem,
  naturalgift: byItem,
  revelationdance: byUserType,
  struggle: byStruggle,
  weatherball: byWeather,
  terrainpulse: byTerrain,
};
