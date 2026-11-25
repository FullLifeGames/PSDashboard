import { toId } from '@fulllifegames/replay-core';
import type { SimBattle, SimPokemon } from './types.ts';
import { takeBodyOut } from './team-order.ts';
import { sameBodyForme } from './body-forme.ts';


interface FreshEntry {
  body: SimPokemon;
  sideIdx: number;
  slot: number;
  line: number;
  drag: boolean;
}

const SWITCH_IN = /^\|(switch|drag|replace)\|(p[12])([a-d]):[^|]*\|([^,|]+)/;

// The sim's own lines of the block that just ended (it opened with |turn| one before the board's turn).
function simBlockLines(battle: SimBattle): string[] {
  return battle.log.slice(battle.log.lastIndexOf(`|turn|${battle.turn - 1}`) + 1);
}

function simSwitchedIn(lines: string[], sideId: string, test: (slotLetter: string, name: string) => boolean): boolean {
  return lines.some(line => {
    const match = line.match(/^\|(?:switch|drag|replace)\|(p[12])([a-d]): ([^|]*)/);
    return !!match && match[1] === sideId && test(match[2], match[3]);
  });
}

export const sameSpecies = (body: SimPokemon, species: string) => sameBodyForme(body.battle.dex, body.species.name, species);

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
    entries.push({ body, sideIdx, slot, line: index, drag: match[1] === 'drag' });
  });
  return entries;
}

// Faints the predecessor the log shows, so the side counts it before the entry reads it (Supreme Overlord).
function faintThePredecessor(battle: SimBattle, entry: FreshEntry, before: (SimPokemon | null)[][], events: string[], simLines: string[]): boolean {
  const sideId = battle.sides[entry.sideIdx].id;
  const ident = `${sideId}${String.fromCharCode('a'.charCodeAt(0) + entry.slot)}:`;
  let faintAt = -1;
  for (let index = entry.line - 1; index >= 0 && faintAt < 0; index--) {
    const line = events[index];
    if (SWITCH_IN.test(line) && line.split('|')[2].startsWith(ident)) return false;
    if (line.startsWith(`|faint|${ident}`)) faintAt = index;
  }
  if (faintAt < 0) return false;
  const predecessor = before[entry.sideIdx][entry.slot];
  if (!predecessor || predecessor.fainted || predecessor.hp <= 0) return true;
  const earlier = events.slice(0, faintAt).reverse()
    .find(line => SWITCH_IN.test(line) && line.split('|')[2].startsWith(ident))?.match(SWITCH_IN)?.[4].trim();
  const letter = ident[2];
  if (earlier ? !sameSpecies(predecessor, earlier) : simSwitchedIn(simLines, sideId, slotLetter => slotLetter === letter)) return true;
  takeThePredecessorOut(predecessor, entry);
  return true;
}

// `takeBodyOut` ends its ability as the simulator's faint does (Neutralizing Gas: Slow Start starts on Regigigas).
// The predecessor re-takes its slot while its End events run, then the replacement goes back (else twice).
function takeThePredecessorOut(predecessor: SimPokemon, entry: FreshEntry) {
  const { side } = predecessor;
  const replacement = side.active[entry.slot];
  const wasActive = predecessor.isActive;
  side.active[entry.slot] = predecessor;
  predecessor.isActive = true;
  takeBodyOut(predecessor, { fallen: true });
  side.active[entry.slot] = replacement;
  predecessor.isActive = wasActive;
  predecessor.status = '' as SimPokemon['status'];
  predecessor.clearVolatile(false);
  predecessor.isStarted = false;
}

interface EntryWay { afterFaint: boolean; drag: boolean }

// Gens 1 to 4, before ability and item start: a robbed body drops a regained item; Gens 1 and 2 forget the last moves;
// Gen 1 resets the side's last move slot. Left out: switchIn's Gen 1 partial-trap Metronome (no sweep reaches it).
function enterOlderGeneration(battle: SimBattle, body: SimPokemon) {
  if (body.itemKnockedOff && body.item) body.item = '';
  if (battle.gen <= 2) for (const active of battle.getAllActive()) active.lastMove = null;
  if (battle.gen === 1) body.side.lastSelectedMoveSlot = 0;
}

