/** Choice locks from the replay text (the active correction deletes `choicelock`); nothing here reads sim history. */

import { calculate, Move, type Pokemon } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { type DamageObservation, type OpponentTeamInfo, typedHiddenPowerId, inferOpponentTeam, itemSetValue, replayRuleset, toId, calcGenerationFor, dexOf, dexOfCalc, choiceItems, type RulesDex, type CalcGeneration, abilityStateAtHit, fieldOf, historyPower, poweredMove } from '@fulllifegames/replay-core';
import { attackerAtUse, calcPokemon, type CalcBody } from './calc/body.ts';
import { defenderAbilities, defenderItems, formeAbility, isBodyOf, pricedSpecies, type DefenderRead } from './choice-lock-defender.ts';
import { calcMove } from './calc/move.ts';
import { normalizeLineEndings } from './line-endings.ts';

/** `handedOver`: the Choice item came by a move, so the protocol itself shows it (no set guess to vet). */
export interface ProtocolLock { species: string; moveId: string; handedOver?: boolean }
interface TrailState { species: string; moves: string[]; itemDisturbed: boolean; handedItem?: string }
export type ChoiceLockTrails = Record<'p1' | 'p2', Map<number, TrailState | null>>;

const bodyKey = (ident: string | undefined) => (ident ?? '').replace(/^(p[12])[a-d]?: /, '$1: ');
const MOVE_ENDS = new Set(['switch', 'drag', 'replace', '', 'upkeep', 'turn']);

// A move always hands items over (Fling writes [from]move:); an ability does inside the receiver's move (Magician) or
// right after the giver's silent -enditem (Pickpocket). Frisk writes at the frisker's entry, so it never counts.
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

const isChoiceItem = (dex: RulesDex, itemId: string) => !!itemId && dex.items.get(itemId).isChoice === true;

// A hand-over restarts the trail (a sim Choice item drops its old lock on arrival); a reveal leaves it.
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

/** The state at each |turn|N marker is the trail for turn N's position. */
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

/** Locked: one committed move with the item untouched; after a hand-over, a Choice item and one move since. */
export function protocolChoiceLock(
  trails: ChoiceLockTrails, side: 'p1' | 'p2', turn: number, dex: RulesDex,
): ProtocolLock | null {
  const state = trails[side].get(turn);
  if (!state || state.itemDisturbed || state.moves.length !== 1) return null;
  if (state.handedItem === undefined) return { species: state.species, moveId: state.moves[0] };
  if (!isChoiceItem(dex, state.handedItem)) return null;
  return { species: state.species, moveId: state.moves[0], handedOver: true };
}

export interface ProtocolHeldItem {
  side: 'p1' | 'p2';
  species: string;
  /** The item id the protocol shows ('' = nothing); null before any item line on the body. */
  item: string | null;
  firstMove: string | null;
  touched: boolean;
}
interface HeldState { side: 'p1' | 'p2'; species: string; item: string | null; moves: string[] }
interface SlotEntry { key: string; item: string | null; moves: string[]; touched: boolean }
type HeldWalk = { bodies: Map<string, HeldState>; touched: Set<HeldState>; slots: Map<string, SlotEntry> };

const heldBody = (walk: HeldWalk, ident: string | undefined) => walk.bodies.get(bodyKey(ident));

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

// An Illusion breaks: the lines since the slot's last entry were the Zoroark's, written under the imitated body's name.
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

// A hand-over restarts the body's moves; the [of] body gives the item up (Covet, Bestow, Magician write no line).
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

/** Per boundary turn: each body shown so far in order of entry, its item, and whether the block before changed it. */
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

// Copy of replay-core's OBSERVATION_SLACK (team/item-damage-shared.ts), held equal by test/regression/copies.spec.ts.
const OBSERVATION_SLACK = 0.02;

const TYPE_BOOST_ITEMS: Record<string, string> = {
  Water: 'Mystic Water', Fire: 'Charcoal', Electric: 'Magnet', Grass: 'Miracle Seed',
  Ice: 'Never-Melt Ice', Fighting: 'Black Belt', Poison: 'Poison Barb', Ground: 'Soft Sand',
  Flying: 'Sharp Beak', Psychic: 'Twisted Spoon', Bug: 'Silver Powder', Rock: 'Hard Stone',
  Ghost: 'Spell Tag', Dragon: 'Dragon Fang', Dark: 'Black Glasses', Steel: 'Metal Coat',
  Normal: 'Silk Scarf',
};

// A guessed Choice item must survive a damage check: corroborated, contradicted or ambiguous.
type CalcGen = CalcGeneration;

