import { toId } from '@fulllifegames/replay-core';
import type { SimBattle, SimPokemon, SimSide } from './types.ts';
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
  /** The protocol dragged it in (Roar, Whirlwind, Dragon Tail): the simulator's entry of a drag. */
  drag: boolean;
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
    entries.push({ body, sideIdx, slot, line: index, drag: match[1] === 'drag' });
  });
  return entries;
}

/**
 * The faint the protocol shows on the slot before the body came in, when the
 * sim's body there still stands: the sim's own faint bookkeeping, so the side
 * counts it before the entry reads it (Supreme Overlord). The body is the one
 * the protocol lost when the protocol switched that species in earlier in the
 * block, or when neither side switched the slot during the block. True when the protocol shows the slot's faint before
 * the entry: the body then replaces a fainted one, as the simulator's replacement after a faint does.
 */
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
  predecessor.hp = 0;
  predecessor.fainted = true;
  predecessor.faintQueued = true;
  predecessor.status = '' as SimPokemon['status'];
  predecessor.clearVolatile(false);
  predecessor.isStarted = false;
  if (predecessor.side.totalFainted < 100) predecessor.side.totalFainted++;
  return true;
}

/**
 * BattleActions#switchIn's steps for the incoming body, then its runSwitch: the entry as the sim plays it. Round 78
 * (@pkmn 0.10.12): Gens 1 to 4 play their entry inside switchIn, where the gen 4 mod's runSwitch used to. A body Knock
 * Off robbed drops a regained item; Gens 1 and 2 forget the active Pokémon's last moves (Gen 1 resets the side's last
 * move slot and keeps a partial trap's Metronome); EntryHazard runs (hazards, Healing Wish, Lunar Dance), then in Gens
 * 1 and 2 AfterSwitchInSelf unless the body replaces a fainted one or is dragged in, and in Gen 3 after turn 0
 * AfterEntryHazard (the weather abilities). A body the hazards K.O. runs no runSwitch. The board stands at a turn's
 * start with an empty queue, so the move a partial trap would change is the side's record alone.
 * test/entry-sweep.spec.ts holds every entry these events reach to switchIn.
 */
function playEntry(battle: SimBattle, body: SimPokemon, entry: { afterFaint: boolean; drag: boolean }) {
  body.activeTurns = 0;
  body.activeMoveActions = 0;
  for (const moveSlot of body.moveSlots) moveSlot.used = false;
  if (battle.gen <= 4) {
    if (body.itemKnockedOff && body.item) body.item = '';
    if (battle.gen <= 2) for (const active of battle.getAllActive()) active.lastMove = null;
    if (battle.gen === 1) {
      body.side.lastSelectedMoveSlot = 0;
      for (const foe of body.foes()) {
        if (foe.volatiles['partialtrappinglock'] && foe.moveSlots[foe.side.lastSelectedMoveSlot]?.id === 'metronome') {
          foe.side.lastSelectedMove = 'metronome' as SimSide['lastSelectedMove'];
          foe.side.lastEnemySelectedMove = 'metronome' as SimSide['lastEnemySelectedMove'];
        }
      }
    }
  }
  body.abilityState = battle.initEffectState({ id: body.ability, target: body });
  body.itemState = battle.initEffectState({ id: body.item, target: body });
  battle.runEvent('BeforeSwitchIn', body);
  body.previouslySwitchedIn++;
  if (battle.gen <= 4) {
    battle.runEvent('EntryHazard', body);
    if (battle.gen <= 2 && !entry.afterFaint && !entry.drag) battle.runEvent('AfterSwitchInSelf', body);
    if (!body.hp) return;
    if (battle.gen === 3 && battle.turn > 0) battle.runEvent('AfterEntryHazard', body);
  }
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
  const afterFaint = entries.map(entry => faintThePredecessor(battle, entry, before, events, simLines));
  const logLength = battle.log.length;
  const flags = turnFlags(battle);
  entries.forEach((entry, index) => playEntry(battle, entry.body, { afterFaint: afterFaint[index], drag: entry.drag }));
  battle.log.length = logLength;
  for (const { pokemon, flags: kept } of flags) Object.assign(pokemon, kept);
  for (const entry of entries) closeTheTurn(entry.body);
  return true;
}

/**
 * Round 73 (T212): a `|-start|` the block shows and the board lacks. The simulator's own block misses a start when it diverges
 * (752733 turn 14: the game's Garganacl lives and starts Salt Cure, the simulator K.O.s it first), and its Protosynthesis or
 * Quark Drive may boost another stat than the one the protocol names. The line's effect is read as a Dex condition (the text
 * after `move:`, `ability:` or `item:`; the stat suffix of `protosynthesisatk` split off when the rest is a condition) and the
 * volatile starts through the simulator's own `addVolatile`, without a list of effects. A token no condition names (a
 * count such as perish3, a type change) starts nothing.
 */
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

/** The starts that still stand at the block's end: not ended by an `-end`, and the body still on its slot (no switch, drag or faint after). */
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

/**
 * Round 76 (T261): whether the body still had its move to make when the start landed, which is what the simulator's
 * `queue.willMove` answers to a duration handler (Taunt and Encore lengthen by a turn when it does not). The block's own
 * order shows it: a move or a failed move of the body (`|cant|`) after the start line. A move the body makes inside another
 * action (`[from]` an ability, Instruct, a called move) takes no place in the queue; a locked move does.
 */
function moveStillToCome(events: readonly string[], start: ProtocolStart): boolean {
  const prefix = `p${start.sideIdx + 1}${String.fromCharCode(97 + start.slot)}:`;
  return events.slice(start.index + 1).some(line => {
    const [, tag, ident] = line.split('|');
    if ((tag !== 'move' && tag !== 'cant') || !ident?.startsWith(prefix)) return false;
    const from = line.match(/\|\[from\]([^|]*)/)?.[1];
    return !from || from === 'lockedmove';
  });
}

/** Starts one volatile on the body as the simulator does, then takes back what a start must not change here: the body's hp, the log, the dice and the turn flags. */
function startVolatile(battle: SimBattle, body: SimPokemon, start: ProtocolStart, ticked: boolean, pending: boolean): boolean {
  const source = start.source ? battle.sides[Number(start.source[1]) - 1].active[start.source.charCodeAt(2) - 97] : null;
  const [hp, maxhp, logLength, seed, activeMove] = [body.hp, body.maxhp, battle.log.length, battle.prng.getSeed(), battle.activeMove];
  const flags = turnFlags(battle);
  battle.activeMove = null;
  // The queue is empty at the block's end; a body whose move came after the line answers as it did in the game.
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

/**
 * Plays the `-start` lines of the block that the board lacks, on the body standing on the line's slot at the block's end.
 * `residualAt`: the index in `events` where the block's residual round came (the lines before it count one tick on a
 * duration). A volatile the board has keeps its state, but a protosynthesis-style stat takes the protocol's. True when the
 * board changed.
 */
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
