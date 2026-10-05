/**
 * Protocol-truth Choice locks (round 2, agenda item ③). The active
 * correction deletes `choicelock` as a divergence defense (the Vileplume
 * tricked-scarf story) — these helpers re-derive the TRUE lock from the
 * replay text so honest locks survive: sim artifacts cannot re-enter
 * because nothing here reads sim history.
 */

import { calculate, Field, Generations, Move, Pokemon } from '@smogon/calc';
import { Dex, type PokemonSet } from '@pkmn/sim';
import { type DamageObservation, typedHiddenPowerId, inferOpponentTeam, toId } from '@fulllifegames/replay-core';
import { CHOICE_ITEMS } from './sensitivity.ts';

/** `handedOver`: the Choice item came by a move, so the protocol itself shows it (no set guess to vet). */
export interface ProtocolLock { species: string; moveId: string; handedOver?: boolean }
interface TrailState { species: string; moves: string[]; itemDisturbed: boolean; handedItem?: string }
export type ChoiceLockTrails = Record<'p1' | 'p2', Map<number, TrailState | null>>;

/**
 * An item line a move wrote (`[from] move: Trick`, Switcheroo, Thief,
 * Knock Off, ...; Fling writes `[from]move:`): the protocol's word on what
 * the body holds from that line on.
 */
const MOVE_ITEM_SOURCE = /\[from\] ?move: /;

const isChoiceItem = (itemId: string) => !!itemId && Dex.items.get(itemId).isChoice === true;

/**
 * A move hands the trailing active an item (round 63, T115): its trail
 * starts over with that item, because the sim's Choice item drops the old
 * lock on arrival and locks the next move. Any other item line disturbs.
 */
function noteTrailItemLine(state: TrailState, line: string) {
  if (line.startsWith('|-item|') && MOVE_ITEM_SOURCE.test(line)) {
    state.moves = [];
    state.itemDisturbed = false;
    state.handedItem = toId(line.split('|')[3] ?? '');
    return;
  }
  state.itemDisturbed = true;
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
  for (const line of replayLog.split('\n')) {
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
      if (state) noteTrailItemLine(state, line);
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
 * What one body holds by the protocol (round 63, T115): `item` is an item
 * id ('' = nothing), `lock` the move a Choice item holds it to (its first
 * move since the item arrived), null without one.
 */
export interface ProtocolHeldItem { side: 'p1' | 'p2'; species: string; item: string; lock: string | null }
interface HeldState { side: 'p1' | 'p2'; species: string; item: string | null; moves: string[] }
type HeldWalk = { bodies: Map<string, HeldState>; touched: Set<HeldState> };

/** The body a `pXa: Nickname` ident names; nicknames key the bodies, so slots never matter (doubles). */
const heldBody = (walk: HeldWalk, ident: string | undefined) => walk.bodies.get((ident ?? '').replace(/^(p[12])[a-d]?: /, '$1: '));

function noteHeldEntry(walk: HeldWalk, parts: string[]) {
  const ident = parts[2]?.match(/^(p[12])[a-d]?: (.+)$/);
  if (!ident) return;
  const key = `${ident[1]}: ${ident[2]}`;
  const species = (parts[3] ?? '').split(',')[0].trim();
  const body = walk.bodies.get(key) ?? { side: ident[1] as 'p1' | 'p2', species, item: null, moves: [] };
  body.species = species;
  body.moves = [];
  walk.bodies.set(key, body);
}

/** A move-written item line makes the body's item known; once known, every item line on it counts. */
function noteHeldItemLine(walk: HeldWalk, parts: string[], line: string) {
  const body = heldBody(walk, parts[2]);
  if (!body || (body.item === null && !MOVE_ITEM_SOURCE.test(line))) return;
  const item = parts[1] === '-item' ? toId(parts[3] ?? '') : '';
  if (body.item === item) return;
  body.item = item;
  body.moves = [];
  walk.touched.add(body);
}

/**
 * Per boundary turn N, every body whose protocol item changed in the block
 * before it (between `|turn|N-1` and `|turn|N`), in order of first touch,
 * with its item and lock at the boundary. The board takes these over: the
 * sim plays a swap or a Knock Off with the build's guesses (655336: the
 * Trick handed Bisharp the guessed Colbur Berry) or on another body.
 */
export function buildProtocolHeldItems(replayLog: string): Map<number, ProtocolHeldItem[]> {
  const out = new Map<number, ProtocolHeldItem[]>();
  const walk: HeldWalk = { bodies: new Map(), touched: new Set() };
  for (const line of replayLog.split('\n')) {
    const parts = line.split('|');
    if (parts[1] === 'switch' || parts[1] === 'drag') noteHeldEntry(walk, parts);
    else if (parts[1] === '-item' || parts[1] === '-enditem') noteHeldItemLine(walk, parts, line);
    else if (parts[1] === 'move') {
      const body = heldBody(walk, parts[2]);
      const moveId = toId(parts[3] ?? '');
      if (body && moveId && !body.moves.includes(moveId)) body.moves.push(moveId);
    } else if (parts[1] === 'turn' && walk.touched.size > 0) {
      out.set(parseInt(parts[2], 10), [...walk.touched].map(({ side, species, item, moves }) => ({
        side, species, item: item ?? '', lock: isChoiceItem(item ?? '') && moves.length > 0 ? moves[0] : null,
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
  /** Boundary turn -> the protocol's held items for the bodies the block before it touched (round 63, T115). */
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
      const proven = revealed?.item.source === 'revealed' || revealed?.item.source === 'manual';
      eligibility[side][speciesId] = proven ||
        corroborateChoiceItem(side, built.species, built.item, teams, observations, genNum) !== 'contradicted';
    }
  }
  return { trails: buildChoiceLockTrails(replayLog), eligibility, heldItems: buildProtocolHeldItems(replayLog) };
}
