import type { Battle, Pokemon } from '@pkmn/sim';

/**
 * Round 56: the state of one hit, frozen as plain data at the moment the
 * sim rolls it — the doubles pair plan's calc input (kill-table.ts) and the
 * flags its guards read. Taken from the live bodies and the live field, so
 * everything the turn changed before the hit (Intimidate, a weather set by
 * the partner, chip damage, a Tera click) is already in it.
 */

export interface BodySnapshot {
  species: string;
  level: number;
  /** Calc name ('' without); `abilityId` is the sim's id. */
  ability: string;
  abilityId: string;
  item: string;
  itemId: string;
  nature: string;
  evs: Record<string, number>;
  ivs: Record<string, number>;
  boosts: { atk: number; def: number; spa: number; spd: number; spe: number };
  hp: number;
  maxhp: number;
  status: string;
  tera: string | null;
}

export interface HitSnapshot {
  gen: number;
  moveId: string;
  moveName: string;
  /** The sim's spread flag: the move started against two or more targets. */
  spreadHit: boolean;
  attacker: BodySnapshot;
  defender: BodySnapshot;
  weather: string;
  terrain: string;
  /** Gravity, Magic Room, Wonder Room while they stand. */
  rooms: string[];
  /** Reflect, Light Screen, Aurora Veil on the defender's side. */
  screens: string[];
  attackerPartner: string | null;
  defenderPartner: string | null;
  /** Ability ids of every living body on the field (ruin, auras). */
  fieldAbilities: string[];
  helpingHand: boolean;
  /** Substitute, Focus Sash or Sturdy on full HP, Disguise, Ice Face: the roll alone does not decide the kill. */
  shielded: string | null;
  /** Battle Armor, Shell Armor, Lucky Chant: no crit whatever the roll says. */
  critBlocked: boolean;
}

const ROOMS = ['gravity', 'magicroom', 'wonderroom'];
const SCREENS = ['reflect', 'lightscreen', 'auroraveil'];

function body(battle: Battle, mon: Pokemon): BodySnapshot {
  return {
    species: mon.species.name,
    level: mon.level,
    ability: mon.ability ? battle.dex.abilities.get(mon.ability).name : '',
    abilityId: mon.ability,
    item: mon.item ? battle.dex.items.get(mon.item).name : '',
    itemId: mon.item,
    nature: mon.set.nature ?? '',
    evs: { ...mon.set.evs },
    ivs: { ...mon.set.ivs },
    boosts: { atk: mon.boosts.atk, def: mon.boosts.def, spa: mon.boosts.spa, spd: mon.boosts.spd, spe: mon.boosts.spe },
    hp: mon.hp,
    maxhp: mon.maxhp,
    status: mon.status,
    tera: mon.terastallized ?? null,
  };
}

/** The ability id of the living body next to `mon`, or null. */
function partnerAbility(mon: Pokemon): string | null {
  const partner = mon.side.active.find(other => other && other !== mon && !other.fainted);
  return partner ? partner.ability : null;
}

function shieldOf(defender: Pokemon): string | null {
  if (defender.volatiles['substitute']) return 'substitute';
  const full = defender.hp === defender.maxhp;
  if (full && defender.item === 'focussash') return 'sash';
  if (full && defender.ability === 'sturdy') return 'sturdy';
  if (defender.ability === 'disguise' && defender.species.id === 'mimikyu') return 'disguise';
  if (defender.ability === 'iceface' && defender.species.id === 'eiscue') return 'iceface';
  return null;
}

export function snapshotPair(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string, spreadHit: boolean): HitSnapshot {
  const onField = battle.sides.flatMap(side => side.active).filter(mon => mon && !mon.fainted);
  return {
    gen: battle.gen,
    moveId,
    moveName: battle.dex.moves.get(moveId).name,
    spreadHit,
    attacker: body(battle, attacker),
    defender: body(battle, defender),
    weather: battle.field.effectiveWeather(),
    terrain: battle.field.effectiveTerrain(),
    rooms: ROOMS.filter(id => battle.field.pseudoWeather[id]),
    screens: SCREENS.filter(id => defender.side.sideConditions[id]),
    attackerPartner: partnerAbility(attacker),
    defenderPartner: partnerAbility(defender),
    fieldAbilities: onField.map(mon => mon.ability),
    helpingHand: !!attacker.volatiles['helpinghand'],
    shielded: shieldOf(defender),
    critBlocked: ['battlearmor', 'shellarmor'].includes(defender.ability) || !!defender.side.sideConditions['luckychant'],
  };
}

/** The hit the sim rolls for right now: hitStepAccuracy and getSpreadDamage set the active target per target. */
export function captureHit(battle: Battle): HitSnapshot {
  const move = battle.activeMove!;
  return snapshotPair(battle, battle.activePokemon!, battle.activeTarget!, move.id, !!move.spreadHit);
}
