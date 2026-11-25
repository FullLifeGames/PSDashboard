import { dexOf } from '../rules-dex.ts';
import { revealedField, unknownEvs, unknownField } from '../team-info.ts';
import { canHaveDancer, findPokemon, ruleOut, type InferrerState } from './inferrer-state.ts';
import { revealMarkerForme, teamSpecies, unknownFormeMarkerFor } from './lookup.ts';
import { abilityHolderIdent } from './ability-holder.ts';
import { ATTACKER_PUNISH_ITEMS, bookingIdent, ownMove } from './client-facts.ts';
import { arg, detailsOf, fromEffect, hasKw, identOf, kwText, ofIdent, type LogLine } from './log-line.ts';
import { bookPowerMove, readPowerMove } from './power-moves.ts';
import { toId } from '../ids.ts';
import { choiceItems } from '../dex-facts/index.ts';
import type { PokemonFieldInfo } from '../types.ts';

/** `|-item|` sources that mean the holder acquired the item mid-game, not its set item. */
// oracle: packages/replay-core/test/swap-item-sources-oracle.spec.ts
export const SWAP_ITEM_SOURCES: Record<string, Set<string>> = {
  move: new Set(['Trick', 'Switcheroo', 'Thief', 'Covet', 'Bestow']),
  // Pickup (Generation 5 on) writes the same line for an item it picks up from another Pokémon.
  // eslint-disable-next-line names/no-new-dex-name -- held by swap-item-sources-oracle.spec.ts (Pickup)
  ability: new Set(['Magician', 'Pickpocket', 'Pickup']),
};
/** `|-activate|` effects that hand an item to the `[of]` Pokémon; Symbiosis writes no `|-item|` line. */
// oracle: packages/replay-core/test/swap-item-sources-oracle.spec.ts
export const ITEM_HANDOVER_ACTIVATIONS: Record<string, Set<string>> = { ability: new Set(['Symbiosis']) };
// Swap moves emit no [of]: the resolving move pairs giver and receiver.
const SWAP_PAIR_MOVES = new Set(['trick', 'switcheroo', 'thief', 'covet']);

// Open: nothing shown, or only the team preview's flag that the Pokémon holds something.
function itemOpen(pokemon: { item: PokemonFieldInfo }): boolean {
  return !pokemon.item.value || pokemon.item.value === '(has item)';
}

const MOVE_BOUNDARIES = new Set(['-miss', '-immune', '-fail', '-end', 'turn', 'upkeep', 'cant', 'faint']);

function sideSubject(line: LogLine, side: string): string | null {
  const ident = identOf(arg(line, 1));
  return ident?.side === side ? ident.name : null;
}

// Two plain moves disprove a Choice lock, a plain Status move Assault Vest; a Z or Max move is no plain move
// (a Dynamaxed body picks any Max move whatever it holds; Max Guard still disproves Assault Vest).
function recordPlainMove(state: InferrerState, ident: string, moveName: string, powered: boolean) {
  const nickname = identOf(ident)?.name.trim();
  if (!nickname) return;
  const used = state.plainMovesSince.get(ident) ?? new Set<string>();
  if (!powered) used.add(toId(moveName));
  state.plainMovesSince.set(ident, used);
  if (used.size >= 2 && !canHaveDancer(state, ident)) {
    for (const item of choiceItems(dexOf(state))) {
      ruleOut(state, nickname, 'items', item);
    }
  }
  if (dexOf(state).moves.get(moveName).category === 'Status') {
    ruleOut(state, nickname, 'items', 'assaultvest');
  }
}

export function noteMoveOrBoundary(state: InferrerState, line: LogLine) {
  if (line.cmd === 'move') {
    const attacker = arg(line, 1);
    if (!attacker) return;
    const moveName = arg(line, 2);
    state.pendingMove = { attacker, moveName };
    const target = identOf(arg(line, 3));
    if (target && (target.side === 'p1' || target.side === 'p2')) state.lastMoveTarget.set(attacker, arg(line, 3));
    if (identOf(attacker)?.side === state.opponentSide && !hasKw(line, 'from') && moveName) {
      recordPlainMove(state, attacker, moveName, !!readPowerMove(dexOf(state), line));
    }
  } else if (MOVE_BOUNDARIES.has(line.cmd) || (line.cmd === '-activate' && arg(line, 2) === 'confusion')) {
    state.pendingMove = null;
  }
}