// Gens 1 to 4, after BeforeSwitchIn: EntryHazard, in Gens 1 and 2 AfterSwitchInSelf (not after a faint or a drag),
// in Gen 3 AfterEntryHazard after turn 0. False when the hazards K.O. the body: it then runs no runSwitch.
function settleOlderGeneration(battle: SimBattle, body: SimPokemon, way: EntryWay): boolean {
  battle.runEvent('EntryHazard', body);
  if (battle.gen <= 2 && !way.afterFaint && !way.drag) battle.runEvent('AfterSwitchInSelf', body);
  if (!body.hp) return false;
  if (battle.gen === 3 && battle.turn > 0) battle.runEvent('AfterEntryHazard', body);
  return true;
}

// BattleActions#switchIn's steps for the incoming body, then its runSwitch (Gens 1 to 4 play theirs inside switchIn);
// `test/entry-sweep.spec.ts` holds every entry these steps reach to switchIn.
function playEntry(battle: SimBattle, body: SimPokemon, way: EntryWay) {
  body.activeTurns = 0;
  body.activeMoveActions = 0;
  for (const moveSlot of body.moveSlots) moveSlot.used = false;
  if (battle.gen <= 4) enterOlderGeneration(battle, body);
  body.abilityState = battle.initEffectState({ id: body.ability, target: body });
  body.itemState = battle.initEffectState({ id: body.item, target: body });
  battle.runEvent('BeforeSwitchIn', body);
  body.previouslySwitchedIn++;
  if (battle.gen <= 4 && !settleOlderGeneration(battle, body, way)) return;
  battle.actions.runSwitch(body);
}

// The body entered before its turn ended, so Battle#endTurn ran over it: its per-active steps, no move made.
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

function turnFlags(battle: SimBattle) {
  return battle.sides.flatMap(side => side.pokemon.map(pokemon => ({
    pokemon,
    flags: {
      switchFlag: pokemon.switchFlag, forceSwitchFlag: pokemon.forceSwitchFlag, usedItemThisTurn: pokemon.usedItemThisTurn,
      statsRaisedThisTurn: pokemon.statsRaisedThisTurn, statsLoweredThisTurn: pokemon.statsLoweredThisTurn, hurtThisTurn: pokemon.hurtThisTurn,
    },
  })));
}

/** Plays the switch-in of every body the correction put on the field, silently; true when an entry played. */
// The entries' lines leave the sim log again (the alignment record reads it); own-turn state resets as endTurn left it.
export function playProtocolEntries(battle: SimBattle, before: (SimPokemon | null)[][], events: string[]): boolean {
  if (battle.ended || battle.queue.list.length > 0) return false;
  const simLines = simBlockLines(battle);
  const entries = freshEntries(battle, before, events, simLines);
  if (entries.length === 0) return false;
  const afterFaint = entries.map(entry => faintThePredecessor(battle, entry, before, events, simLines));
  const logLength = battle.log.length;
  const flags = turnFlags(battle);
  entries.forEach((entry, index) => playEntry(battle, entry.body, { afterFaint: afterFaint[index], drag: entry.drag }));
  battle.log.length = logLength;
  for (const { pokemon, flags: kept } of flags) Object.assign(pokemon, kept);
  for (const entry of entries) closeTheTurn(entry.body);
  return true;
}

// A `|-start|` line read as a Dex condition: the text after `move:`, `ability:` or `item:`;
// the stat suffix of `protosynthesisatk` is split off when the rest is a condition.
interface ProtocolStart {
  sideIdx: number;
  slot: number;
  id: string;
  stat?: string;
  source?: string;
  index: number;
}

const STAT_SUFFIX = /(atk|def|spa|spd|spe)$/;

function conditionOf(battle: SimBattle, effect: string): { id: string; stat?: string } | null {
  const token = toId(effect.replace(/^(move|ability|item): /i, ''));
  const condition = (id: string) => {
    const found = battle.dex.conditions.get(id);
    return found.exists && found.effectType === 'Condition' ? found.id : null;
  };
  const whole = condition(token);
  if (whole) return { id: whole };
  const stat = token.match(STAT_SUFFIX)?.[1];
  const stripped = stat ? condition(token.slice(0, -stat.length)) : null;
  return stripped && stat ? { id: stripped, stat } : null;
}

