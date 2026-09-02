import { Dex } from '@pkmn/sim';
import { revealedField, unknownEvs, unknownField } from '../team-info';
import { canHaveDancer, findPokemon, ruleOut, type InferrerState } from './inferrer-state';
import { parseDetails, toId } from './lookup';

/** Items whose `[from] item:` damage hits the attacker instead of the holder. */
const ATTACKER_PUNISH_ITEMS = new Set(['rockyhelmet', 'jabocaberry', 'rowapberry']);
/** `|-item|` sources that mean the holder ACQUIRED the item mid-game — not its set item. */
const SWAP_ITEM_SOURCES =
  /\[from\] (?:move: (?:Trick|Switcheroo|Thief|Covet|Bestow)|ability: (?:Magician|Pickpocket|Symbiosis))/;
/** Swap moves whose resolving-move context pairs giver and receiver (no [of] emitted). */
const SWAP_PAIR_MOVES = new Set(['trick', 'switcheroo', 'thief', 'covet']);
/** A landed Ground move from a possible immunity-breaker proves nothing about Levitate. */
const MOLD_BREAKER_ABILITIES = new Set(['moldbreaker', 'teravolt', 'turboblaze']);

/** Two plain moves disprove a Choice lock; a plain Status move disproves Assault Vest. */
function recordPlainMove(state: InferrerState, ident: string, moveName: string) {
  const nickname = ident.split(': ')[1]?.trim();
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
export function noteMoveOrBoundary(state: InferrerState, line: string) {
  if (line.startsWith('|move|')) {
    const parts = line.split('|');
    if (parts[2]) {
      state.pendingMove = { attacker: parts[2], moveName: parts[3] ?? '' };
      if (parts[4] && /^p[12][a-d]?:/.test(parts[4])) {
        state.lastMoveTarget.set(parts[2], parts[4]);
      }
      if (parts[2].startsWith(state.opponentSide) && !line.includes('[from]') && parts[3]) {
        recordPlainMove(state, parts[2], parts[3]);
      }
    }
  } else if (
    /^\|(?:-miss|-immune|-fail|-end|turn|upkeep|cant|faint)\|/.test(line) ||
    (line.startsWith('|-activate|') && line.includes('confusion'))
  ) {
    state.pendingMove = null;
  }
}

export function noteGravity(state: InferrerState, line: string) {
  if (line.startsWith('|-fieldstart|') && line.includes('Gravity')) state.gravityActive = true;
  if (line.startsWith('|-fieldend|') && line.includes('Gravity')) state.gravityActive = false;
}

/** Entries reset the plain-move count and map idents (both sides) and opponent nicknames to species. */
export function noteEntry(state: InferrerState, line: string) {
  if (!(line.startsWith('|switch|') || line.startsWith('|drag|'))) return;
  state.pendingMove = null;
  const parts = line.split('|');
  const parsed = parseDetails(parts[3]);
  if (parts[2]) {
    if (parsed) {
      state.identSpecies.set(parts[2], parsed.species);
      if (parts[2].startsWith(state.opponentSide)) {
        const nickname = parts[2].split(': ')[1]?.trim();
        if (nickname) state.nicknameSpecies.set(nickname, parsed.species);
      }
    }
    state.plainMovesSince.delete(parts[2]);
  }
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
export function ruleOutFromDamage(state: InferrerState, line: string) {
  if (!line.startsWith(`|-damage|${state.opponentSide}`)) return;
  const nickname = line.split('|')[2]?.split(': ')[1]?.trim();
  if (!nickname) return;
  if (/\[from\] (Stealth Rock|Spikes)\b/.test(line)) {
    ruleOut(state, nickname, 'abilities', 'magicguard');
    ruleOut(state, nickname, 'items', 'heavydutyboots');
  } else if (/\[from\] (psn|tox|brn|Sandstorm|Hail)\b/.test(line) || line.includes('[from] item: Life Orb')) {
    ruleOut(state, nickname, 'abilities', 'magicguard');
  } else if (!line.includes('[from]') && state.pendingMove && !state.gravityActive) {
    ruleOutLevitate(state, nickname);
  }
}

/** Team preview: |poke|p2|Species, L50, M|item */
export function addFromPreview(state: InferrerState, line: string) {
  if (!line.startsWith(`|poke|${state.opponentSide}|`)) return;
  const parts = line.split('|');
  const details = parts[3];
  const hasItem = parts[4] === 'item';
  const parsed = parseDetails(details);
  if (parsed && !state.pokemonMap.has(parsed.species)) {
    state.pokemonMap.set(parsed.species, {
      species: parsed.species,
      moves: [],
      ability: unknownField(),
      item: hasItem ? revealedField('(has item)') : unknownField(),
      teraType: unknownField(),
      evs: unknownEvs(),
      level: parsed.level,
      gender: parsed.gender,
    });
  }
}

/** Switch: |switch|p2a: Nickname|Species, L50, M|100/100 */
export function addFromSwitch(state: InferrerState, line: string) {
  const side = state.opponentSide;
  if (!(line.startsWith(`|switch|${side}`) || line.startsWith(`|drag|${side}`))) return;
  const parts = line.split('|');
  const details = parts[3];
  const parsed = parseDetails(details);
  if (parsed && !state.pokemonMap.has(parsed.species)) {
    state.pokemonMap.set(parsed.species, {
      species: parsed.species,
      moves: [],
      ability: unknownField(),
      item: unknownField(),
      teraType: unknownField(),
      evs: unknownEvs(),
      level: parsed.level,
      gender: parsed.gender,
    });
  }
}

/** Move: |move|p2a: Nickname|Move Name|target */
export function recordMove(state: InferrerState, line: string) {
  if (!line.startsWith(`|move|${state.opponentSide}`)) return;
  const parts = line.split('|');
  const identParts = parts[2].split(': ');
  const nickname = identParts[1];
  const moveName = parts[3];

  // Find which pokemon this is by looking at current active
  const pokemon = findPokemon(state, nickname);
  if (pokemon && !pokemon.moves.some(move => move.name === moveName)) {
    pokemon.moves.push({ name: moveName, source: 'revealed' });
  }
}

/** Ability: |-ability|p2a: Nickname|Ability Name */
export function recordAbility(state: InferrerState, line: string) {
  if (!line.startsWith(`|-ability|${state.opponentSide}`)) return;
  const parts = line.split('|');
  const identParts = parts[2].split(': ');
  const nickname = identParts[1];
  const abilityName = parts[3];
  const pokemon = findPokemon(state, nickname);
  if (pokemon && !pokemon.ability.value) {
    pokemon.ability = revealedField(abilityName);
  }
}

/** Giver: the [of] ident when present, else the OTHER party of the
 *  resolving swap move (Trick swaps emit no [of]). */
function swapGiverIdent(state: InferrerState, line: string, ident: string): string | null {
  const { pendingMove } = state;
  const ofIdent = line.match(/\[of\] (p[12][a-d]?: [^|\n]+)/)?.[1]?.trim() ?? null;
  const pairedMove = pendingMove && SWAP_PAIR_MOVES.has(toId(pendingMove.moveName)) ? pendingMove : null;
  return ofIdent ?? (pairedMove
    ? (pairedMove.attacker === ident
      ? state.lastMoveTarget.get(pairedMove.attacker) ?? null
      : pairedMove.attacker)
    : null);
}

/** The same line DOES reveal the GIVER's set item: whatever arrived came
 *  off the other party of the resolving swap. */
function creditSwapGiver(state: InferrerState, line: string, ident: string, itemName: string) {
  const giver = swapGiverIdent(state, line, ident);
  // A giver that swap-acquired in an EARLIER action only gives away
  // acquired goods; its counterpart line in THIS action still counts.
  const priorSwap = giver !== null && state.swappedIdents.has(giver) && state.swappedIdents.get(giver) !== state.pendingMove;
  if (giver && giver.startsWith(state.opponentSide) && !priorSwap) {
    const giverNickname = giver.split(': ')[1];
    const pokemon = giverNickname ? findPokemon(state, giverNickname) : null;
    if (pokemon && !pokemon.item.value) {
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
export function recordItem(state: InferrerState, line: string) {
  if (!line.startsWith('|-item|')) return;
  const parts = line.split('|');
  const ident = parts[2] ?? '';
  const nickname = ident.split(': ')[1];
  const itemName = parts[3];
  const swapAcquired = SWAP_ITEM_SOURCES.test(line);
  if (ident.startsWith(state.opponentSide) && nickname) {
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
export function recordConsumedItem(state: InferrerState, line: string) {
  if (!line.startsWith(`|-enditem|${state.opponentSide}`)) return;
  const parts = line.split('|');
  const ident = parts[2] ?? '';
  const identParts = parts[2].split(': ');
  const nickname = identParts[1];
  const itemName = parts[3];
  const pokemon = findPokemon(state, nickname);
  if (pokemon && !pokemon.item.value && !state.swappedIdents.has(ident)) {
    pokemon.item = revealedField(`${itemName} (consumed)`);
  }
}

/** Heal messages reveal held items: |-heal|p2a: Nick|50/100|[from] item: Leftovers (G19) */
export function recordHealItem(state: InferrerState, line: string) {
  if (!(line.startsWith(`|-heal|${state.opponentSide}`) && line.includes('[from] item:'))) return;
  const parts = line.split('|');
  const nickname = parts[2].split(': ')[1];
  const itemName = line.match(/\[from\] item:\s*([^|\n]+)/)?.[1]?.trim();
  const pokemon = findPokemon(state, nickname);
  if (pokemon && itemName && (!pokemon.item.value || pokemon.item.value === '(has item)')) {
    pokemon.item = revealedField(itemName);
  }
}

/** The holder of an item-damage line: the [of] Pokémon, else (attacker-punishing
 *  items in logs that drop [of]) the target of the damaged Pokémon's own move. */
function itemDamageOwner(state: InferrerState, line: string, damagedIdent: string, itemName: string | undefined): string | null {
  const ofIdent = line.match(/\[of\]\s*(p[12][a-d]?):\s*([^|\n]+)/);
  let owner: string | null = damagedIdent;
  if (ofIdent) {
    owner = `${ofIdent[1]}: ${ofIdent[2].trim()}`;
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
export function recordItemDamage(state: InferrerState, line: string) {
  if (!(line.startsWith('|-damage|') && line.includes('[from] item:'))) return;
  const damagedIdent = line.split('|')[2] ?? '';
  const itemName = line.match(/\[from\] item:\s*([^|\n[]+)/)?.[1]?.trim();
  const owner = itemDamageOwner(state, line, damagedIdent, itemName);
  const ownerMatch = owner?.match(/^(p[12])[a-d]?:\s*(.+)$/);
  if (itemName && ownerMatch && ownerMatch[1] === state.opponentSide) {
    const pokemon = findPokemon(state, ownerMatch[2].trim());
    if (pokemon && (!pokemon.item.value || pokemon.item.value === '(has item)')) {
      pokemon.item = revealedField(itemName);
    }
  }
}

/** Mega evolution reveals the stone: |-mega|p2a: Nick|Lopunny|Lopunnite (G19) */
export function recordMega(state: InferrerState, line: string) {
  if (!line.startsWith(`|-mega|${state.opponentSide}`)) return;
  const parts = line.split('|');
  const nickname = parts[2].split(': ')[1];
  const stone = parts[4]?.trim();
  const pokemon = findPokemon(state, nickname);
  if (pokemon && stone && (!pokemon.item.value || pokemon.item.value === '(has item)')) {
    pokemon.item = revealedField(stone);
  }
}

/** Terastallize: |-terastallize|p2a: Nickname|Type */
export function recordTera(state: InferrerState, line: string) {
  if (!line.startsWith(`|-terastallize|${state.opponentSide}`)) return;
  const parts = line.split('|');
  const identParts = parts[2].split(': ');
  const nickname = identParts[1];
  const teraType = parts[3];
  const pokemon = findPokemon(state, nickname);
  if (pokemon) {
    pokemon.teraType = revealedField(teraType);
  }
}

/**
 * Effect attributions reveal abilities: `[from] ability: Poison Heal` on
 * heal/damage/status lines (N1). With `[of] pXa: Nick` the ability belongs
 * to that Pokémon (e.g. Rough Skin recoil), otherwise to the affected one.
 */
export function recordAbilityAttribution(state: InferrerState, line: string) {
  const abilityAttribution = line.match(/\[from\] ability:\s*([^|\n[]+)/);
  if (!abilityAttribution) return;
  const abilityName = abilityAttribution[1].trim();
  const ofIdent = line.match(/\[of\]\s*(p[12])[a-d]?:\s*([^|\n]+)/);
  let ownerNickname: string | null = null;
  if (ofIdent) {
    if (ofIdent[1] === state.opponentSide) ownerNickname = ofIdent[2].trim();
  } else {
    const subject = line.match(/^\|-[a-z]+\|(p[12])[a-d]?:\s*([^|]+)\|/);
    if (subject && subject[1] === state.opponentSide) ownerNickname = subject[2].trim();
  }
  if (ownerNickname) {
    const pokemon = findPokemon(state, ownerNickname);
    if (pokemon && !pokemon.ability.value) {
      pokemon.ability = revealedField(abilityName);
    }
  }
}
