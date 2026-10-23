import { isSitrusBerry, sitrusKeptAt, toId } from '@fulllifegames/replay-core';
import type { ChoiceLockContext, ProtocolHeldItem } from '../choice-lock.ts';
import type { SimBattle, SimPokemon } from './types.ts';
import { findPokemonOnSide } from './protocol-choices.ts';

/**
 * The board holds the items the protocol shows (round 63, T115; round 64,
 * T121). The sim plays every block with the build's guesses, so its items
 * drift: its Trick swaps two guesses (655336), its Knock Off lands on
 * another body (938640: p2 Incineroar before its Parting Shot), it pops a
 * balloon the game never popped (751505) or misses a Pickpocket the game
 * had. At each boundary a body the protocol has shown an item line for
 * takes that item; a body without one gets its build item back when the
 * sim's own move or ability took it. A guess the sim's own trigger
 * consumed stays consumed: the game often rules it out (a balloon no hit
 * popped), and that verdict belongs to the item evidence. The exception is
 * a body the sim switched in and the game never did (round 69, T172): no
 * trigger of the game's can have touched it, so it holds its build item
 * (an Iron Valiant that ate its Booster Energy at an entry the game never had).
 *
 * Round 73 (T214): a Sitrus Berry the sim ate at its own HP comes back when the HP the block shows for the body, with no item
 * line anywhere in the protocol, is a state where the Dex's threshold certainly does not eat. At or under the threshold the
 * game refutes the berry (it would have eaten), and the consumed state stays.
 */
export function applyProtocolHeldItems(battle: SimBattle, context: ChoiceLockContext, turn: number, events: readonly string[] = []): boolean {
  const held = context.heldItems.get(turn) ?? [];
  const shownHealth = lastShownHealth(battle, events);
  let changed = false;
  for (const [sideIdx, sideId] of [[0, 'p1'], [1, 'p2']] as const) {
    const side = battle.sides[sideIdx];
    const entries = new Map<SimPokemon, ProtocolHeldItem>();
    for (const entry of held) {
      const body = entry.side === sideId ? findPokemonOnSide(side, entry.species) : null;
      if (body) entries.set(body, entry);
    }
    // An entry that names no body of the side leaves it open who the game had in play.
    const allResolved = held.filter(entry => entry.side === sideId).length === entries.size;
    for (const body of side.pokemon) {
      const eligible = context.eligibility[sideId][toId(body.set.species)] === true;
      const gameLess = allResolved && !entries.has(body) && simBroughtIn(battle, body);
      if (correctHeldBody(battle, body, entries.get(body), eligible, gameLess, shownHealth.get(body))) changed = true;
    }
  }
  return changed;
}

/**
 * One body: the protocol's item, else the build's when the sim's move took
 * it; then, on an active body whose item changed or the block touched, the
 * lock (a guessed Choice item only when its damage record allows one, as
 * the singles restamp asks). True when the board changed.
 */
function correctHeldBody(
  battle: SimBattle, body: SimPokemon, entry: ProtocolHeldItem | undefined, eligible: boolean, gameLess: boolean, health?: string,
): boolean {
  const shown = entry?.item ?? null;
  const want = shown ?? itemTheSimTook(battle, body, gameLess);
  if (want === null) return restoreWitnessedBerry(battle, body, health);
  const itemChanged = setHeldItem(battle, body, want);
  if (!body.isActive || body.fainted || !(itemChanged || entry?.touched)) return itemChanged;
  const lock = shown !== null || eligible ? entry?.firstMove ?? null : null;
  return setHeldItemLock(body, lock) || itemChanged;
}

/** The last HP text the block's lines show for each body (damage, heal, set HP, entry), by body. */
function lastShownHealth(battle: SimBattle, events: readonly string[]): Map<SimPokemon, string> {
  const health = new Map<SimPokemon, string>();
  for (const line of events) {
    const [, tag, ident, first, second] = line.split('|');
    const match = ident?.match(/^(p[12])[a-d]?: (.*)$/);
    if (!match) continue;
    const text = tag === 'switch' || tag === 'drag' ? second : tag === '-damage' || tag === '-heal' || tag === '-sethp' ? first : undefined;
    const body = text ? findPokemonOnSide(battle.sides[match[1] === 'p1' ? 0 : 1], match[2]) : null;
    if (body && text) health.set(body, text);
  }
  return health;
}

