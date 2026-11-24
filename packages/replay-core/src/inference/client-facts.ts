import { dexOf } from '../rules-dex.ts';
import type { ClientIdent } from '../protocol/parser-state.ts';
import { revealedField } from '../team-info.ts';
import { speciesAbilityFor } from '../team/dex-legal.ts';
import { toId } from '../ids.ts';
import { findPokemon, type InferrerState } from './inferrer-state.ts';
import type { RevealedPokemonInfo } from '../types.ts';
import { arg, fromEffect, identOf, keyOf, ofIdent, type LogLine } from './log-line.ts';

// Where the client is wrong or blind the inference keeps its own handlers: ARCHITECTURE.md "Replay to teams".

type ClientPokemon = NonNullable<ReturnType<NonNullable<InferrerState['hitWalk']>['battle']['getPokemon']>>;

// Item marks for an item shown as its own; every other mark is an item it took (Trick, Thief, Pickup, Harvest).
const OWN_ITEM_EFFECTS = new Set(['', 'disturbed', 'frisked']);
/** `[from] item:` damage that hurts the attacker; the client credits the damaged body when a log drops [of]. */
// oracle: packages/replay-core/test/attacker-punish-items-oracle.spec.ts
export const ATTACKER_PUNISH_ITEMS = new Set(['rockyhelmet', 'jabocaberry', 'rowapberry']);

export function clientPokemon(state: InferrerState, ident: string): ClientPokemon | null {
  try {
    return state.hitWalk?.battle.getPokemon(ident as ClientIdent) ?? null;
  } catch {
    return null;
  }
}

/** The ident a move books to: under Transform the target's, through every copy (Gen 1); '' when none. */
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

/** The move to book for the line, or '': not Struggle, not one an ability called or reflected. */
export function ownMove(state: InferrerState, line: LogLine): string {
  const moveName = arg(line, 2);
  if (toId(moveName) === 'struggle') return '';
  const from = fromEffect(line);
  if (!from.name || toId(from.name) === 'pursuit' || toId(from.name) === 'sleeptalk') return moveName;
  // `[from] move: X` books X when X calls a move (Metronome), else the user's own move (Pledge); a bare condition
  // (Magic Coat, Snatch) books nothing, but older logs write the caller bare (`[from]Nature Power`) and it books.
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

function adoptAbility(state: InferrerState, info: RevealedPokemonInfo, client: ClientPokemon) {
  if (info.ability.value || !client.baseAbility) return;
  const dex = dexOf(state);
  const name = dex.abilities.get(client.baseAbility).name;
  // The species' own spelling: the client keeps only the id, and "As One" is the id of no gen 9 ability.
  const own = speciesAbilityFor(dex, info.species.replace(/-\*$/, ''), name) ?? (state.freeAbilities ? name : '');
  if (own) info.ability = revealedField(own);
}

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
