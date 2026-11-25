import { isSitrusBerry, sitrusKeptAt, toId } from '@fulllifegames/replay-core';
import type { ChoiceLockContext, ProtocolHeldItem } from '../choice-lock.ts';
import type { SimBattle, SimPokemon } from './types.ts';
import { findPokemonOnSide } from './protocol-choices.ts';

/** Puts the items the protocol shows on the board, or the build's item back when the sim's move or ability took it. */
export function applyProtocolHeldItems(battle: SimBattle, context: ChoiceLockContext, turn: number, events: readonly string[] = []): boolean {
  // A guess the sim's own trigger consumed stays consumed, except on a body the sim switched in and the game never did.
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
    const allResolved = held.filter(entry => entry.side === sideId).length === entries.size;
    for (const body of side.pokemon) {
      const eligible = context.eligibility[sideId][toId(body.set.species)] === true;
      const gameLess = allResolved && !entries.has(body) && simBroughtIn(battle, body);
      if (correctHeldBody(battle, body, entries.get(body), eligible, gameLess, shownHealth.get(body))) changed = true;
    }
  }
  return changed;
}

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

// The build's Sitrus Berry when the sim ate it, the protocol shows no item line, and the HP the block shows is one
// where the Dex's threshold certainly would not have eaten it (the game kept the berry the sim's HP spent).
function witnessedBerry(battle: SimBattle, body: SimPokemon, health: string | undefined): string | null {
  const build = toId(body.set.item);
  if (!health || body.fainted || body.item !== '' || !isSitrusBerry(build)) return null;
  return sitrusKeptAt(battle.dex, health) ? build : null;
}

// The game never ate the witnessed berry, so the sim's eating marks (Belch and Cud Chew read them) go.
function restoreWitnessedBerry(battle: SimBattle, body: SimPokemon, health: string | undefined): boolean {
  const build = witnessedBerry(battle, body, health);
  if (build === null || !setHeldItem(battle, body, build)) return false;
  body.ateBerry = false;
  body.lastItem = '';
  return true;
}

function itemTheSimTook(battle: SimBattle, body: SimPokemon, gameLess: boolean): string | null {
  const build = toId(body.set.item);
  return body.item !== build && (gameLess || simTookItem(battle, body)) ? build : null;
}

function simBroughtIn(battle: SimBattle, body: SimPokemon): boolean {
  const ident = `${body.side.id}: ${body.name}`;
  return battle.log.some(line => {
    const parts = line.split('|');
    return (parts[1] === 'switch' || parts[1] === 'drag') && parts[2]?.replace(/^(p[1-4])[a-d]: /, '$1: ') === ident;
  });
}

// The sim's last item line on the body came from a move or an ability (Knock Off, Trick, Thief, Pickpocket; Bug Bite,
// Pluck write `[from] stealeat`), not from the item's own trigger.
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

// Pokemon#setItem and #takeItem without their events: the protocol already played the hand-over out.
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

// A held Choice item and the first move since it arrived or the body entered, else none.
function setHeldItemLock(body: SimPokemon, lock: string | null): boolean {
  const want = lock && body.getItem().isChoice && body.moveSlots.some(slot => slot.id === lock) ? lock : null;
  const current = (body.volatiles['choicelock'] as { move?: string } | undefined)?.move ?? null;
  if (current === want) return false;
  if (want) body.volatiles['choicelock'] = { id: 'choicelock', move: want } as never;
  else delete body.volatiles['choicelock'];
  return true;
}
