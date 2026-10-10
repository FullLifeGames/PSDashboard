import { Dex } from '@pkmn/sim';
import { revealedField, unknownEvs, unknownField } from '../team-info.ts';
import { canHaveDancer, findPokemon, ruleOut, type InferrerState } from './inferrer-state.ts';
import { revealMarkerForme, teamSpecies, unknownFormeMarkerFor } from './lookup.ts';
import { abilityHolderIdent, mayHold } from './ability-holder.ts';
import { ATTACKER_PUNISH_ITEMS, ownMove } from './client-facts.ts';
import { arg, detailsOf, fromEffect, hasKw, identOf, ofIdent, type LogLine } from './log-line.ts';
import { toId } from '../ids.ts';
import type { PokemonFieldInfo } from '../types.ts';

/** `|-item|` sources that mean the holder ACQUIRED the item mid-game — not its set item. */
const SWAP_ITEM_SOURCES: Record<string, Set<string>> = {
  move: new Set(['Trick', 'Switcheroo', 'Thief', 'Covet', 'Bestow']),
  ability: new Set(['Magician', 'Pickpocket', 'Symbiosis']),
};
/** Swap moves whose resolving-move context pairs giver and receiver (no [of] emitted). */
const SWAP_PAIR_MOVES = new Set(['trick', 'switcheroo', 'thief', 'covet']);
/** A landed Ground move from a possible immunity-breaker proves nothing about Levitate. */
const MOLD_BREAKER_ABILITIES = new Set(['moldbreaker', 'teravolt', 'turboblaze']);

/**
 * The item is still open: nothing shown, or only the team preview's flag
 * that the Pokémon holds something. An item the log shows replaces the flag
 * (round 63: 655336's Trick giver kept "(has item)").
 */
function itemOpen(pokemon: { item: PokemonFieldInfo }): boolean {
  return !pokemon.item.value || pokemon.item.value === '(has item)';
}

/** Lines after which no move resolves any more (the move's damage lines are over). */
const MOVE_BOUNDARIES = new Set(['-miss', '-immune', '-fail', '-end', 'turn', 'upkeep', 'cant', 'faint']);

/** The subject of a line about one Pokémon of the side ("|-damage|p2a: Nick|..."): its nickname, else null. */
function sideSubject(line: LogLine, side: string): string | null {
  const ident = identOf(arg(line, 1));
  return ident?.side === side ? ident.name : null;
}

/** Two plain moves disprove a Choice lock; a plain Status move disproves Assault Vest. */
function recordPlainMove(state: InferrerState, ident: string, moveName: string) {
  const nickname = identOf(ident)?.name.trim();
  if (!nickname) return;
  const used = state.plainMovesSince.get(ident) ?? new Set<string>();
  used.add(toId(moveName));
  state.plainMovesSince.set(ident, used);
  if (used.size >= 2 && !canHaveDancer(state, ident)) {
    for (const item of ['choiceband', 'choicespecs', 'choicescarf']) {
      ruleOut(state, nickname, 'items', item);
    }
  }
  if (Dex.moves.get(moveName).category === 'Status') {
    ruleOut(state, nickname, 'items', 'assaultvest');
  }
}

/** The resolving move (for damage attribution) and its target; boundaries clear it. */
export function noteMoveOrBoundary(state: InferrerState, line: LogLine) {
  if (line.cmd === 'move') {
    const attacker = arg(line, 1);
    if (!attacker) return;
    const moveName = arg(line, 2);
    state.pendingMove = { attacker, moveName };
    const target = identOf(arg(line, 3));
    if (target && (target.side === 'p1' || target.side === 'p2')) state.lastMoveTarget.set(attacker, arg(line, 3));
    if (identOf(attacker)?.side === state.opponentSide && !hasKw(line, 'from') && moveName) {
      recordPlainMove(state, attacker, moveName);
    }
  } else if (MOVE_BOUNDARIES.has(line.cmd) || (line.cmd === '-activate' && arg(line, 2) === 'confusion')) {
    state.pendingMove = null;
  }
}

