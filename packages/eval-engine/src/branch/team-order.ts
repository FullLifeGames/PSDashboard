import type { PokemonSet } from '@pkmn/sim';
import { speciesBaseId, toId } from '@fulllifegames/replay-core';
import { normalizeLineEndings } from '../line-endings.ts';
import type { PokemonIdent, SimBattle, SimPokemon } from './types.ts';

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

/**
 * Round 73 (T250): what the protocol says about a side's bench. `shown`: the ids (name and base species) of every body its
 * switch, drag, replace and detailschange lines name; a body outside the set never stood on the field. `fainted`: the slots
 * the block's own lines faint. The game left a slot empty only where its body fainted, so a slot the simulator wants filled
 * without a faint line in the block is the simulator's divergence, not the bring list. `goesOn`: the log plays on past the block.
 * At the log's last block (a forfeit, a win or a tie follows) an empty slot proves nothing about the bench: a player who forfeits
 * with bodies left leaves the same slot empty.
 */
export interface ProtocolBench {
  shown: ReadonlySet<string>;
  fainted: ReadonlySet<number>;
  goesOn: boolean;
}

/** Whether the log has a turn line after the given turn: the game played on with the slot empty. */
export function logGoesOn(replayLog: string, turn: number): boolean {
  return normalizeLineEndings(replayLog).split('\n').some(line => {
    const match = line.match(/^\|turn\|(\d+)/);
    return !!match && Number(match[1]) > turn;
  });
}

export function shownBodyIds(replayLog: string, sideId: 'p1' | 'p2'): Set<string> {
  const shown = new Set<string>();
  for (const line of normalizeLineEndings(replayLog).split('\n')) {
    const match = line.match(/^\|(?:switch|drag|replace|detailschange)\|(p[12])[a-d]?: ?([^|]*)\|([^,|]+)/);
    if (match?.[1] !== sideId) continue;
    for (const name of [match[2], match[3]]) shown.add(toId(name)).add(speciesBaseId(name));
  }
  return shown;
}

/** The slots of a side that a block's lines faint. */
export function faintedSlots(blockLines: readonly string[], sideId: 'p1' | 'p2'): Set<number> {
  const slots = new Set<number>();
  for (const line of blockLines) {
    const match = normalizeLineEndings(line).match(/^\|faint\|(p[12])([a-d]):/);
    if (match?.[1] === sideId) slots.add(match[2].charCodeAt(0) - 97);
  }
  return slots;
}

const wasShown = (body: SimPokemon, shown: ReadonlySet<string>) =>
  [body.name, body.species.name, body.baseSpecies.name].some(name => shown.has(toId(name)) || shown.has(speciesBaseId(name)));

/** Whether a body's species or set can carry an ability that changes how it shows on entry (the Dex's BeforeSwitchIn handler: Illusion). */
export const mayDisguise = (body: SimPokemon) =>
  [body.ability, body.baseAbility, ...Object.values(body.species.abilities)].some(name =>
    typeof (body.battle.dex.abilities.get(name) as { onBeforeSwitchIn?: unknown }).onBeforeSwitchIn === 'function');

/**
 * The game left a forced slot empty (every forced slot is one the block faints, and no switch followed for at least one): the living bench bodies the protocol never shows were not brought (a player with a
 * body to send sends it), so they leave the game as the simulator takes a fainted body out (no faint line, no fallen-ally
 * count) and the slot takes `pass`, which the simulator accepts once no living body waits. Nothing happens, and the old
 * answer stands, when the bench holds a shown body the log's answers leave over (the simulator diverged, not the bring
 * list) or a body that may disguise itself as another. True when bodies left.
 */
export function retireUnshownBench(battle: SimBattle, sideIdx: number, bench: ProtocolBench, answers: number, forcedSlots: number[]): boolean {
  const { shown, fainted, goesOn } = bench;
  if (!goesOn) return false;
  const side = battle.sides[sideIdx];
  const living = side.pokemon.filter(body => !body.isActive && !body.fainted);
  const phantoms = living.filter(body => !wasShown(body, shown));
  if (!forcedSlots.every(slot => fainted.has(slot))) return false;
  if (phantoms.length === 0 || living.length - phantoms.length > answers || phantoms.some(mayDisguise)) return false;
  for (const body of phantoms) {
    body.hp = 0;
    body.fainted = true;
    body.faintQueued = true;
    if (side.pokemonLeft > 0) side.pokemonLeft--;
  }
  side.clearChoice();
  if (side.pokemonLeft === 0) battle.checkWin();
  return true;
}
