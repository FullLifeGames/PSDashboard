import type { Pokemon } from '@pkmn/client';
import { statIds } from '../rules-dex.ts';
import type { DamageObservation, ParadoxReading, StatId } from '../types.ts';
import type { ClientIdent, ParserState } from './parser-state.ts';

const PARADOX_VOLATILES = ['protosynthesis', 'quarkdrive'];
const BOOSTABLE = statIds().filter(stat => stat !== 'hp') as StatId[];

// The client keeps the line's suffix ('protosynthesisatk') as the `stat` of the volatile, not as a volatile of its own.
function statOf(mon: Pokemon): StatId | undefined {
  for (const volatile of PARADOX_VOLATILES) {
    const stat = (mon.volatiles[volatile] as { stat?: string } | undefined)?.stat;
    if (BOOSTABLE.includes(stat as StatId)) return stat as StatId;
  }
  return undefined;
}

/** The simulator picks the stat there (`getBestStat` on staged stats): the stages before the line applies count. */
export function noteParadoxStart(state: ParserState, line: string) {
  const mon = state.battle.getPokemon((line.split('|')[2] ?? '') as ClientIdent);
  if (mon) state.paradoxStages.set(mon, { ...mon.boosts });
}

function readingOf(state: ParserState, mon: Pokemon): ParadoxReading | undefined {
  const stat = statOf(mon);
  return stat ? { stat, stages: state.paradoxStages.get(mon) ?? { ...mon.boosts } } : undefined;
}

export function paradoxFieldsOf(state: ParserState, attacker: Pokemon, defender: Pokemon): Pick<DamageObservation, 'attackerParadox' | 'defenderParadox'> {
  const attackerParadox = readingOf(state, attacker);
  const defenderParadox = readingOf(state, defender);
  return { ...(attackerParadox ? { attackerParadox } : {}), ...(defenderParadox ? { defenderParadox } : {}) };
}
