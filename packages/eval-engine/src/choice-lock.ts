/**
 * Protocol-truth Choice locks (round 2, agenda item ③). The active
 * correction deletes `choicelock` as a divergence defense (the Vileplume
 * tricked-scarf story) — these helpers re-derive the TRUE lock from the
 * replay text so honest locks survive: sim artifacts cannot re-enter
 * because nothing here reads sim history.
 */

import { calculate, Field, Generations, Move, Pokemon } from '@smogon/calc';
import { Dex, type PokemonSet } from '@pkmn/sim';
import { type DamageObservation, typedHiddenPowerId, inferOpponentTeam, itemSetValue, toId } from '@fulllifegames/replay-core';
import { CHOICE_ITEMS } from './sensitivity.ts';

/** `handedOver`: the Choice item came by a move, so the protocol itself shows it (no set guess to vet). */
export interface ProtocolLock { species: string; moveId: string; handedOver?: boolean }
interface TrailState { species: string; moves: string[]; itemDisturbed: boolean; handedItem?: string }
export type ChoiceLockTrails = Record<'p1' | 'p2', Map<number, TrailState | null>>;

/** `pXy: Nickname` -> `pX: Nickname`: nicknames key the bodies, so slots never matter (doubles). */
const bodyKey = (ident: string | undefined) => (ident ?? '').replace(/^(p[12])[a-d]?: /, '$1: ');
/** Lines after which no move is in progress: an entry, the request break (`|`), the turn's end. */
const MOVE_ENDS = new Set(['switch', 'drag', 'replace', '', 'upkeep', 'turn']);

/**
 * The `-item` lines that hand their body an item rather than show one it
 * held (round 64, T121), told apart by where the simulator writes them, not
 * by species. A move always moves items (Trick, Thief, Covet, Bestow,
 * Recycle; Fling writes `[from]move:`). An ability moves one when its line
 * comes inside the receiver's own move (Magician: the thief's move is in
 * progress) or right after the giver's silent `-enditem` from the same
 * effect (Pickpocket). Frisk writes its line at the frisker's entry about
 * the holder it shows, so it never sits inside that holder's move.
 */
function handOverLines(lines: string[]): Set<number> {
  const handed = new Set<number>();
  let mover: string | null = null;
  let silentGive: string | null = null;
  lines.forEach((line, index) => {
    const parts = line.split('|');
    const from = parts.find(part => part.startsWith('[from]'))?.match(/^\[from\] ?(move|ability): ?(.+)$/);
    if (parts[1] === 'move') mover = bodyKey(parts[2]);
    else if (MOVE_ENDS.has(parts[1] ?? '')) mover = null;
    if (parts[1] === '-item' && from && (from[1] === 'move' || from[2] === silentGive || mover === bodyKey(parts[2]))) handed.add(index);
    silentGive = parts[1] === '-enditem' && parts.includes('[silent]') && from ? from[2] : null;
  });
  return handed;
}

const isChoiceItem = (itemId: string) => !!itemId && Dex.items.get(itemId).isChoice === true;

/**
 * A hand-over to the trailing active (round 63, T115; abilities since round
 * 64): its trail starts over with that item, because the sim's Choice item
 * drops the old lock on arrival and locks the next move. A reveal (Frisk, an
 * Air Balloon announcement) leaves the trail as it was; any other item line
 * disturbs.
 */
function noteTrailItemLine(state: TrailState, line: string, handed: boolean) {
  const parts = line.split('|');
  if (handed) {
    state.moves = [];
    state.itemDisturbed = false;
    state.handedItem = toId(parts[3] ?? '');
    return;
  }
  if (parts[1] !== '-item') state.itemDisturbed = true;
}

/**
 * One forward walk over the log; the state AT each `|turn|N` marker is the
 * trail for turn N's position (moves the CURRENT active committed since its
 * last real entry or a handed-over item, and whether its item was otherwise
 * touched in that span).
 */
