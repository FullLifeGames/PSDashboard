import type { Pokemon } from '@pkmn/client';
import { ATTACKER_SIDE_FLAG_BY_ID, FIELD_FLAG_BY_ID, allyFactOf } from '../calc-field.ts';
import type { AllyReading, DamageObservation } from '../types.ts';
import { noteParadoxStart } from './paradox-reading.ts';
import { noteSurvivalMarker } from './survival-marker.ts';
import type { ClientIdent, ParserState, PendingMove } from './parser-state.ts';

// Supreme Overlord: the simulator adds a silent `fallenN` start for the fallen it counted when the holder came in.
const FALLEN = /^fallen(\d+)$/;

const hpFraction = (mon: Pokemon) => (mon.maxhp > 0 ? mon.hp / mon.maxhp : 1);

function allyOf(mon: Pokemon): Pokemon | undefined {
  return mon.side.active.find(other => other && other !== mon && !other.fainted) ?? undefined;
}

/** An `|-endability|` line (Gastro Acid): the client clears the ability, keeps no volatile; the parser notes it. */
export function noteAbilityEnd(state: ParserState, line: string) {
  const mon = state.battle.getPokemon((line.split('|')[2] ?? '') as ClientIdent);
  if (mon) state.abilityEnded.add(mon);
}

export function noteAbilityState(state: ParserState, line: string) {
  if (line.startsWith('|-endability|')) noteAbilityEnd(state, line);
  else if (line.startsWith('|-ability|')) noteSurvivalMarker(state, line);
  else noteParadoxStart(state, line);
}

/** A switch or drag gives the leaving Pokémon its ability back; call before the client applies the line. */
export function forgetAbilityEnd(state: ParserState, line: string) {
  const ident = line.split('|')[2] ?? '';
  const side = ident.startsWith('p1') ? state.battle.p1 : state.battle.p2;
  const leaving = side.active[ident.charCodeAt(2) - 'a'.charCodeAt(0)];
  if (leaving) state.abilityEnded.delete(leaving);
}

// Gastro Acid and an active Neutralizing Gas (the client's `ngasActive`) take it; the solver asks the Dex who resists.
function suppressed(state: ParserState, mon: Pokemon): boolean {
  return state.abilityEnded.has(mon) || !!mon.volatiles.gastroacid || state.battle.ngasActive();
}

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

function allyReading(mon: Pokemon): AllyReading | undefined {
  const ally = allyOf(mon);
  if (!ally) return undefined;
  const ability = ally.effectiveAbility();
  return { species: ally.speciesForme, ...(ability ? { ability } : {}), ...(!(ally.ability || ally.baseAbility) ? { unrevealed: true } : {}) };
}

function partnerFactsOf(attacker: Pokemon, defender: Pokemon): Partial<DamageObservation> {
  const attackerAlly = allyReading(attacker);
  const defenderAlly = allyReading(defender);
  return { ...(attackerAlly ? { attackerAlly } : {}), ...(defenderAlly ? { defenderAlly } : {}) };
}

function historyFactsOf(attacker: Pokemon, defender: Pokemon): Partial<DamageObservation> {
  const attackerFainted = attacker.side.team.filter(mon => mon.fainted).length;
  return {
    ...(attackerFainted > 0 ? { attackerFainted } : {}),
    ...(attacker.timesAttacked > 0 ? { attackerTimesAttacked: attacker.timesAttacked } : {}),
    ...(defender.status ? { defenderStatus: defender.status } : {}),
  };
}

const slotKeyOf = (mon: Pokemon) => `p${mon.side.n + 1}${String.fromCharCode(97 + mon.side.active.indexOf(mon))}`;

function turnFactsOf(state: ParserState, attacker: Pokemon, defender: Pokemon): Partial<DamageObservation> {
  const acted = new Set([...state.actedThisTurn].map(ident => ident.slice(0, 3)));
  const others = state.battle.getAllActive().filter(mon => mon !== attacker && !mon.fainted);
  return {
    ...(defender.newlySwitched ? { defenderNewlyIn: true } : {}),
    ...(others.every(mon => acted.has(slotKeyOf(mon))) ? { lastToMove: true } : {}),
  };
}

/** What the client shows at the damage line besides stages, item and weather, read before it applies (pre-hit HP). */
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
    ...turnFactsOf(state, attacker, defender),
  };
}
