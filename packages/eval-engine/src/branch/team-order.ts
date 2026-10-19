import type { PokemonSet } from '@pkmn/sim';
import { speciesBaseId, toId } from '@fulllifegames/replay-core';
import type { PokemonIdent } from './types.ts';

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
    const free = team.filter(set => !claimed.has(set));
    const exact = (name ? free.find(set => set.name === name) : undefined) ??
      free.find(set => (nameId !== '' && toId(set.species) === nameId) || sameBodyName(set.name, name));
    if (exact) {
      claimed.add(exact);
      continue;
    }
    const base = speciesBaseId(name);
    const byBase = free.filter(set => speciesBaseId(set.species) === base);
    if (byBase.length !== 1) return team;
    claimed.add(byBase[0]);
  }
  return team.filter(set => claimed.has(set));
}

/**
 * Whether two names are one body's name. The simulator carries the replay's own name, so the exact text is the key; an
 * equal id is the fallback for a spelling that differs in case or marks. An id of "" (a Chinese or Japanese name, an
 * emoji) is no key: it would match every such body of the side.
 */
export function sameBodyName(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const id = toId(a);
  return id !== '' && id === toId(b);
}

/** The first item named `name` exactly, else the first with the same name by `sameBodyName`. */
export function findByName<T>(items: readonly T[], nameOf: (item: T) => string | undefined, name: string | undefined): T | undefined {
  if (!name) return undefined;
  return items.find(item => nameOf(item) === name) ?? items.find(item => sameBodyName(nameOf(item), name));
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
    const leadSpeciesId = toId(lead.species);
    const named = lead.name ? remaining.filter(pokemon => pokemon.name === lead.name) : [];
    const sameId = named.length > 0 ? named : remaining.filter(pokemon => sameBodyName(pokemon.name, lead.name));
    // One name on two bodies: the lead's species tells them apart.
    const byName = sameId.find(pokemon => toId(pokemon.species) === leadSpeciesId) ?? sameId[0];
    const pokemon = byName ?? remaining.find(candidate =>
      toId(candidate.species) === leadSpeciesId ||
      toId(candidate.name || '') === leadSpeciesId
    );
    if (pokemon) {
      remaining.splice(remaining.indexOf(pokemon), 1);
      orderedLeads.push(pokemon);
    }
  }

  return [...orderedLeads, ...remaining];
}
