import { toId } from '@fulllifegames/replay-core';
import type { SimBattle, SimPokemon } from './types.ts';
import { normalizeBattleOnlyFormeId } from './team-order.ts';

/**
 * Round 67 (T133): a body the boundary correction puts on the field, where the
 * sim kept another one, plays the switch-in the game showed. Before, it never
 * did: 749828 t17, Roaring Moon held no Booster Energy (as in the game) but
 * lacked the Protosynthesis the protocol shows, because the sim's Gholdengo
 * had not fainted and the repoint skipped the entry. The entry is the
 * simulator's own (no list of effects), and a body the sim already brought in
 * during the block keeps the entry it played there.
 */

interface FreshEntry {
  body: SimPokemon;
  sideIdx: number;
  slot: number;
  /** Index of the protocol line that brought the body in. */
  line: number;
}

const SWITCH_IN = /^\|(switch|drag|replace)\|(p[12])([a-d]):[^|]*\|([^,|]+)/;

/** The sim's own lines of the block that just ended (it opened with |turn| one before the board's turn). */
function simBlockLines(battle: SimBattle): string[] {
  return battle.log.slice(battle.log.lastIndexOf(`|turn|${battle.turn - 1}`) + 1);
}

/** Whether the sim's block wrote a switch-in on the slot (any body), or of the body (any slot). */
function simSwitchedIn(lines: string[], sideId: string, test: (slotLetter: string, name: string) => boolean): boolean {
  return lines.some(line => {
    const match = line.match(/^\|(?:switch|drag|replace)\|(p[12])([a-d]): ([^|]*)/);
    return !!match && match[1] === sideId && test(match[2], match[3]);
  });
}

const sameSpecies = (body: SimPokemon, species: string) =>
  normalizeBattleOnlyFormeId(toId(body.species.name)) === normalizeBattleOnlyFormeId(toId(species));

/**
 * Bodies active after the repoints that were not active in the sim before them,
 * alive, and that the sim's own block did not switch in, in the order the
 * protocol brought them.
 */
function freshEntries(battle: SimBattle, before: (SimPokemon | null)[][], events: string[], simLines: string[]): FreshEntry[] {
  const entries: FreshEntry[] = [];
  events.forEach((line, index) => {
    const match = line.match(SWITCH_IN);
    if (!match) return;
    const sideIdx = match[2] === 'p1' ? 0 : 1;
    const slot = match[3].charCodeAt(0) - 'a'.charCodeAt(0);
    const body = battle.sides[sideIdx].active[slot];
    if (!body || body.fainted || body.hp <= 0 || !sameSpecies(body, match[4].trim())) return;
    if (before[sideIdx].includes(body)) return;
    if (simSwitchedIn(simLines, body.side.id, (_, name) => name === body.name)) return;
    const known = entries.findIndex(entry => entry.body === body);
    if (known >= 0) entries.splice(known, 1);
    entries.push({ body, sideIdx, slot, line: index });
  });
  return entries;
}

/**
 * The faint the protocol shows on the slot before the body came in, when the
 * sim's body there still stands: the sim's own faint bookkeeping, so the side
 * counts it before the entry reads it (Supreme Overlord). The body is the one
 * the protocol lost when the protocol switched that species in earlier in the
 * block, or when neither side switched the slot during the block.
 */