export function buildChoiceLockTrails(replayLog: string): ChoiceLockTrails {
  const trails: ChoiceLockTrails = { p1: new Map(), p2: new Map() };
  const current: Record<'p1' | 'p2', TrailState | null> = { p1: null, p2: null };
  const lines = replayLog.split('\n');
  const handed = handOverLines(lines);
  for (const [index, line] of lines.entries()) {
    const entry = line.match(/^\|(?:switch|drag)\|(p[12])[a-d]?:[^|]*\|([^,|]+)/);
    if (entry) {
      current[entry[1] as 'p1' | 'p2'] = { species: entry[2].trim(), moves: [], itemDisturbed: false };
      continue;
    }
    const move = line.match(/^\|move\|(p[12])[a-d]?:/);
    if (move) {
      const state = current[move[1] as 'p1' | 'p2'];
      const moveId = toId(line.split('|')[3] ?? '');
      if (state && moveId && !state.moves.includes(moveId)) state.moves.push(moveId);
      continue;
    }
    const item = line.match(/^\|-(?:item|enditem)\|(p[12])[a-d]?:/);
    if (item) {
      const state = current[item[1] as 'p1' | 'p2'];
      if (state) noteTrailItemLine(state, line, handed.has(index));
      continue;
    }
    const turn = line.match(/^\|turn\|(\d+)/);
    if (turn) {
      const n = parseInt(turn[1], 10);
      trails.p1.set(n, current.p1 ? { ...current.p1, moves: [...current.p1.moves] } : null);
      trails.p2.set(n, current.p2 ? { ...current.p2, moves: [...current.p2.moves] } : null);
    }
  }
  return trails;
}

/**
 * The one-distinct-move rule: exactly one committed move, item untouched —
 * or, after a hand-over, a Choice item and one move since it arrived.
 */
export function protocolChoiceLock(
  trails: ChoiceLockTrails, side: 'p1' | 'p2', turn: number,
): ProtocolLock | null {
  const state = trails[side].get(turn);
  if (!state || state.itemDisturbed || state.moves.length !== 1) return null;
  if (state.handedItem === undefined) return { species: state.species, moveId: state.moves[0] };
  if (!isChoiceItem(state.handedItem)) return null;
  return { species: state.species, moveId: state.moves[0], handedOver: true };
}

/**
 * What one body holds by the protocol (round 63, T115; every item line since
 * round 64, T121).
 */
export interface ProtocolHeldItem {
  side: 'p1' | 'p2';
  species: string;
  /** The item id the protocol shows ('' = nothing); null before any item line on the body. */
  item: string | null;
  /** The body's first move since it entered or was handed its item: a Choice item's lock. */
  firstMove: string | null;
  /** The protocol's item for the body changed in the block before this boundary. */
  touched: boolean;
}
interface HeldState { side: 'p1' | 'p2'; species: string; item: string | null; moves: string[] }
/** Per slot: the body its last entry named and what that body held just before (an Illusion may undo it). */
interface SlotEntry { key: string; item: string | null; moves: string[]; touched: boolean }
type HeldWalk = { bodies: Map<string, HeldState>; touched: Set<HeldState>; slots: Map<string, SlotEntry> };

/** The body a `pXa: Nickname` ident names. */
const heldBody = (walk: HeldWalk, ident: string | undefined) => walk.bodies.get(bodyKey(ident));

/** The body an entry or replace line names, created on first sight, and its slot (`p2a`). */
function namedBody(walk: HeldWalk, parts: string[]) {
  const ident = parts[2]?.match(/^(p[12])([a-d])?: (.+)$/);
  if (!ident) return null;
  const key = `${ident[1]}: ${ident[3]}`;
  const species = (parts[3] ?? '').split(',')[0].trim();
  const body = walk.bodies.get(key) ?? { side: ident[1] as 'p1' | 'p2', species, item: null, moves: [] };
  body.species = species;
  walk.bodies.set(key, body);
  return { key, body, slot: `${ident[1]}${ident[2] ?? 'a'}` };
}

function noteHeldEntry(walk: HeldWalk, parts: string[]) {
  const named = namedBody(walk, parts);
  if (!named) return;
  const { key, body, slot } = named;
  walk.slots.set(slot, { key, item: body.item, moves: body.moves, touched: walk.touched.has(body) });
  body.moves = [];
}