/**
 * The build's Sitrus Berry when the sim ate it, the protocol shows no item line for the body, and the HP the block shows is
 * one where the Dex's threshold certainly would not have eaten it (the game kept the berry the sim's HP spent).
 */
function witnessedBerry(battle: SimBattle, body: SimPokemon, health: string | undefined): string | null {
  const build = toId(body.set.item);
  if (!health || body.fainted || body.item !== '' || !isSitrusBerry(build)) return null;
  return sitrusKeptAt(battle.dex, health) ? build : null;
}

/** Puts the witnessed berry back; the game never ate it, so the sim's eating marks (Belch and Cud Chew read them) go. True when the board changed. */
function restoreWitnessedBerry(battle: SimBattle, body: SimPokemon, health: string | undefined): boolean {
  const build = witnessedBerry(battle, body, health);
  if (build === null || !setHeldItem(battle, body, build)) return false;
  body.ateBerry = false;
  body.lastItem = '';
  return true;
}

/** The build's item when the sim's own move or ability took it from the body, or when the game never had the body, else null. */
function itemTheSimTook(battle: SimBattle, body: SimPokemon, gameLess: boolean): string | null {
  const build = toId(body.set.item);
  return body.item !== build && (gameLess || simTookItem(battle, body)) ? build : null;
}

/** Whether the sim's own log has this body on the field (a switch-in or a drag line). */
function simBroughtIn(battle: SimBattle, body: SimPokemon): boolean {
  const ident = `${body.side.id}: ${body.name}`;
  return battle.log.some(line => {
    const parts = line.split('|');
    return (parts[1] === 'switch' || parts[1] === 'drag') && parts[2]?.replace(/^(p[1-4])[a-d]: /, '$1: ') === ident;
  });
}

/**
 * Whether the sim's own last item line on the body came from a move or an
 * ability (Knock Off, Trick, Thief, Pickpocket; Bug Bite and Pluck write
 * `[from] stealeat`) rather than from the item's own trigger.
 */
function simTookItem(battle: SimBattle, body: SimPokemon): boolean {
  const ident = `${body.side.id}: ${body.name}`;
  for (let index = battle.log.length - 1; index >= 0; index--) {
    const parts = battle.log[index].split('|');
    if (parts[1] !== '-item' && parts[1] !== '-enditem') continue;
    if (parts[2]?.replace(/^(p[1-4])[a-d]?: /, '$1: ') !== ident) continue;
    return parts.some(part => /^\[from\] ?(?:move|ability):|^\[from\] stealeat$/.test(part));
  }
  return false;
}

/** Pokemon#setItem and #takeItem without their events: the protocol already played the hand-over out. */
function setHeldItem(battle: SimBattle, body: SimPokemon, itemId: string): boolean {
  if (body.item === itemId) return false;
  if (!itemId) {
    body.item = '';
    battle.clearEffectState(body.itemState);
    return true;
  }
  const item = battle.dex.items.get(itemId);
  if (!item.exists) return false;
  body.item = item.id;
  body.itemState = battle.initEffectState({ id: item.id, target: body });
  // Gen 4 keeps a knocked-off body from taking items again; this one holds its item.
  body.itemKnockedOff = false;
  return true;
}

/**
 * The protocol's lock: a held Choice item and the first move since it
 * arrived or the body entered, else none (the sim's Choice item drops its
 * old lock on arrival). The same direct stamp as restampProtocolLocks.
 */
function setHeldItemLock(body: SimPokemon, lock: string | null): boolean {
  const want = lock && body.getItem().isChoice && body.moveSlots.some(slot => slot.id === lock) ? lock : null;
  const current = (body.volatiles['choicelock'] as { move?: string } | undefined)?.move ?? null;
  if (current === want) return false;
  if (want) body.volatiles['choicelock'] = { id: 'choicelock', move: want } as never;
  else delete body.volatiles['choicelock'];
  return true;
}
