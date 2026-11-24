import type { Battle, Pokemon } from '@pkmn/sim';
import { bodyOf, type SimBody } from '../calc/body.ts';
import { bodyAsClicked } from '../calc/tera-click.ts';
import { standingScreens } from '@fulllifegames/replay-core';

// The state of one hit, frozen as plain data when the sim rolls it: all the turn changed before the hit is in it.

export type BodySnapshot = SimBody;

export interface HitSnapshot {
  gen: number;
  moveId: string;
  moveName: string;
  spreadHit: boolean;
  attacker: BodySnapshot;
  defender: BodySnapshot;
  weather: string;
  terrain: string;
  rooms: string[];
  /** Reflect, Light Screen, Aurora Veil on the defender's side. */
  screens: string[];
  attackerPartner: string | null;
  defenderPartner: string | null;
  fieldAbilities: string[];
  helpingHand: boolean;
  /** Substitute, Focus Sash or Sturdy on full HP, Disguise, Ice Face: the roll alone does not decide the kill. */
  shielded: string | null;
  /** Battle Armor, Shell Armor, Lucky Chant: no crit whatever the roll says. */
  critBlocked: boolean;
}

// oracle: packages/eval-engine/test/rooms-oracle.spec.ts
export const ROOMS = ['gravity', 'magicroom', 'wonderroom'];

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

/** The hit as it stands now; `tera`: the attacker clicks Tera with the move and is read as the click makes it. */
export function snapshotPair(battle: Battle, attacker: Pokemon, defender: Pokemon, moveId: string, spreadHit: boolean, tera = false): HitSnapshot {
  const onField = battle.sides.flatMap(side => side.active).filter(mon => mon && !mon.fainted);
  return {
    gen: battle.gen,
    moveId,
    moveName: battle.dex.moves.get(moveId).name,
    spreadHit,
    attacker: bodyAsClicked(battle, attacker, tera),
    defender: bodyOf(battle, defender),
    weather: battle.field.effectiveWeather(),
    terrain: battle.field.effectiveTerrain(),
    rooms: ROOMS.filter(id => battle.field.pseudoWeather[id]),
    screens: standingScreens(defender.side),
    attackerPartner: partnerAbility(attacker),
    defenderPartner: partnerAbility(defender),
    fieldAbilities: onField.map(mon => mon.ability),
    helpingHand: !!attacker.volatiles['helpinghand'],
    shielded: shieldOf(defender),
    critBlocked: ['battlearmor', 'shellarmor'].includes(defender.ability) || !!defender.side.sideConditions['luckychant'],
  };
}

export function captureHit(battle: Battle): HitSnapshot {
  const move = battle.activeMove!;
  return snapshotPair(battle, battle.activePokemon!, battle.activeTarget!, move.id, !!move.spreadHit);
}