/**
 * An Illusion breaks (round 64 review): the lines since the slot's last
 * entry were the Zoroark's, written under the name of the body it imitated
 * (681568: "Volcarona"'s Focus Sash broke on Zoroark-Hisui). The imitated
 * body gets back what it held at that entry; the Zoroark takes the item the
 * lines left and the moves since.
 */
function noteHeldReplace(walk: HeldWalk, parts: string[]) {
  const named = namedBody(walk, parts);
  if (!named) return;
  const entry = walk.slots.get(named.slot);
  const disguise = entry && walk.bodies.get(entry.key);
  walk.slots.set(named.slot, { key: named.key, item: named.body.item, moves: named.body.moves, touched: walk.touched.has(named.body) });
  if (!entry || !disguise || disguise === named.body) return;
  if (disguise.item !== entry.item && disguise.item !== null) setHeld(walk, named.body, disguise.item);
  named.body.moves = disguise.moves;
  disguise.item = entry.item;
  disguise.moves = entry.moves;
  if (!entry.touched) walk.touched.delete(disguise);
}

function setHeld(walk: HeldWalk, body: HeldState, item: string) {
  if (body.item === item) return;
  body.item = item;
  walk.touched.add(body);
}

/**
 * Every item line makes the body's item known (round 64, T121): `-enditem`
 * leaves none, `-item` names it. A hand-over restarts the body's moves, and
 * the `[of]` body gives the item up (Covet, Bestow and Magician write no
 * line for the giver).
 */
function noteHeldItemLine(walk: HeldWalk, parts: string[], handed: boolean) {
  const body = heldBody(walk, parts[2]);
  if (!body) return;
  if (parts[1] === '-enditem') return setHeld(walk, body, '');
  setHeld(walk, body, toId(parts[3] ?? ''));
  if (!handed) return;
  body.moves = [];
  const giver = heldBody(walk, parts.find(part => part.startsWith('[of] '))?.slice(5));
  if (giver && giver !== body) setHeld(walk, giver, '');
}

/**
 * Per boundary turn N, every body the protocol has shown so far, in order
 * of first entry, with the item the protocol shows at the boundary and
 * whether the block before it (between `|turn|N-1` and `|turn|N`) changed
 * it. The board takes these over: the sim plays a swap or a Knock Off with
 * the build's guesses (655336: the Trick handed Bisharp the guessed Colbur
 * Berry), on another body, or misses a trigger the game had (751505: the
 * sim popped an Air Balloon the protocol never popped).
 */
export function buildProtocolHeldItems(replayLog: string): Map<number, ProtocolHeldItem[]> {
  const out = new Map<number, ProtocolHeldItem[]>();
  const walk: HeldWalk = { bodies: new Map(), touched: new Set(), slots: new Map() };
  const lines = replayLog.split('\n');
  const handed = handOverLines(lines);
  for (const [index, line] of lines.entries()) {
    const parts = line.split('|');
    if (parts[1] === 'switch' || parts[1] === 'drag') noteHeldEntry(walk, parts);
    else if (parts[1] === 'replace') noteHeldReplace(walk, parts);
    else if (parts[1] === '-item' || parts[1] === '-enditem') noteHeldItemLine(walk, parts, handed.has(index));
    else if (parts[1] === 'move') {
      const body = heldBody(walk, parts[2]);
      const moveId = toId(parts[3] ?? '');
      if (body && moveId && !body.moves.includes(moveId)) body.moves.push(moveId);
    } else if (parts[1] === 'turn') {
      out.set(parseInt(parts[2], 10), [...walk.bodies.values()].map(body => ({
        side: body.side, species: body.species, item: body.item, firstMove: body.moves[0] ?? null, touched: walk.touched.has(body),
      })));
      walk.touched = new Set();
    }
  }
  return out;
}

export type ItemCorroboration = 'corroborated' | 'contradicted' | 'ambiguous';

/** HP-bar reading slack — mirrors spread-inference's tolerance. */
const OBSERVATION_SLACK = 0.02;