const stagesOf = (boosts: Record<string, number>): CalcBody['boosts'] => ({ atk: boosts.atk ?? 0, def: boosts.def ?? 0, spa: boosts.spa ?? 0, spd: boosts.spd ?? 0, spe: boosts.spe ?? 0 });

// Below the maximum whenever the fraction is: Multiscale reads full HP exactly.
const atHp = (body: Pokemon, fraction = 1): Pokemon => Object.assign(body, fraction < 1 ? { originalCurHP: Math.max(1, Math.min(body.maxHP() - 1, Math.round(fraction * body.maxHP()))) } : {});

// The item stays the hypothesis under test; the rest is what the observation shows at the hit, as the solver reads it.
function calcAttacker(gen: CalcGen, attackerSet: PokemonSet, obs: DamageObservation, withItem: string, moveId: string, mod?: string): Pokemon {
  const species = pricedSpecies(attackerSet, obs.attackerSpecies);
  const ability = formeAbility(gen, species, attackerSet.ability || '');
  return atHp(calcPokemon(gen, attackerAtUse(dexOfCalc(gen), {
    species, level: attackerSet.level || 100, ability, item: withItem, nature: attackerSet.nature, evs: attackerSet.evs, ivs: attackerSet.ivs, gender: attackerSet.gender,
    boosts: stagesOf(obs.attackerBoosts), status: obs.attackerStatus, tera: obs.attackerTera ?? null, onField: true, mod,
    boostedStat: obs.attackerParadox?.stat, alliesFainted: obs.attackerFallen, totalFainted: obs.attackerFainted,
    abilityOn: abilityStateAtHit(ability, { defenderNewlyIn: obs.defenderNewlyIn, lastToMove: obs.lastToMove }).on,
  }, moveId)), obs.attackerHp);
}

function calcDefender(gen: CalcGen, defenderSet: PokemonSet | undefined, obs: DamageObservation, ability: string, item: string, mod?: string): Pokemon {
  return atHp(calcPokemon(gen, {
    species: pricedSpecies(defenderSet, obs.defenderSpecies), level: defenderSet?.level || 100, ability, item, nature: defenderSet?.nature ?? '',
    evs: defenderSet?.evs ?? {}, ivs: defenderSet?.ivs ?? {}, gender: defenderSet?.gender, boosts: stagesOf(obs.defenderBoosts), tera: obs.defenderTera ?? null,
    onField: true, mod, boostedStat: obs.defenderParadox?.stat, status: obs.defenderStatus,
  }), obs.defenderHp);
}

const itemsAtHit = (gen: CalcGen, items: string[], obs: DamageObservation): string[] =>
  (obs.defenderItem || obs.defenderItemChanged ? [obs.defenderItem ? dexOfCalc(gen).items.get(obs.defenderItem).name : ''] : items);

function explainsObservation(
  gen: CalcGen, attackerSet: PokemonSet, defender: DefenderRead, obs: DamageObservation,
  calcMoveId: string, withItem: string, mod?: string,
): boolean | null {
  const reads = defender.abilities.flatMap(ability => defender.items.map(item =>
    explainsWith(gen, attackerSet, () => calcDefender(gen, defender.set, obs, ability, item, mod), obs, calcMoveId, withItem, mod)));
  if (reads.some(read => read === true)) return true;
  return reads.every(read => read === null) ? null : false;
}

function explainsWith(
  gen: CalcGen, attackerSet: PokemonSet, buildDefender: () => Pokemon, obs: DamageObservation,
  calcMoveId: string, withItem: string, mod?: string,
): boolean | null {
  try {
    const attacker = calcAttacker(gen, attackerSet, obs, withItem, calcMoveId, mod);
    const defender = buildDefender();
    const basePower = historyPower(dexOfCalc(gen), calcMoveId, { fainted: obs.attackerFainted ?? 0, timesAttacked: obs.attackerTimesAttacked ?? 0 });
    const result = calculate(gen, attacker, defender, calcMove(gen, calcMoveId, { mod, totalFainted: obs.attackerFainted } as CalcBody, basePower === null ? {} : { overrides: { basePower } }), fieldOf(obs));
    const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
    const maxHp = defender.maxHP();
    if (rolls.length === 0 || maxHp <= 0) return null;
    const min = Math.min(...rolls) / maxHp - OBSERVATION_SLACK;
    const max = Math.max(...rolls) / maxHp + OBSERVATION_SLACK;
    // A knock-out line only says "at least the remainder": the hypothesis must reach the fraction, not land on it.
    if (obs.lethal) return obs.observedFraction <= max;
    return obs.observedFraction >= min && obs.observedFraction <= max;
  } catch {
    return null;
  }
}