export function noteEntry(state: InferrerState, line: LogLine) {
  if (line.cmd !== 'switch' && line.cmd !== 'drag') return;
  state.pendingMove = null;
  const ident = arg(line, 1);
  if (!ident) return;
  const parsed = detailsOf(arg(line, 2));
  if (parsed) {
    const species = teamSpecies(dexOf(state), state.pokemonMap, parsed.species);
    state.identSpecies.set(ident, species);
    const nickname = sideSubject(line, state.opponentSide)?.trim();
    if (nickname) state.nicknameSpecies.set(nickname, species);
  }
  state.plainMovesSince.delete(ident);
}

// Damage from hazards, status, weather or recoil disproves Magic Guard; rocks chip disproves Heavy-Duty Boots.
const HAZARDS = new Set(['Stealth Rock', 'Spikes']);
const INDIRECT = new Set(['psn', 'tox', 'brn', 'Sandstorm', 'Hail']);

export function ruleOutFromDamage(state: InferrerState, line: LogLine) {
  if (line.cmd !== '-damage') return;
  const nickname = sideSubject(line, state.opponentSide)?.trim();
  if (!nickname) return;
  const from = fromEffect(line);
  if (!from.type && HAZARDS.has(from.name)) {
    ruleOut(state, nickname, 'abilities', 'magicguard');
    ruleOut(state, nickname, 'items', 'heavydutyboots');
  } else if ((!from.type && INDIRECT.has(from.name)) || (from.type === 'item' && from.name === 'Life Orb')) {
    ruleOut(state, nickname, 'abilities', 'magicguard');
  }
}

function revealedPokemon(parsed: { species: string; level: number; gender: string }, item: PokemonFieldInfo) {
  return {
    species: parsed.species,
    moves: [],
    ability: unknownField(),
    item,
    teraType: unknownField(),
    evs: unknownEvs(),
    level: parsed.level,
    gender: parsed.gender,
  };
}

export function addFromPreview(state: InferrerState, line: LogLine) {
  if (line.cmd !== 'poke' || arg(line, 1) !== state.opponentSide) return;
  const hasItem = arg(line, 3) === 'item';
  const parsed = detailsOf(arg(line, 2));
  if (parsed && !state.pokemonMap.has(parsed.species)) {
    state.pokemonMap.set(parsed.species, revealedPokemon(parsed, hasItem ? revealedField('(has item)') : unknownField()));
  }
}

/** A forme the team preview hid behind "-*" (Urshifu-*) is revealed here: the marker entry becomes that forme. */
export function addFromSwitch(state: InferrerState, line: LogLine) {
  if ((line.cmd !== 'switch' && line.cmd !== 'drag') || sideSubject(line, state.opponentSide) === null) return;
  const details = detailsOf(arg(line, 2));
  if (!details) return;
  const parsed = { ...details, species: teamSpecies(dexOf(state), state.pokemonMap, details.species) };
  if (state.pokemonMap.has(parsed.species)) return;
  const marker = unknownFormeMarkerFor(dexOf(state), state.pokemonMap, parsed.species);
  if (marker) revealMarkerForme(state.pokemonMap, marker, parsed);
  else state.pokemonMap.set(parsed.species, revealedPokemon(parsed, unknownField()));
}

// A `|cant|` line names the move only for Taunt, Imprison, Disable and Heal Block: the blocked move never ran.
// A blocker's [of] line (Dazzling, Damp) arrives as `-block` after the attacker's `|move|` line, so it is no `cant`.
function blockedMoveLine(line: LogLine): LogLine | null {
  const moveName = arg(line, 3);
  return moveName ? { ...line, cmd: 'move', args: ['move', arg(line, 1), moveName], kwArgs: {} } : null;
}

export function recordMove(state: InferrerState, line: LogLine) {
  const moveLine = line.cmd === 'cant' ? blockedMoveLine(line) : line;
  if (!moveLine || moveLine.cmd !== 'move') return;
  const booked = identOf(bookingIdent(state, arg(moveLine, 1)));
  if (booked?.side !== state.opponentSide) return;
  const nickname = booked.name;
  const moveName = ownMove(state, moveLine);
  if (!moveName) return;

  const pokemon = findPokemon(state, nickname);
  if (!pokemon) return;
  // A Z-move or Max move books its base move, or an open slot for it, never its own name.
  const power = moveName === arg(moveLine, 2) ? readPowerMove(dexOf(state), moveLine) : null;
  if (power) bookPowerMove(pokemon, power);
  else if (!pokemon.moves.some(move => move.name === moveName)) pokemon.moves.push({ name: moveName, source: 'revealed' });
}

function swapGiverIdent(state: InferrerState, line: LogLine, ident: string): string | null {
  const { pendingMove } = state;
  const of = ofIdent(line);
  const giver = of && /^p[12]/.test(of) ? of.trim() : null;
  const pairedMove = pendingMove && SWAP_PAIR_MOVES.has(toId(pendingMove.moveName)) ? pendingMove : null;
  return giver ?? (pairedMove
    ? (pairedMove.attacker === ident
      ? state.lastMoveTarget.get(pairedMove.attacker) ?? null
      : pairedMove.attacker)
    : null);
}