/** The ×1.2 bluff items a big hit could hide behind (user: Mystic Water). */
const TYPE_BOOST_ITEMS: Record<string, string> = {
  Water: 'Mystic Water', Fire: 'Charcoal', Electric: 'Magnet', Grass: 'Miracle Seed',
  Ice: 'Never-Melt Ice', Fighting: 'Black Belt', Poison: 'Poison Barb', Ground: 'Soft Sand',
  Flying: 'Sharp Beak', Psychic: 'Twisted Spoon', Bug: 'Silver Powder', Rock: 'Hard Stone',
  Ghost: 'Spell Tag', Dragon: 'Dragon Fang', Dark: 'Black Glasses', Steel: 'Metal Coat',
  Normal: 'Silk Scarf',
};

/**
 * The user's rule (spec 1c): a merely GUESSED Choice item must survive a
 * damage check before it may justify a lock. Per observation the hypothesis
 * whose roll range (± slack) contains the observed fraction explains it;
 * corroborated = some observation ONLY the Choice item explains and none
 * only a rival explains; contradicted = some observation the Choice item
 * CANNOT explain; everything else ambiguous (evidence never blocks by
 * absence).
 */
type CalcGen = ReturnType<typeof Generations.get>;

function calcAttacker(gen: CalcGen, attackerSet: PokemonSet, obs: DamageObservation, withItem: string): Pokemon {
  return new Pokemon(gen, attackerSet.species, {
    level: attackerSet.level || 100, ability: attackerSet.ability || undefined,
    item: withItem || undefined, nature: attackerSet.nature, evs: attackerSet.evs,
    ivs: attackerSet.ivs, boosts: obs.attackerBoosts,
    status: (obs.attackerStatus || undefined) as never,
  });
}

function calcDefender(gen: CalcGen, defenderSet: PokemonSet | undefined, obs: DamageObservation): Pokemon {
  return new Pokemon(gen, defenderSet?.species ?? obs.defenderSpecies, {
    level: defenderSet?.level || 100, nature: defenderSet?.nature,
    evs: defenderSet?.evs, ivs: defenderSet?.ivs, boosts: obs.defenderBoosts,
  });
}

/** Whether the roll range (± slack) under `withItem` contains the observed fraction; null when the calc cannot judge. */
function explainsObservation(
  gen: CalcGen, attackerSet: PokemonSet, defenderSet: PokemonSet | undefined, obs: DamageObservation,
  calcMoveId: string, withItem: string,
): boolean | null {
  try {
    const attacker = calcAttacker(gen, attackerSet, obs, withItem);
    const defender = calcDefender(gen, defenderSet, obs);
    const result = calculate(gen, attacker, defender, new Move(gen, calcMoveId), new Field({}));
    const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
    const maxHp = defender.maxHP();
    if (rolls.length === 0 || maxHp <= 0) return null;
    const min = Math.min(...rolls) / maxHp - OBSERVATION_SLACK;
    const max = Math.max(...rolls) / maxHp + OBSERVATION_SLACK;
    // A knock-out line only says "at least the remainder" (round 32's
    // spread-fit rule): the hypothesis must reach the fraction, not land on it.
    if (obs.lethal) return obs.observedFraction <= max;
    return obs.observedFraction >= min && obs.observedFraction <= max;
  } catch {
    return null; // Unknown move/species for this gen: cannot judge.
  }
}

/** The rival hypotheses: no item, plus the move type's ×1.2 bluff item when one exists. */
function rivalItemsFor(gen: CalcGen, calcMoveId: string): string[] {
  const moveType = (() => {
    try { return new Move(gen, calcMoveId).type; } catch { return undefined; }
  })();
  const bluff = moveType ? TYPE_BOOST_ITEMS[moveType] : undefined;
  return ['', ...(bluff ? [bluff] : [])];
}