export function noteGravity(state: InferrerState, line: LogLine) {
  if (line.cmd === '-fieldstart' && arg(line, 1).includes('Gravity')) state.gravityActive = true;
  if (line.cmd === '-fieldend' && arg(line, 1).includes('Gravity')) state.gravityActive = false;
}

/** Entries reset the plain-move count and map idents (both sides) and opponent nicknames to species. */
export function noteEntry(state: InferrerState, line: LogLine) {
  if (line.cmd !== 'switch' && line.cmd !== 'drag') return;
  state.pendingMove = null;
  const ident = arg(line, 1);
  if (!ident) return;
  const parsed = detailsOf(arg(line, 2));
  if (parsed) {
    const species = teamSpecies(state.pokemonMap, parsed.species);
    state.identSpecies.set(ident, species);
    const nickname = sideSubject(line, state.opponentSide)?.trim();
    if (nickname) state.nicknameSpecies.set(nickname, species);
  }
  state.plainMovesSince.delete(ident);
}

/** A landed Ground move rules out Levitate — unless the attacker may break immunities. */
function ruleOutLevitate(state: InferrerState, nickname: string) {
  const { pendingMove } = state;
  if (!pendingMove) return;
  const move = Dex.moves.get(pendingMove.moveName);
  const ignore = move.ignoreImmunity as boolean | Record<string, boolean> | undefined;
  const ignoresGround = ignore === true || (typeof ignore === 'object' && !!ignore?.Ground);
  const attackerSpecies = state.identSpecies.get(pendingMove.attacker);
  const possiblyMoldBreaker = attackerSpecies
    ? Object.values(Dex.species.get(attackerSpecies).abilities ?? {})
      .some(ability => MOLD_BREAKER_ABILITIES.has(toId(String(ability))))
    : false;
  if (move.type === 'Ground' && !ignoresGround && !possiblyMoldBreaker) {
    ruleOut(state, nickname, 'abilities', 'levitate');
  }
}

/**
 * Disproving evidence: a Pokémon that TAKES hazard/status/weather/recoil
 * damage cannot be Magic Guard; rocks chip rules out Heavy-Duty Boots; a
 * landed Ground move rules out Levitate (T25 — Clefable was simmed with
 * Magic Guard while visibly taking Stealth Rock damage).
 */
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
  } else if (!hasKw(line, 'from') && state.pendingMove && !state.gravityActive) {
    ruleOutLevitate(state, nickname);
  }
}

/** A newly seen team member: the details line's identity, everything else unknown. */
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

/** Team preview: |poke|p2|Species, L50, M|item */
export function addFromPreview(state: InferrerState, line: LogLine) {
  if (line.cmd !== 'poke' || arg(line, 1) !== state.opponentSide) return;
  const hasItem = arg(line, 3) === 'item';
  const parsed = detailsOf(arg(line, 2));
  if (parsed && !state.pokemonMap.has(parsed.species)) {
    state.pokemonMap.set(parsed.species, revealedPokemon(parsed, hasItem ? revealedField('(has item)') : unknownField()));
  }
}

/**
 * Switch: |switch|p2a: Nickname|Species, L50, M|100/100. A forme the team
 * preview hid behind "-*" (Urshifu-*, Zamazenta-*) is revealed here: the
 * marker entry becomes that forme instead of a seventh body (round 21
 * sighted 110359 p2 with seven sets).
 */
export function addFromSwitch(state: InferrerState, line: LogLine) {
  if ((line.cmd !== 'switch' && line.cmd !== 'drag') || sideSubject(line, state.opponentSide) === null) return;
  const details = detailsOf(arg(line, 2));
  if (!details) return;
  const parsed = { ...details, species: teamSpecies(state.pokemonMap, details.species) };
  if (state.pokemonMap.has(parsed.species)) return;
  const marker = unknownFormeMarkerFor(state.pokemonMap, parsed.species);
  if (marker) revealMarkerForme(state.pokemonMap, marker, parsed);
  else state.pokemonMap.set(parsed.species, revealedPokemon(parsed, unknownField()));
}

