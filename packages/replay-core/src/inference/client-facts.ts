import { dexOf } from '../rules-dex.ts';
import type { ClientIdent } from '../protocol/parser-state.ts';
import { revealedField } from '../team-info.ts';
import { speciesAbilityFor } from '../team/dex-legal.ts';
import { toId } from '../ids.ts';
import { findPokemon, type InferrerState } from './inferrer-state.ts';
import type { RevealedPokemonInfo } from '../types.ts';
import { arg, fromEffect, identOf, keyOf, ofIdent, type LogLine } from './log-line.ts';

/**
 * Facts the inference reads from its own @pkmn/client walk (round 67, T108
 * step 2, spec decision 19). After each line the client's state gives every
 * Pokémon of the inferred side its ability and its item, where the inference
 * has none yet: this replaces the handlers for -ability lines, consumed
 * items, healing items, Mega Stones and the holder's own recoil items, and it
 * adds what no handler read, as the census of client against inference found
 * it (1692 team members of the bank and feedback games, 544 deviations in
 * 133 games): an ability a line names as its effect (230: `|-activate|p2a: X|
 * ability: Quark Drive`, a Queenly Majesty block, a Magic Bounce reflection)
 * and an item a line names on the holder's side (31: `[from] item: Toxic Orb`
 * on a status line, the item Poltergeist names). A move line books its move
 * by the client's rule (7: a Magic Bounce reflection, a move while
 * transformed and Struggle are no moves of the set; a move another move
 * called books the caller).
 * The inference keeps its own handlers where the census found the client
 * wrong or blind (R8): the team list and the preview's markers (the client
 * keeps preview entries it never matched; 15 item markers), the set item
 * before a swap (17, the client shows the item held now), the Tera type after
 * a faint (139, the client clears it), Natural Cure and Grassy Surge
 * attributions (2, the client misses them), the holder of Rocky Helmet,
 * Jaboca and Rowap Berry without [of], and a move's booking by nickname (3,
 * where the client's positions go astray). Ogerpon's Embody Aspect (2) stays
 * off the set because the Dex keeps a Tera forme's ability off its species;
 * the moves a `cant` line names (9) are booked from the line itself (T175).
 */

type ClientPokemon = NonNullable<ReturnType<NonNullable<InferrerState['hitWalk']>['battle']['getPokemon']>>;

/** Item marks of an item the Pokémon showed as its own; every other mark is an item it took (Trick, Thief, Pickup, Harvest). */
const OWN_ITEM_EFFECTS = new Set(['', 'disturbed', 'frisked']);
/**
 * Items whose `[from] item:` damage hurts the attacker: the inference reads
 * their holder itself ([of], else the damaged Pokémon's move target), the
 * client gives them to the damaged Pokémon when a reconstructed log drops
 * [of] (a stats-panel test pins that case).
 */
// oracle: packages/replay-core/test/attacker-punish-items-oracle.spec.ts
export const ATTACKER_PUNISH_ITEMS = new Set(['rockyhelmet', 'jabocaberry', 'rowapberry']);

/** The client's Pokémon behind an ident, as the client stands now; null when it has none. */
export function clientPokemon(state: InferrerState, ident: string): ClientPokemon | null {
  try {
    return state.hitWalk?.battle.getPokemon(ident as ClientIdent) ?? null;
  } catch {
    return null;
  }
}

/**
 * Round 89 (#139): the ident of the body a move line's move books to. A body under Transform uses the moves of its target, so its
 * line shows that the target knows the move: the client hands `rememberMove` on to `volatiles.transform.pokemon`, and again when that
 * body is itself a copy (Generation 1 lets a body copy a copy), so the move lands on the original. A body that is no copy books its
 * own move: the line's ident, as the line spells it. '' when the client has no body for the ident or the copies lead back to the line's
 * own body (nothing to book).
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

/**
 * Whether the move line's move belongs to its user's set, as the client books
 * moves: not Struggle, not one an ability called or reflected; a move another
 * move called books the caller instead (Sleep Talk's calls are the user's
 * own moves). Returns the move to book, or '' for none. The body it books to
 * is `bookingIdent`'s: a copy's move belongs to its target.
 */
export function ownMove(state: InferrerState, line: LogLine): string {
  const moveName = arg(line, 2);
  if (toId(moveName) === 'struggle') return '';
  const from = fromEffect(line);
  if (!from.name || toId(from.name) === 'pursuit' || toId(from.name) === 'sleeptalk') return moveName;
  // Round 89 (#140): a move line prints `[from] <effect.fullname>`, so a move effect is `move: X` and a condition its bare name. A move
  // the Dex marks `callsMove` (Metronome, Copycat, Nature Power) names the called move on the line: the caller is the user's own move.
  // Any other move effect pulled the user's own move forward (a Pledge combination, Round): the line's move is the user's, and the
  // effect names the partner's. A bare name is a condition (Magic Coat and Snatch reflect or steal a move the user does not know), but
  // older logs write a caller bare (`[from]Nature Power`): the caller still books.
  const calls = !!dexOf(state).moves.get(from.name).callsMove;
  if (from.type === 'move') return calls ? from.name : moveName;
  return !from.type && calls ? from.name : '';
}

/** Same Pokémon by the Dex: the client's forme belongs to the team member's species. */
function sameSpecies(state: InferrerState, clientForme: string, species: string): boolean {
  const dex = dexOf(state);
  const base = (name: string) => toId(dex.species.get(name.replace(/-\*$/, '')).baseSpecies || name);
  return base(clientForme) === base(species);
}

/** Whether a swap gave this opponent Pokémon (by side and nickname) its current item at any time. */
function swapped(state: InferrerState, key: string): boolean {
  return [...state.swappedIdents.keys()].some(ident => keyOf(ident) === key);
}

/** The ability the client booked as the Pokémon's own, where the inference has none: one its team species may hold (the Dex keeps a Mega's or a Tera forme's ability off the set). */
function adoptAbility(state: InferrerState, info: RevealedPokemonInfo, client: ClientPokemon) {
  if (info.ability.value || !client.baseAbility) return;
  const dex = dexOf(state);
  const name = dex.abilities.get(client.baseAbility).name;
  // The species' own spelling: the client keeps only the id, and "As One" is the id of no gen 9 ability ("As One (Spectrier)").
  const own = speciesAbilityFor(dex, info.species.replace(/-\*$/, ''), name) ?? (state.freeAbilities ? name : '');
  if (own) info.ability = revealedField(own);
}

/**
 * The item the client saw the Pokémon hold as its own, or the one it saw it
 * lose ("(consumed)": eaten, knocked off, stolen, popped), where the
 * inference has none and no swap ever touched the Pokémon.
 */
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

/** The client's ability and item for one opponent Pokémon the line names, where the inference has none yet. */
function adoptFor(state: InferrerState, ident: string) {
  const subject = identOf(ident);
  if (!subject || subject.side !== state.opponentSide) return;
  const client = clientPokemon(state, ident);
  const info = findPokemon(state, subject.name);
  if (!client || !info || !sameSpecies(state, client.speciesForme, info.species)) return;
  adoptAbility(state, info, client);
  adoptItem(state, info, client, keyOf(ident));
}

/**
 * After the client read a line: the abilities and items it learned about the
 * line's subject and its [of] Pokémon, where the inference had none.
 */
export function syncClientFacts(state: InferrerState, line: LogLine) {
  for (const ident of [arg(line, 1), ofIdent(line)]) if (ident) adoptFor(state, ident);
}