/** One observation's verdict on the Choice item hypothesis. */
function judgeObservation(
  gen: CalcGen, attackerSet: PokemonSet, defenderSet: PokemonSet | undefined, obs: DamageObservation, item: string,
): 'contradicted' | 'choice-only' | 'skip' {
  // Typeless "hiddenpower" calcs as the set's resolved variant (same seam
  // as spread-inference — the IV-default type would judge with wrong rolls).
  const calcMoveId = obs.moveId === 'hiddenpower'
    ? typedHiddenPowerId(attackerSet.moves) ?? obs.moveId
    : obs.moveId;
  const explains = (withItem: string) => explainsObservation(gen, attackerSet, defenderSet, obs, calcMoveId, withItem);
  const rivals = rivalItemsFor(gen, calcMoveId);
  const choiceFits = explains(item);
  if (choiceFits === null) return 'skip';
  const rivalFits = rivals.map(explains).some(fit => fit === true);
  if (!choiceFits) {
    // Nothing explains it (crit slack, unknown context) — cannot judge.
    return rivalFits ? 'contradicted' : 'skip';
  }
  return rivalFits ? 'skip' : 'choice-only';
}

export function corroborateChoiceItem(
  side: 'p1' | 'p2',
  species: string,
  item: string,
  teams: { p1Team: PokemonSet[]; p2Team: PokemonSet[] },
  observations: DamageObservation[],
  genNum: number,
): ItemCorroboration {
  const gen = Generations.get(Math.min(9, Math.max(1, genNum)) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
  const speciesId = toId(species);
  const attackerSet = (side === 'p1' ? teams.p1Team : teams.p2Team)
    .find(candidate => toId(candidate.species) === speciesId);
  if (!attackerSet) return 'ambiguous';
  let sawChoiceOnly = false;
  for (const obs of observations) {
    if (obs.attackerSide !== side || toId(obs.attackerSpecies) !== speciesId) continue;
    const defenderTeam = side === 'p1' ? teams.p2Team : teams.p1Team;
    const defenderSet = defenderTeam.find(candidate => toId(candidate.species) === toId(obs.defenderSpecies));
    const verdict = judgeObservation(gen, attackerSet, defenderSet, obs, item);
    if (verdict === 'contradicted') return 'contradicted';
    if (verdict === 'choice-only') sawChoiceOnly = true;
  }
  return sawChoiceOnly ? 'corroborated' : 'ambiguous';
}

export interface ChoiceLockContext {
  trails: ChoiceLockTrails;
  /** speciesId -> may this mon's (choice) item justify a lock stamp? */
  eligibility: Record<'p1' | 'p2', Record<string, boolean>>;
  /** Boundary turn -> what every body the protocol has shown holds there (round 63, T115; round 64, T121). */
  heldItems: Map<number, ProtocolHeldItem[]>;
}

/**
 * Assembled once per game: trails from the log, eligibility from the built
 * teams — a revealed/manual choice item is trusted, a guessed one must not
 * be CONTRADICTED by the damage record (spec 1c; ambiguity never blocks).
 */
export function buildChoiceLockContext(
  replayLog: string,
  teams: { p1Team: PokemonSet[]; p2Team: PokemonSet[] },
  observations: DamageObservation[],
): ChoiceLockContext {
  const genNum = parseInt(replayLog.match(/^\|gen\|(\d)/m)?.[1] ?? '9', 10);
  const eligibility: ChoiceLockContext['eligibility'] = { p1: {}, p2: {} };
  for (const side of ['p1', 'p2'] as const) {
    const info = inferOpponentTeam(replayLog, side);
    const team = side === 'p1' ? teams.p1Team : teams.p2Team;
    for (const built of team) {
      const speciesId = toId(built.species);
      if (!CHOICE_ITEMS.has(toId(built.item ?? ''))) continue;
      const revealed = info.pokemon.find(mon => toId(mon.species) === speciesId);
      // The team preview's "(has item)" is revealed-source but names no item
      // (round 64, T121: 649664's guessed Keldeo Specs skipped the check).
      const proven = (revealed?.item.source === 'revealed' || revealed?.item.source === 'manual') &&
        toId(itemSetValue(revealed.item.value)) === toId(built.item);
      eligibility[side][speciesId] = proven ||
        corroborateChoiceItem(side, built.species, built.item, teams, observations, genNum) !== 'contradicted';
    }
  }
  return { trails: buildChoiceLockTrails(replayLog), eligibility, heldItems: buildProtocolHeldItems(replayLog) };
}