/** Move: |move|p2a: Nickname|Move Name|target; the client's rule decides which move the line books (T108 step 2). */
export function recordMove(state: InferrerState, line: LogLine) {
  const nickname = line.cmd === 'move' ? sideSubject(line, state.opponentSide) : null;
  if (nickname === null) return;
  const moveName = ownMove(state, line);
  if (!moveName) return;

  const pokemon = findPokemon(state, nickname);
  if (pokemon && !pokemon.moves.some(move => move.name === moveName)) {
    pokemon.moves.push({ name: moveName, source: 'revealed' });
  }
}

/** Ability: |-ability|p2a: Nickname|Ability Name */
export function recordAbility(state: InferrerState, line: LogLine) {
  const nickname = line.cmd === '-ability' ? sideSubject(line, state.opponentSide) : null;
  if (nickname === null) return;
  const abilityName = arg(line, 2);
  // A traced, copied or swapped ability is not the species' own (round 60, T104).
  if (!mayHold(state, arg(line, 1), abilityName)) return;
  const pokemon = findPokemon(state, nickname);
  if (pokemon && !pokemon.ability.value) {
    pokemon.ability = revealedField(abilityName);
  }
}

/** Giver: the [of] ident when present, else the OTHER party of the
 *  resolving swap move (Trick swaps emit no [of]). */
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

/** The same line DOES reveal the GIVER's set item: whatever arrived came
 *  off the other party of the resolving swap. */
function creditSwapGiver(state: InferrerState, line: LogLine, ident: string, itemName: string) {
  const giver = swapGiverIdent(state, line, ident);
  // A giver that swap-acquired in an EARLIER action only gives away
  // acquired goods; its counterpart line in THIS action still counts.
  const priorSwap = giver !== null && state.swappedIdents.has(giver) && state.swappedIdents.get(giver) !== state.pendingMove;
  if (giver && giver.startsWith(state.opponentSide) && !priorSwap) {
    const giverNickname = identOf(giver)?.name;
    const pokemon = giverNickname ? findPokemon(state, giverNickname) : null;
    if (pokemon && itemOpen(pokemon)) {
      pokemon.item = revealedField(itemName);
    }
  }
}

/**
 * Item: |-item|pXa: Nickname|Item Name[|tags]. A swap-ACQUIRED item
 * ([from] Trick/Switcheroo/Thief/Covet/Bestow or Magician/Pickpocket/
 * Symbiosis) is NOT the holder's set item — crediting Vileplume with the
 * scarf a Trick planted on it manufactured a choice lock that hid its
 * real moves (GPL T11).
 */
