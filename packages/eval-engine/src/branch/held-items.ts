import { toId } from '@fulllifegames/replay-core';
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
 * popped), and that verdict belongs to the item evidence.
 */
export function applyProtocolHeldItems(battle: SimBattle, context: ChoiceLockContext, turn: number): boolean {
  const held = context.heldItems.get(turn) ?? [];
  let changed = false;
  for (const [sideIdx, sideId] of [[0, 'p1'], [1, 'p2']] as const) {
    const side = battle.sides[sideIdx];
    const entries = new Map<SimPokemon, ProtocolHeldItem>();
    for (const entry of held) {
      const body = entry.side === sideId ? findPokemonOnSide(side, entry.species) : null;
      if (body) entries.set(body, entry);
    }
    for (const body of side.pokemon) {
      const eligible = context.eligibility[sideId][toId(body.set.species)] === true;
      if (correctHeldBody(battle, body, entries.get(body), eligible)) changed = true;
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
function correctHeldBody(battle: SimBattle, body: SimPokemon, entry: ProtocolHeldItem | undefined, eligible: boolean): boolean {
  const shown = entry?.item ?? null;
  const want = shown ?? itemTheSimTook(battle, body);
  if (want === null) return false;
  const itemChanged = setHeldItem(battle, body, want);
  if (!body.isActive || body.fainted || !(itemChanged || entry?.touched)) return itemChanged;
  const lock = shown !== null || eligible ? entry?.firstMove ?? null : null;
  return setHeldItemLock(body, lock) || itemChanged;
}

/** The build's item when the sim's own move or ability took it from the body, else null. */
function itemTheSimTook(battle: SimBattle, body: SimPokemon): string | null {
  const build = toId(body.set.item);
  return body.item !== build && simTookItem(battle, body) ? build : null;
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
