import type { PokemonSet } from '@pkmn/sim';
import { speciesBaseId } from '../replay-format';
import type { PokemonIdent } from './types';
import { toId } from '../ids';

/**
 * Fields only the brought species (VGC's 4 of 6, BSS's 3 of 6). Resolution
 * is per NAME: the exact species/nickname id first, then a UNIQUE
 * base-species match — the protocol reveals ACTIVE formes
 * (Zamazenta-Crowned) while built sets may carry the base name, and
 * 7-8-set teams holding both forme siblings must keep the exact one only.
 * Any unresolved or ambiguous name fails the side open (team stays whole).
 * Filtering preserves team order, so leads stay in front.
 */
export function trimTeamToBring(team: PokemonSet[], keep: string[] | undefined): PokemonSet[] {
  if (!keep || keep.length === 0 || keep.length >= team.length) return team;
  const claimed = new Set<PokemonSet>();
  for (const name of keep) {
    const nameId = toId(name);
    const exact = team.find(set =>
      !claimed.has(set) && (toId(set.species) === nameId || toId(set.name || '') === nameId));
    if (exact) {
      claimed.add(exact);
      continue;
    }
    const base = speciesBaseId(name);
    const byBase = team.filter(set => !claimed.has(set) && speciesBaseId(set.species) === base);
    if (byBase.length !== 1) return team;
    claimed.add(byBase[0]);
  }
  return team.filter(set => claimed.has(set));
}

const BATTLE_ONLY_FORME_SUFFIXES = ['terastal', 'stellar', 'tera'];

export function normalizeBattleOnlyFormeId(id: string): string {
  for (const suffix of BATTLE_ONLY_FORME_SUFFIXES) {
    if (id.endsWith(suffix)) return id.slice(0, -suffix.length);
  }
  return id;
}

export function slotLetter(index: number): string {
  return String.fromCharCode('a'.charCodeAt(0) + index);
}

export function formatTargetLoc(targetLoc: number): string {
  return targetLoc > 0 ? `+${targetLoc}` : `${targetLoc}`;
}

export function reorderForLeads(team: PokemonSet[], leads: PokemonIdent[]): PokemonSet[] {
  if (leads.length === 0) return [...team];

  const remaining = [...team];
  const orderedLeads: PokemonSet[] = [];
  for (const lead of leads) {
    const leadNameId = toId(lead.name);
    const leadSpeciesId = toId(lead.species);
    let idx = remaining.findIndex(pokemon => toId(pokemon.name || '') === leadNameId);
    if (idx < 0) {
      idx = remaining.findIndex(pokemon =>
        toId(pokemon.species) === leadSpeciesId ||
        toId(pokemon.name || '') === leadSpeciesId
      );
    }
    if (idx >= 0) {
      const [pokemon] = remaining.splice(idx, 1);
      orderedLeads.push(pokemon);
    }
  }

  return [...orderedLeads, ...remaining];
}