export function recordItem(state: InferrerState, line: LogLine) {
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

/** End item (consumed): |-enditem|p2a: Nickname|Item Name. After a swap
 *  the mon consumes/loses the ACQUIRED item — never its set item. */
export function recordConsumedItem(state: InferrerState, line: LogLine) {
  const nickname = line.cmd === '-enditem' ? sideSubject(line, state.opponentSide) : null;
  if (nickname === null) return;
  const ident = arg(line, 1);
  const itemName = arg(line, 2);
  const pokemon = findPokemon(state, nickname);
  if (pokemon && itemOpen(pokemon) && !state.swappedIdents.has(ident)) {
    pokemon.item = revealedField(`${itemName} (consumed)`);
  }
}

/** Heal messages reveal held items: |-heal|p2a: Nick|50/100|[from] item: Leftovers (G19) */
export function recordHealItem(state: InferrerState, line: LogLine) {
  const from = fromEffect(line);
  const nickname = line.cmd === '-heal' && from.type === 'item' ? sideSubject(line, state.opponentSide) : null;
  if (nickname === null) return;
  const itemName = from.name;
  const pokemon = findPokemon(state, nickname);
  if (pokemon && itemName && itemOpen(pokemon)) {
    pokemon.item = revealedField(itemName);
  }
}

/** The holder of an item-damage line: the [of] Pokémon, else (attacker-punishing
 *  items in logs that drop [of]) the target of the damaged Pokémon's own move. */
function itemDamageOwner(state: InferrerState, line: LogLine, damagedIdent: string, itemName: string | undefined): string | null {
  const of = ofIdent(line);
  let owner: string | null = damagedIdent;
  if (of && /^p[12]/.test(of)) {
    owner = of.trim();
  } else if (itemName && ATTACKER_PUNISH_ITEMS.has(toId(itemName))) {
    owner = state.lastMoveTarget.get(damagedIdent) ?? null;
  }
  return owner;
}

/**
 * Item damage reveals the holder: Life Orb/Black Sludge recoil hurts the
 * holder itself, but Rocky Helmet hurts the ATTACKER — its holder is the
 * [of] Pokémon, or in video-reconstructed logs that drop [of], the target
 * of the damaged Pokémon's own move.
 */
export function recordItemDamage(state: InferrerState, line: LogLine) {
  const from = fromEffect(line);
  if (line.cmd !== '-damage' || from.type !== 'item') return;
  const itemName = from.name || undefined;
  const owner = identOf(itemDamageOwner(state, line, arg(line, 1), itemName) ?? undefined);
  if (itemName && owner && owner.side === state.opponentSide) {
    const pokemon = findPokemon(state, owner.name.trim());
    if (pokemon && itemOpen(pokemon)) {
      pokemon.item = revealedField(itemName);
    }
  }
}

/** Mega evolution reveals the stone: |-mega|p2a: Nick|Lopunny|Lopunnite (G19) */
export function recordMega(state: InferrerState, line: LogLine) {
  const nickname = line.cmd === '-mega' ? sideSubject(line, state.opponentSide) : null;
  if (nickname === null) return;
  const stone = arg(line, 3).trim();
  const pokemon = findPokemon(state, nickname);
  if (pokemon && stone && itemOpen(pokemon)) {
    pokemon.item = revealedField(stone);
  }
}

/** Terastallize: |-terastallize|p2a: Nickname|Type */
export function recordTera(state: InferrerState, line: LogLine) {
  const nickname = line.cmd === '-terastallize' ? sideSubject(line, state.opponentSide) : null;
  if (nickname === null) return;
  const teraType = arg(line, 2);
  const pokemon = findPokemon(state, nickname);
  if (pokemon) {
    pokemon.teraType = revealedField(teraType);
  }
}

/**
 * Effect attributions reveal abilities: `[from] ability: Poison Heal` on
 * heal/damage/status lines (N1). The holder is the line's [of] or its
 * subject as the dex allows (ability-holder.ts, round 60).
 */
export function recordAbilityAttribution(state: InferrerState, line: LogLine) {
  const from = fromEffect(line);
  if (from.type !== 'ability' || !from.name) return;
  const abilityName = from.name;
  const ofText = ofIdent(line);
  const of = ofText && /^p[12]/.test(ofText) ? ofText.trim() : null;
  // The subject of a minor line ("|-heal|p2a: Nick|..."); a move line's user is no subject here.
  const subjectIdent = identOf(arg(line, 1));
  const subject = /^-[a-z]+$/.test(line.cmd) && subjectIdent && /^p[12]$/.test(subjectIdent.side) ? arg(line, 1).trim() : null;
  const holder = identOf(abilityHolderIdent(state, subject, of, abilityName) ?? undefined);
  if (!holder || holder.side !== state.opponentSide) return;
  const pokemon = findPokemon(state, holder.name.trim());
  if (pokemon && !pokemon.ability.value) {
    pokemon.ability = revealedField(abilityName);
  }
}
