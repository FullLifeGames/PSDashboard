import { Teams } from '@pkmn/sim';
import type { SimBattle } from './types.ts';
import { findPokemonOnSide } from './protocol-choices.ts';

/**
 * Round 67 (G4): the protocol names a body by its nickname (p1a: Last
 * Regrets), the sim by the name of its built set (p1a: Landorus). The hax
 * alignment keys faints, misses, crits and secondaries by that name, so a
 * nicknamed body's events never met the sim's, and a trial in which it
 * fainted scored worse than one in which it lived (751543 t19: the alignment
 * chose a Draco Meteor miss, and the surviving Landorus taunted Dragapult).
 * The protocol's own lines say which species each nickname stands for.
 */

/** `p1: <nickname>` -> species, from switch, drag and replace details and team sheets (switch details win). */
export function protocolNicknames(replayLog: string): Map<string, string> {
  const nicknames = new Map<string, string>();
  const sheets: [string, string][] = [];
  for (const line of replayLog.split('\n')) {
    const entry = line.match(/^\|(?:switch|drag|replace)\|(p[12])[a-d]?: ([^|]*)\|([^,|]+)/);
    if (entry) {
      nicknames.set(`${entry[1]}: ${entry[2].trim()}`, entry[3].trim());
    } else if (line.startsWith('|showteam|')) {
      const [, , side, ...packed] = line.split('|');
      for (const set of Teams.unpack(packed.join('|')) ?? []) sheets.push([`${side}: ${set.name}`, set.species || set.name]);
    }
  }
  for (const [key, species] of sheets) if (!nicknames.has(key)) nicknames.set(key, species);
  return nicknames;
}

/** The lines with every protocol ident renamed to the sim's name of the body of that species. */
export function simNamedLines(lines: string[], nicknames: Map<string, string>, battle: SimBattle): string[] {
  const simNames = new Map<string, string | null>();
  const simName = (side: string, nickname: string): string | null => {
    const key = `${side}: ${nickname}`;
    if (!simNames.has(key)) {
      const species = nicknames.get(key);
      const body = species ? findPokemonOnSide(battle.sides[side === 'p1' ? 0 : 1], species) : null;
      simNames.set(key, body?.name ?? null);
    }
    return simNames.get(key) ?? null;
  };
  return lines.map(line => line.replace(/(p[12])([a-d]?): ([^|]+)/g, (ident, side: string, slot: string, nickname: string) => {
    const name = simName(side, nickname.trim());
    return name && name !== nickname.trim() ? `${side}${slot}: ${name}` : ident;
  }));
}