function faintThePredecessor(battle: SimBattle, entry: FreshEntry, before: (SimPokemon | null)[][], events: string[], simLines: string[]) {
  const sideId = battle.sides[entry.sideIdx].id;
  const ident = `${sideId}${String.fromCharCode('a'.charCodeAt(0) + entry.slot)}:`;
  let faintAt = -1;
  for (let index = entry.line - 1; index >= 0 && faintAt < 0; index--) {
    const line = events[index];
    if (SWITCH_IN.test(line) && line.split('|')[2].startsWith(ident)) return;
    if (line.startsWith(`|faint|${ident}`)) faintAt = index;
  }
  const predecessor = before[entry.sideIdx][entry.slot];
  if (faintAt < 0 || !predecessor || predecessor.fainted || predecessor.hp <= 0) return;
  const earlier = events.slice(0, faintAt).reverse()
    .find(line => SWITCH_IN.test(line) && line.split('|')[2].startsWith(ident))?.match(SWITCH_IN)?.[4].trim();
  const letter = ident[2];
  if (earlier ? !sameSpecies(predecessor, earlier) : simSwitchedIn(simLines, sideId, slotLetter => slotLetter === letter)) return;
  predecessor.hp = 0;
  predecessor.fainted = true;
  predecessor.faintQueued = true;
  predecessor.status = '' as SimPokemon['status'];
  predecessor.clearVolatile(false);
  predecessor.isStarted = false;
  if (predecessor.side.totalFainted < 100) predecessor.side.totalFainted++;
}

/** BattleActions#switchIn's steps for the incoming body, then its runSwitch: the entry as the sim plays it. */
function playEntry(battle: SimBattle, body: SimPokemon) {
  body.activeTurns = 0;
  body.activeMoveActions = 0;
  for (const moveSlot of body.moveSlots) moveSlot.used = false;
  body.abilityState = battle.initEffectState({ id: body.ability, target: body });
  body.itemState = battle.initEffectState({ id: body.item, target: body });
  battle.runEvent('BeforeSwitchIn', body);
  body.previouslySwitchedIn++;
  battle.actions.runSwitch(body);
}

/**
 * The game's body entered before its turn ended, so Battle#endTurn ran over it
 * once: the per-active steps of endTurn for the entered body, which made no
 * move in that turn (the move disable pass follows in the request refresh).
 */
function closeTheTurn(body: SimPokemon) {
  body.moveThisTurn = '';
  body.newlySwitched = false;
  body.moveLastTurnResult = undefined;
  body.moveThisTurnResult = undefined;
  body.usedItemThisTurn = false;
  body.statsRaisedThisTurn = false;
  body.statsLoweredThisTurn = false;
  body.hurtThisTurn = null;
  body.activeTurns++;
}

/** The fields a turn's events set that the sim's endTurn already cleared for this turn, per body. */
function turnFlags(battle: SimBattle) {
  return battle.sides.flatMap(side => side.pokemon.map(pokemon => ({
    pokemon,
    flags: {
      switchFlag: pokemon.switchFlag, forceSwitchFlag: pokemon.forceSwitchFlag, usedItemThisTurn: pokemon.usedItemThisTurn,
      statsRaisedThisTurn: pokemon.statsRaisedThisTurn, statsLoweredThisTurn: pokemon.statsLoweredThisTurn, hurtThisTurn: pokemon.hurtThisTurn,
    },
  })));
}

/**
 * Plays the switch-in of every body the correction put on the field. Silent:
 * the lines the entries write leave the sim's log again, like every other
 * correction (the block's alignment record reads that log afterwards). The
 * board stands at the start of a turn, so what an entry sets for its own turn
 * goes back to how the sim's endTurn left it, a switch an entry effect asks
 * for (an Eject Pack after Intimidate) among it: the protocol already placed
 * every body. True when an entry played.
 */
export function playProtocolEntries(battle: SimBattle, before: (SimPokemon | null)[][], events: string[]): boolean {
  if (battle.ended || battle.queue.list.length > 0) return false;
  const simLines = simBlockLines(battle);
  const entries = freshEntries(battle, before, events, simLines);
  if (entries.length === 0) return false;
  for (const entry of entries) faintThePredecessor(battle, entry, before, events, simLines);
  const logLength = battle.log.length;
  const flags = turnFlags(battle);
  for (const entry of entries) playEntry(battle, entry.body);
  battle.log.length = logLength;
  for (const { pokemon, flags: kept } of flags) Object.assign(pokemon, kept);
  for (const entry of entries) closeTheTurn(entry.body);
  return true;
}