// The same line reveals the giver's set item: whatever arrived came off the other party of the swap.
function creditSwapGiver(state: InferrerState, line: LogLine, ident: string, itemName: string) {
  const giver = swapGiverIdent(state, line, ident);
  const priorSwap = giver !== null && state.swappedIdents.has(giver) && state.swappedIdents.get(giver) !== state.pendingMove;
  if (giver && giver.startsWith(state.opponentSide) && !priorSwap) {
    const giverNickname = identOf(giver)?.name;
    const pokemon = giverNickname ? findPokemon(state, giverNickname) : null;
    if (pokemon && itemOpen(pokemon)) {
      pokemon.item = revealedField(itemName);
    }
  }
}

function recordHandover(state: InferrerState, line: LogLine) {
  const [type, name] = arg(line, 2).split(': ');
  if (!ITEM_HANDOVER_ACTIVATIONS[type]?.has(name)) return;
  const receiver = ofIdent(line);
  if (receiver && identOf(receiver)?.side === state.opponentSide) state.swappedIdents.set(receiver.trim(), state.pendingMove);
  const giver = identOf(arg(line, 1));
  const itemName = kwText(line, 'item');
  if (!giver || giver.side !== state.opponentSide || !itemName || state.swappedIdents.has(arg(line, 1))) return;
  const pokemon = findPokemon(state, giver.name);
  if (pokemon && itemOpen(pokemon)) pokemon.item = revealedField(itemName);
}

/** A swap-acquired item is not the holder's set item: crediting it would make up a Choice lock that hides moves. */
export function recordItem(state: InferrerState, line: LogLine) {
  if (line.cmd === '-activate') return recordHandover(state, line);
  if (line.cmd !== '-item') return;
  const ident = arg(line, 1);
  const nickname = sideSubject(line, state.opponentSide);
  const itemName = arg(line, 2);
  const from = fromEffect(line);
  const swapAcquired = !!SWAP_ITEM_SOURCES[from.type]?.has(from.name);
  if (nickname) {
    if (swapAcquired) {
      state.swappedIdents.set(ident, state.pendingMove);
    } else if (!state.swappedIdents.has(ident)) {
      const pokemon = findPokemon(state, nickname);
      if (pokemon) {
        pokemon.item = revealedField(itemName);
      }
    }
  }
  if (swapAcquired && itemName) {
    creditSwapGiver(state, line, ident, itemName);
  }
}

/** Item damage that hurts the attacker reveals its holder: the [of] Pokémon, or the target where [of] is dropped. */
export function recordItemDamage(state: InferrerState, line: LogLine) {
  const from = fromEffect(line);
  if (line.cmd !== '-damage' || from.type !== 'item' || !ATTACKER_PUNISH_ITEMS.has(toId(from.name))) return;
  const of = ofIdent(line);
  const owner = identOf((of && /^p[12]/.test(of) ? of.trim() : state.lastMoveTarget.get(arg(line, 1))) ?? undefined);
  if (owner && owner.side === state.opponentSide) {
    const pokemon = findPokemon(state, owner.name.trim());
    if (pokemon && itemOpen(pokemon)) {
      pokemon.item = revealedField(from.name);
    }
  }
}

export function recordTera(state: InferrerState, line: LogLine) {
  const nickname = line.cmd === '-terastallize' ? sideSubject(line, state.opponentSide) : null;
  if (nickname === null) return;
  const teraType = arg(line, 2);
  const pokemon = findPokemon(state, nickname);
  if (pokemon) {
    pokemon.teraType = revealedField(teraType);
  }
}

export function recordAbilityAttribution(state: InferrerState, line: LogLine) {
  const from = fromEffect(line);
  if (from.type !== 'ability' || !from.name) return;
  const abilityName = from.name;
  const ofText = ofIdent(line);
  const of = ofText && /^p[12]/.test(ofText) ? ofText.trim() : null;
  const subjectIdent = identOf(arg(line, 1));
  const subject = /^-[a-z]+$/.test(line.cmd) && subjectIdent && /^p[12]$/.test(subjectIdent.side) ? arg(line, 1).trim() : null;
  const holder = identOf(abilityHolderIdent(state, subject, of, abilityName) ?? undefined);
  if (!holder || holder.side !== state.opponentSide) return;
  const pokemon = findPokemon(state, holder.name.trim());
  if (pokemon && !pokemon.ability.value) {
    pokemon.ability = revealedField(abilityName);
  }
}
