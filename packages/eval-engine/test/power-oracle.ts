import { Battle, Teams, toID } from '@pkmn/sim';
import type { ActiveMove, Pokemon, PokemonSet } from '@pkmn/sim';

/**
 * Round 63 (T81) test helpers: what the simulator itself uses for a move in a
 * real turn. The BasePower event carries the power after the move's own
 * basePowerCallback and before the modifier is applied; a handler on the
 * format with the lowest priority runs last and reads both. Fixed damage
 * (damageCallback) never reaches that event, so its oracle is the HP the
 * target loses.
 */

/** A battle of any custom format past team preview, every set in team order. */
export function battleOf(format: string, p1: PokemonSet[], p2: PokemonSet[], seed = '1,2,3,4'): Battle {
  const battle = new Battle({
    formatid: toID(format),
    seed,
    p1: { name: 'Alpha', team: Teams.pack(p1) },
    p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

export interface PowerSeen { basePower: number; modifier: number; target: string }

/**
 * Plays one turn with the given choices and returns every BasePower event of
 * `moveId` in it (one per hit and target).
 */
export function powerInTurn(battle: Battle, choices: { p1: string; p2: string }, moveId: string): PowerSeen[] {
  const seen: PowerSeen[] = [];
  battle.onEvent('BasePower', battle.format, -100, function (this: Battle, basePower: number, _source: Pokemon, target: Pokemon, move: ActiveMove) {
    if (move.id === moveId) seen.push({ basePower, modifier: this.event.modifier ?? 1, target: target.species.name });
  });
  battle.choose('p1', choices.p1);
  battle.choose('p2', choices.p2);
  return seen;
}

/** The power the simulator gives in one turn as a single number: power times modifier of the first hit. */
export function firstPower(seen: PowerSeen[]): number {
  if (seen.length === 0) throw new Error('the move never reached the BasePower event');
  return seen[0].basePower * seen[0].modifier;
}

/** Everything one call into the static could leave behind: the log, the dice, the bodies' state, the Dex move. */
export function fingerprint(battle: Battle, bodies: Pokemon[], moveId: string): string {
  const move = battle.dex.moves.get(moveId);
  return JSON.stringify({
    log: battle.log.length,
    seed: battle.prng.getSeed(),
    effectOrder: battle.effectOrder,
    eventDepth: battle.eventDepth,
    eventId: (battle.event as { id?: string } | undefined)?.id ?? null,
    bodies: bodies.map(body => ({
      hp: body.hp, status: body.status, item: body.item, ability: body.ability, isActive: body.isActive,
      boosts: body.boosts, volatiles: Object.keys(body.volatiles), weighthg: body.weighthg,
    })),
    move: JSON.stringify(move),
  });
}