function liveStarts(battle: SimBattle, events: readonly string[]): ProtocolStart[] {
  const live = new Map<string, ProtocolStart>();
  events.forEach((line, index) => {
    const [, tag, ident, effect] = line.split('|');
    const slotKey = ident?.match(/^p([12])([a-d])/);
    if (!slotKey) return;
    const [key, sideIdx, slot] = [slotKey[0], Number(slotKey[1]) - 1, slotKey[2].charCodeAt(0) - 97];
    if (tag === 'switch' || tag === 'drag' || tag === 'faint') {
      for (const entry of live.keys()) if (entry.startsWith(`${key}:`)) live.delete(entry);
      return;
    }
    if ((tag !== '-start' && tag !== '-end') || !effect) return;
    const condition = conditionOf(battle, effect);
    if (!condition) return;
    if (tag === '-end') live.delete(`${key}:${condition.id}`);
    else live.set(`${key}:${condition.id}`, { sideIdx, slot, ...condition, source: line.match(/\|\[of\] (p[12][a-d])/)?.[1], index });
  });
  return [...live.values()];
}

// `queue.willMove` for duration handlers (Taunt, Encore: +1 turn if the body already moved): a move or `|cant|`
// of the body after the start line; a `[from]` move takes no queue place, a locked move does.
function moveStillToCome(events: readonly string[], start: ProtocolStart): boolean {
  const prefix = `p${start.sideIdx + 1}${String.fromCharCode(97 + start.slot)}:`;
  return events.slice(start.index + 1).some(line => {
    const [, tag, ident] = line.split('|');
    if ((tag !== 'move' && tag !== 'cant') || !ident?.startsWith(prefix)) return false;
    const from = line.match(/\|\[from\]([^|]*)/)?.[1];
    return !from || from === 'lockedmove';
  });
}

// Starts one volatile as the simulator does, then takes back what a start must not change here:
// the body's hp, the log, the dice and the turn flags.
function startVolatile(battle: SimBattle, body: SimPokemon, start: ProtocolStart, ticked: boolean, pending: boolean): boolean {
  const source = start.source ? battle.sides[Number(start.source[1]) - 1].active[start.source.charCodeAt(2) - 97] : null;
  const [hp, maxhp, logLength, seed, activeMove] = [body.hp, body.maxhp, battle.log.length, battle.prng.getSeed(), battle.activeMove];
  const flags = turnFlags(battle);
  battle.activeMove = null;
  const queue = battle.queue as { willMove: (pokemon: SimPokemon) => unknown };
  const realWillMove = queue.willMove;
  const asked = realWillMove.bind(queue);
  if (pending) queue.willMove = pokemon => (pokemon === body ? { choice: 'move', pokemon } : asked(pokemon));
  let added: boolean;
  try {
    added = !!body.addVolatile(start.id, source ?? null) && !!body.volatiles[start.id];
  } catch {
    added = false;
  } finally {
    if (pending) queue.willMove = realWillMove;
  }
  if (!added) delete body.volatiles[start.id];
  battle.activeMove = activeMove;
  [body.hp, body.maxhp] = [hp, maxhp];
  battle.log.length = logLength;
  battle.prng.setSeed(seed);
  for (const { pokemon, flags: kept } of flags) Object.assign(pokemon, kept);
  const state = body.volatiles[start.id];
  // The block's residual round ticked the counter of every volatile the simulator itself had started before it.
  if (added && ticked && typeof state?.duration === 'number' && --state.duration <= 0) {
    delete body.volatiles[start.id];
    return false;
  }
  return added;
}

/** Plays the `|-start|` lines the board lacks through the sim's own `addVolatile`; true when the board changed. */
// `residualAt`: the index in `events` of the block's residual round (lines before it count one duration tick).
export function playProtocolStarts(battle: SimBattle, events: readonly string[], residualAt = 0): boolean {
  if (battle.ended || battle.queue.list.length > 0 || !events.some(line => line.startsWith('|-start|'))) return false;
  let changed = false;
  for (const start of liveStarts(battle, events)) {
    const body = battle.sides[start.sideIdx].active[start.slot];
    if (!body || body.fainted || body.hp <= 0) continue;
    if (!body.volatiles[start.id]) changed = startVolatile(battle, body, start, start.index < residualAt, moveStillToCome(events, start)) || changed;
    const state = body.volatiles[start.id];
    if (start.stat && state && state['bestStat'] !== start.stat) {
      state['bestStat'] = start.stat;
      changed = true;
    }
  }
  return changed;
}
