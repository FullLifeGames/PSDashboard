import type { Pokemon } from '@pkmn/client';
import { statIds } from '../rules-dex.ts';
import type { DamageObservation, ParadoxReading, StatId } from '../types.ts';
import type { ClientIdent, ParserState } from './parser-state.ts';

const PARADOX_VOLATILES = ['protosynthesis', 'quarkdrive'];
const BOOSTABLE = statIds().filter(stat => stat !== 'hp') as StatId[];

/**
 * The stat an active Protosynthesis or Quark Drive raises. The client keeps the activation line's suffix ('protosynthesisatk')
 * as the `stat` of the volatile 'protosynthesis' or 'quarkdrive', not as a volatile of its own.
 */
function statOf(mon: Pokemon): StatId | undefined {
  for (const volatile of PARADOX_VOLATILES) {
    const stat = (mon.volatiles[volatile] as { stat?: string } | undefined)?.stat;
    if (BOOSTABLE.includes(stat as StatId)) return stat as StatId;
  }
  return undefined;
}

/**
 * The activation line of Protosynthesis or Quark Drive. The simulator picks the stat to raise there (getBestStat on the
 * Pokémon's staged stats), so the client's stages before the line applies are the ones the choice was made at: an Intimidate
 * that came before counts, a Swords Dance that comes after does not (round 69, T167).
 */
export function noteParadoxStart(state: ParserState, line: string) {
  const mon = state.battle.getPokemon((line.split('|')[2] ?? '') as ClientIdent);
  if (mon) state.paradoxStages.set(mon, { ...mon.boosts });
}

function readingOf(state: ParserState, mon: Pokemon): ParadoxReading | undefined {
  const stat = statOf(mon);
  return stat ? { stat, stages: state.paradoxStages.get(mon) ?? { ...mon.boosts } } : undefined;
}

/** The paradox fields of one hit: each Pokémon's active ability stat with the stages it was chosen at, absent for the others. */
export function paradoxFieldsOf(state: ParserState, attacker: Pokemon, defender: Pokemon): Pick<DamageObservation, 'attackerParadox' | 'defenderParadox'> {
  const attackerParadox = readingOf(state, attacker);
  const defenderParadox = readingOf(state, defender);
  return { ...(attackerParadox ? { attackerParadox } : {}), ...(defenderParadox ? { defenderParadox } : {}) };
}