function rivalItemsFor(gen: CalcGen, calcMoveId: string): string[] {
  const moveType = (() => {
    try { return new Move(gen, calcMoveId).type; } catch { return undefined; }
  })();
  const bluff = moveType ? TYPE_BOOST_ITEMS[moveType] : undefined;
  return ['', ...(bluff ? [bluff] : [])];
}

function judgeObservation(
  gen: CalcGen, attackerSet: PokemonSet, defender: DefenderRead, obs: DamageObservation, item: string, mod?: string,
): 'contradicted' | 'choice-only' | 'skip' {
  // A typeless "hiddenpower" calcs as the set's resolved variant: the IV-default type would judge with wrong rolls.
  const calcMoveId = obs.moveId === 'hiddenpower' ? typedHiddenPowerId(attackerSet.moves) ?? obs.moveId : obs.moveId;
  const explains = (withItem: string) => explainsObservation(gen, attackerSet, defender, obs, calcMoveId, withItem, mod);
  const rivals = rivalItemsFor(gen, calcMoveId);
  const choiceFits = explains(item);
  if (choiceFits === null) return 'skip';
  const rivalFits = rivals.map(explains).some(fit => fit === true);
  if (!choiceFits) {
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
  /** 'champions' when the sets hold Stat Points. */
  mod?: string,
  defenders?: Record<'p1' | 'p2', OpponentTeamInfo>,
): ItemCorroboration {
  const gen = calcGenerationFor(genNum, mod);
  const speciesId = toId(species);
  const attackerSet = (side === 'p1' ? teams.p1Team : teams.p2Team)
    .find(candidate => toId(candidate.species) === speciesId);
  if (!attackerSet) return 'ambiguous';
  let sawChoiceOnly = false;
  for (const obs of observations) {
    if (obs.attackerSide !== side || !isBodyOf(gen, obs.attackerSpecies, species)) continue;
    // Doubles hits (spread cut, screens, partners) and Z or Max moves (placeholder power) price wrong here.
    if (obs.doubles || poweredMove(dexOfCalc(gen), obs.moveId)) continue;
    const defenderTeam = side === 'p1' ? teams.p2Team : teams.p1Team;
    const defenderSet = defenderTeam.find(candidate => isBodyOf(gen, obs.defenderSpecies, candidate.species));
    const info = defenders?.[side === 'p1' ? 'p2' : 'p1'];
    const defender = { set: defenderSet, abilities: defenderAbilities(gen, defenderSet, obs, info), items: itemsAtHit(gen, defenderItems(defenderSet, obs, info), obs) };
    const verdict = judgeObservation(gen, attackerSet, defender, obs, item, mod);
    if (verdict === 'contradicted') return 'contradicted';
    if (verdict === 'choice-only') sawChoiceOnly = true;
  }
  return sawChoiceOnly ? 'corroborated' : 'ambiguous';
}

export interface ChoiceLockContext {
  trails: ChoiceLockTrails;
  /** speciesId -> may this mon's (choice) item justify a lock stamp? */
  eligibility: Record<'p1' | 'p2', Record<string, boolean>>;
  heldItems: Map<number, ProtocolHeldItem[]>;
}

export function buildChoiceLockContext(
  rawLog: string,
  teams: { p1Team: PokemonSet[]; p2Team: PokemonSet[] },
  observations: DamageObservation[],
): ChoiceLockContext {
  const replayLog = normalizeLineEndings(rawLog);
  const genNum = parseInt(replayLog.match(/^\|gen\|(\d)/m)?.[1] ?? '9', 10);
  const mod = replayRuleset({ log: replayLog }) === 'champions' ? 'champions' : undefined;
  const eligibility: ChoiceLockContext['eligibility'] = { p1: {}, p2: {} };
  const infos = { p1: inferOpponentTeam(replayLog, 'p1'), p2: inferOpponentTeam(replayLog, 'p2') };
  for (const side of ['p1', 'p2'] as const) {
    const info = infos[side];
    const team = side === 'p1' ? teams.p1Team : teams.p2Team;
    for (const built of team) {
      const speciesId = toId(built.species);
      if (!choiceItems(dexOf({ gen: genNum, mod })).has(toId(built.item ?? ''))) continue;
      const revealed = info.pokemon.find(mon => toId(mon.species) === speciesId);
      // The team preview's "(has item)" is revealed-source but names no item.
      const proven = (revealed?.item.source === 'revealed' || revealed?.item.source === 'manual') &&
        toId(itemSetValue(revealed.item.value)) === toId(built.item);
      eligibility[side][speciesId] = proven ||
        corroborateChoiceItem(side, built.species, built.item, teams, observations, genNum, mod, infos) !== 'contradicted';
    }
  }
  return { trails: buildChoiceLockTrails(replayLog), eligibility, heldItems: buildProtocolHeldItems(replayLog) };
}
