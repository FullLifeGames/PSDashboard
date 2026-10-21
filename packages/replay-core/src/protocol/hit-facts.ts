import type { Pokemon } from '@pkmn/client';
import { ATTACKER_SIDE_FLAG_BY_ID, FIELD_FLAG_BY_ID, allyFactOf } from '../calc-field.ts';
import type { AllyReading, DamageObservation } from '../types.ts';
import { noteParadoxStart } from './paradox-reading.ts';
import { noteSurvivalMarker } from './survival-marker.ts';
import type { ClientIdent, ParserState, PendingMove } from './parser-state.ts';

/** The start line of Supreme Overlord: the simulator adds a silent `fallenN` start for the fallen it counted when the holder came in. */
const FALLEN = /^fallen(\d+)$/;

const hpFraction = (mon: Pokemon) => (mon.maxhp > 0 ? mon.hp / mon.maxhp : 1);

/** The Pokémon beside `mon` on its side in a doubles battle, none in singles or when the partner has fainted. */
function allyOf(mon: Pokemon): Pokemon | undefined {
  return mon.side.active.find(other => other && other !== mon && !other.fainted) ?? undefined;
}

/** An `|-endability|` line (Gastro Acid): the client clears the ability and keeps no volatile, so the parser notes who lost it. */
export function noteAbilityEnd(state: ParserState, line: string) {
  const mon = state.battle.getPokemon((line.split('|')[2] ?? '') as ClientIdent);
  if (mon) state.abilityEnded.add(mon);
}

/** A line that changes an ability's own state: the stat a Paradox ability picks (T167), or the ability a Gastro Acid ends. */
export function noteAbilityState(state: ParserState, line: string) {
  if (line.startsWith('|-endability|')) noteAbilityEnd(state, line);
  else if (line.startsWith('|-ability|')) noteSurvivalMarker(state, line);
  else noteParadoxStart(state, line);
}

/** A switch or drag: the Pokémon leaving the slot gets its ability back. Called before the client applies the line. */
export function forgetAbilityEnd(state: ParserState, line: string) {
  const ident = line.split('|')[2] ?? '';
  const side = ident.startsWith('p1') ? state.battle.p1 : state.battle.p2;
  const leaving = side.active[ident.charCodeAt(2) - 'a'.charCodeAt(0)];
  if (leaving) state.abilityEnded.delete(leaving);
}

/**
 * Whether the ability is gone at the hit: Gastro Acid (an ended ability) takes it, and so does an active Neutralizing Gas (the
 * client's `ngasActive`). The solver asks the Dex which abilities the gas cannot suppress.
 */
function suppressed(state: ParserState, mon: Pokemon): boolean {
  return state.abilityEnded.has(mon) || !!mon.volatiles.gastroacid || state.battle.ngasActive();
}

/** The field facts of the hit by id: see `DamageObservation.fieldFacts`. */
function fieldFactsOf(state: ParserState, attacker: Pokemon, defender: Pokemon): string[] {
  const { battle } = state;
  const found = new Set<string>();
  for (const mon of battle.getAllActive()) {
    const ability = mon.effectiveAbility();
    if (ability in FIELD_FLAG_BY_ID) found.add(ability);
  }
  for (const condition of Object.keys(battle.field.pseudoWeather)) if (condition in FIELD_FLAG_BY_ID) found.add(condition);
  for (const volatile of Object.keys(attacker.volatiles)) if (volatile in ATTACKER_SIDE_FLAG_BY_ID) found.add(volatile);
  const attackerFact = allyFactOf('attacker', allyOf(attacker)?.effectiveAbility() ?? '');
  if (attackerFact) found.add(attackerFact);
  const defenderFact = allyFactOf('defender', allyOf(defender)?.effectiveAbility() ?? '');
  if (defenderFact) found.add(defenderFact);
  return [...found].sort();
}

/** The living partner of `mon` as the solver reads it (T203); undefined in singles and when the partner has fainted. */
function allyReading(mon: Pokemon): AllyReading | undefined {
  const ally = allyOf(mon);
  if (!ally) return undefined;
  const ability = ally.effectiveAbility();
  return { species: ally.speciesForme, ...(ability ? { ability } : {}), ...(!(ally.ability || ally.baseAbility) ? { unrevealed: true } : {}) };
}

/** The living partners of the hit (T203). */
function partnerFactsOf(attacker: Pokemon, defender: Pokemon): Partial<DamageObservation> {
  const attackerAlly = allyReading(attacker);
  const defenderAlly = allyReading(defender);
  return { ...(attackerAlly ? { attackerAlly } : {}), ...(defenderAlly ? { defenderAlly } : {}) };
}

/** The history a move's power can read (T210): the fallen of the attacker's side and the hits it took (group 1), the defender's status (group 2). */
function historyFactsOf(attacker: Pokemon, defender: Pokemon): Partial<DamageObservation> {
  const attackerFainted = attacker.side.team.filter(mon => mon.fainted).length;
  return {
    ...(attackerFainted > 0 ? { attackerFainted } : {}),
    ...(attacker.timesAttacked > 0 ? { attackerTimesAttacked: attacker.timesAttacked } : {}),
    ...(defender.status ? { defenderStatus: defender.status } : {}),
  };
}

/**
 * What the client battle shows at the damage line besides the stages, the item and the weather (round 69, T86): the move's name,
 * the terrain, the Terastallized types, both HP fractions, the fallen of Supreme Overlord, the abilities and the field facts. The
 * client is read before the line applies, so the HP is the pre-hit HP. The solver hands them to the calculator.
 */
export function hitFactsOf(state: ParserState, move: PendingMove, attacker: Pokemon, defender: Pokemon): Partial<DamageObservation> {
  const fallen = Object.keys(attacker.volatiles).map(volatile => FALLEN.exec(volatile)?.[1]).find(count => count !== undefined);
  const facts = fieldFactsOf(state, attacker, defender);
  return {
    moveName: move.moveName,
    terrain: state.battle.field.terrain || '',
    attackerHp: hpFraction(attacker),
    defenderHp: hpFraction(defender),
    ...(attacker.terastallized ? { attackerTera: attacker.terastallized } : {}),
    ...(defender.terastallized ? { defenderTera: defender.terastallized } : {}),
    ...(fallen ? { attackerFallen: parseInt(fallen, 10) } : {}),
    ...(attacker.ability ? { attackerAbility: attacker.ability } : {}),
    ...(defender.ability ? { defenderAbility: defender.ability } : {}),
    ...(suppressed(state, attacker) ? { attackerSuppressed: true } : {}),
    ...(suppressed(state, defender) ? { defenderSuppressed: true } : {}),
    ...(attacker.ability && attacker.volatiles[attacker.ability] ? { attackerAbilityOn: true } : {}),
    ...(facts.length > 0 ? { fieldFacts: facts } : {}),
    ...partnerFactsOf(attacker, defender),
    ...historyFactsOf(attacker, defender),
  };
}
