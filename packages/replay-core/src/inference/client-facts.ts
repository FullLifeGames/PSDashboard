import { dexOf } from '../rules-dex.ts';
import type { ClientIdent } from '../protocol/parser-state.ts';
import { revealedField } from '../team-info.ts';
import { speciesAbilityFor } from '../team/dex-legal.ts';
import { toId } from '../ids.ts';
import { findPokemon, type InferrerState } from './inferrer-state.ts';
import type { RevealedPokemonInfo } from '../types.ts';
import { arg, fromEffect, identOf, keyOf, ofIdent, type LogLine } from './log-line.ts';

/**
 * Abilities and items the inference adopts from its own @pkmn/client walk, and the moves it books by the client's rule.
 * Where the client is wrong or blind, the inference keeps its own handlers: the list is in ARCHITECTURE.md, "Replay to teams".
 */

type ClientPokemon = NonNullable<ReturnType<NonNullable<InferrerState['hitWalk']>['battle']['getPokemon']>>;

/** Item marks of an item the Pokémon showed as its own; every other mark is an item it took (Trick, Thief, Pickup, Harvest). */
const OWN_ITEM_EFFECTS = new Set(['', 'disturbed', 'frisked']);
/** `[from] item:` damage that hurts the attacker: the client gives it to the damaged body when a reconstructed log drops [of]. */
// oracle: packages/replay-core/test/attacker-punish-items-oracle.spec.ts
export const ATTACKER_PUNISH_ITEMS = new Set(['rockyhelmet', 'jabocaberry', 'rowapberry']);

export function clientPokemon(state: InferrerState, ident: string): ClientPokemon | null {
  try {
    return state.hitWalk?.battle.getPokemon(ident as ClientIdent) ?? null;
  } catch {
    return null;
  }
}

/**
 * The ident a move line's move books to. A body under Transform uses its target's moves, so the move books to the target,
 * through every copy (Generation 1 lets a body copy a copy). '' when the client has no body or the copies loop back.
 */
export function bookingIdent(state: InferrerState, ident: string): string {
  let mon = clientPokemon(state, ident);
  const seen = new Set<ClientPokemon>();
  while (mon?.volatiles.transform) {
    if (seen.has(mon)) return '';
    seen.add(mon);
    const target = (mon.volatiles.transform as { pokemon?: ClientPokemon }).pokemon;
    if (!target) return '';
    mon = target;
  }
  return seen.size && mon ? mon.originalIdent : ident;
}

/** The move to book for the line, or '': not Struggle, not one an ability called or reflected; a move another move called books the caller. */
export function ownMove(state: InferrerState, line: LogLine): string {
  const moveName = arg(line, 2);
  if (toId(moveName) === 'struggle') return '';
  const from = fromEffect(line);
  if (!from.name || toId(from.name) === 'pursuit' || toId(from.name) === 'sleeptalk') return moveName;
  // A move line prints `[from] <effect.fullname>`: a move effect is `move: X`, a condition its bare name. A `callsMove` move
  // (Metronome, Copycat) names the called move on the line, so the caller books; any other move effect (a Pledge combination,
  // Round) pulled the user's own move forward. A bare condition (Magic Coat, Snatch) books nothing, but older logs write a
  // caller bare (`[from]Nature Power`), and the caller still books.
  const calls = !!dexOf(state).moves.get(from.name).callsMove;
  if (from.type === 'move') return calls ? from.name : moveName;
  return !from.type && calls ? from.name : '';
}

function sameSpecies(state: InferrerState, clientForme: string, species: string): boolean {
  const dex = dexOf(state);
  const base = (name: string) => toId(dex.species.get(name.replace(/-\*$/, '')).baseSpecies || name);
  return base(clientForme) === base(species);
}

function swapped(state: InferrerState, key: string): boolean {
  return [...state.swappedIdents.keys()].some(ident => keyOf(ident) === key);
}

/** Only an ability the team species may hold: the Dex keeps a Mega's or a Tera forme's ability off the set. */
function adoptAbility(state: InferrerState, info: RevealedPokemonInfo, client: ClientPokemon) {
  if (info.ability.value || !client.baseAbility) return;
  const dex = dexOf(state);
  const name = dex.abilities.get(client.baseAbility).name;
  // The species' own spelling: the client keeps only the id, and "As One" is the id of no gen 9 ability ("As One (Spectrier)").
  const own = speciesAbilityFor(dex, info.species.replace(/-\*$/, ''), name) ?? (state.freeAbilities ? name : '');
  if (own) info.ability = revealedField(own);
}

/** The item held as its own, or the one it lost ("(consumed)"), only where no swap ever touched the body. */
function adoptItem(state: InferrerState, info: RevealedPokemonInfo, client: ClientPokemon, key: string) {
  const itemOpen = !info.item.value || info.item.value === '(has item)';
  if (!itemOpen || swapped(state, key)) return;
  const dex = dexOf(state);
  if (client.item) {
    if (!OWN_ITEM_EFFECTS.has(client.itemEffect ?? '') || ATTACKER_PUNISH_ITEMS.has(client.item)) return;
    const item = dex.items.get(client.item);
    if (item.exists) info.item = revealedField(item.name);
  } else if (client.lastItem) {
    const item = dex.items.get(client.lastItem);
    if (item.exists) info.item = revealedField(`${item.name} (consumed)`);
  }
}

function adoptFor(state: InferrerState, ident: string) {
  const subject = identOf(ident);
  if (!subject || subject.side !== state.opponentSide) return;
  const client = clientPokemon(state, ident);
  const info = findPokemon(state, subject.name);
  if (!client || !info || !sameSpecies(state, client.speciesForme, info.species)) return;
  adoptAbility(state, info, client);
  adoptItem(state, info, client, keyOf(ident));
}

export function syncClientFacts(state: InferrerState, line: LogLine) {
  for (const ident of [arg(line, 1), ofIdent(line)]) if (ident) adoptFor(state, ident);
}
