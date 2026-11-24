import type { Battle, Pokemon } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import { advancePositionWithLog, legalChoices, positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { isCombined } from '../search/hints.ts';
import { boundaryEvent } from '../ko-odds.ts';
import { cellSeeds } from '../search/root-quantile.ts';
import { queuePlace, type QueuePlace } from '../sim-ask/action-order.ts';
import type { TeraAllowance } from '../types.ts';
import { plainDrawCount } from './children.ts';
import { other, wonBy, type Side } from './prover-order.ts';

// The sure strike: a move that kills the foe's last body in every roll and moves before every damaging foe move.
// Three reads, no move list: the calculator's kill odds, the simulator's queue on a copy, the turn played on copies.

interface Part { id: string; target: number | null; plain: boolean }

function parse(choice: string): Part[] | null {
  const parts = choice.split(',').map(text => text.trim().split(' '));
  if (parts.some(tokens => tokens[0] !== 'move' || !tokens[1])) return null;
  return parts.map(tokens => {
    const aimed = /^-?\d+$/.test(tokens[2] ?? '');
    return { id: tokens[1], target: aimed ? Number(tokens[2]) : null, plain: tokens.length === (aimed ? 3 : 2) };
  });
}

const damaging = (battle: Battle, reply: ChoiceOption): string[] => (parse(reply.choice) ?? []).map(part => part.id).filter(id => battle.dex.moves.get(id).category !== 'Status');

const before = (own: QueuePlace, foe: QueuePlace): boolean => own.priority > foe.priority || (own.priority === foe.priority && own.speed > foe.speed);

function partScore(battle: Battle, attacker: Pokemon, foeBody: Pokemon, id: string): number {
  const event = boundaryEvent(battle, attacker, foeBody, id);
  if (event) return 3 + event.pKill;
  const move = battle.dex.moves.get(id);
  return move.exists && move.basePower > 0 ? 2 + move.basePower / 1000 : 1;
}

interface Board {
  battle: Battle;
  foeBody: Pokemon;
  bodies: Pokemon[];
  /** The foe replies the strike turn is played against: the damaging ones; with none, all it can click but a stall. */
  against: ChoiceOption[];
  foePlaces: QueuePlace[];
  foeCanTera: boolean;
}

function boardOf(position: SimPosition, side: Side, tera: TeraAllowance | undefined): Board | null {
  const battle = positionBattle(position);
  if (battle.ended) return null;
  const foeSide = battle.sides[sideIndex(other(side))];
  const standing = foeSide.pokemon.filter(mon => !mon.fainted);
  if (standing.length !== 1 || !foeSide.active.includes(standing[0])) return null;
  const foeBody = standing[0];
  const replies = legalChoices(position, other(side), { tera });
  const hurting = replies.filter(reply => damaging(battle, reply).length > 0);
  const against = hurting.length > 0 ? hurting : replies.filter(reply => !(parse(reply.choice) ?? []).some(part => battle.dex.moves.get(part.id).stallingMove));
  return {
    battle, foeBody, against,
    bodies: battle.sides[sideIndex(side)].active.filter((mon): mon is Pokemon => !!mon && !mon.fainted),
    foePlaces: [...new Set(replies.flatMap(reply => damaging(battle, reply)))].map(id => queuePlace(battle, foeBody, id, true)),
    foeCanTera: replies.some(reply => reply.choice.includes('terastallize')),
  };
}

// A strike kills in every roll, also under the foe's Tera click, and moves before every damaging foe move.
function isStrike(board: Board, slot: number, part: Part): boolean {
  const { battle, foeBody } = board;
  const attacker = board.bodies[slot];
  const move = battle.dex.moves.get(part.id);
  if (!attacker || !part.plain || !move.exists || move.category === 'Status' || (part.target !== null && part.target <= 0)) return false;
  const own = queuePlace(battle, attacker, part.id, false);
  if (!board.foePlaces.every(foe => before(own, foe))) return false;
  const clicks = [{}, ...(board.foeCanTera ? [{ defender: true }] : [])];
  return clicks.every(click => boundaryEvent(battle, attacker, foeBody, part.id, click)?.pKill === 1);
}

function playsOut(position: SimPosition, side: Side, choice: string, replies: ChoiceOption[]): boolean {
  if (replies.length === 0) return false;
  const count = plainDrawCount(positionBattle(position));
  return replies.every(reply => {
    const [p1Choice, p2Choice] = side === 'p1' ? [choice, reply.choice] : [reply.choice, choice];
    return cellSeeds(position, p1Choice, p2Choice).slice(0, count).every(seed => {
      const { child, log } = advancePositionWithLog(position, p1Choice, p2Choice, seed);
      return wonBy(positionBattle(child), side) && !log.some(line => line.startsWith(`|move|${other(side)}`));
    });
  });
}

/** The strike among `pool`, or null; reads copies only, the live battle is unchanged; the best-scoring strike first. */
export function sureStrike(position: SimPosition, side: Side, pool: ChoiceOption[] | (() => ChoiceOption[]), tera: TeraAllowance | undefined): ChoiceOption | null {
  const board = boardOf(position, side, tera);
  if (!board) return null;
  const options = typeof pool === 'function' ? pool() : pool;
  const struck = new Map<string, boolean>();
  const strikes = (parts: Part[]): string[] => parts.flatMap((part, slot) => {
    const key = `${slot}|${part.id}|${part.target}`;
    if (!struck.has(key)) struck.set(key, isStrike(board, slot, part));
    return struck.get(key) ? [key] : [];
  });
  const ranked = options.flatMap(option => {
    const parts = parse(option.choice);
    if (!parts || parts.length !== board.bodies.length || strikes(parts).length === 0) return [];
    return [{ option, parts, score: parts.reduce((sum, part, slot) => sum + partScore(board.battle, board.bodies[slot], board.foeBody, part.id), 0) }];
  }).sort((a, b) => b.score - a.score);
  const refused = new Set<string>();
  for (const { option, parts } of ranked) {
    const keys = strikes(parts);
    if (keys.some(key => refused.has(key))) continue;
    if (playsOut(position, side, option.choice, board.against)) return option;
    keys.forEach(key => refused.add(key));
  }
  return null;
}

/** The Dex names the card gives a strike: the part that moves first and the partner's move; undefined when none. */
export function strikeNames(position: SimPosition, side: Side, choice: string, tera: TeraAllowance | undefined): { first: string; partner?: string } | undefined {
  const board = boardOf(position, side, tera);
  const parts = parse(choice);
  if (!board || !parts) return undefined;
  const slots = parts.flatMap((part, slot) => (isStrike(board, slot, part) ? [slot] : []));
  const place = (slot: number): QueuePlace => queuePlace(board.battle, board.bodies[slot], parts[slot].id, false);
  const first = slots.reduce<number | null>((best, slot) => (best === null || before(place(slot), place(best)) ? slot : best), null);
  if (first === null) return undefined;
  const nameOf = (part: Part): string => board.battle.dex.moves.get(part.id).name;
  const partner = parts.find((_, slot) => slot !== first);
  return { first: nameOf(parts[first]), ...(partner ? { partner: nameOf(partner) } : {}) };
}

/** The strike of a position, read once per position object (the cache is the prover's own). */
export function cachedStrike(cache: WeakMap<SimPosition, ChoiceOption | null>, position: SimPosition, side: Side, own: ChoiceOption[], tera: TeraAllowance | undefined): ChoiceOption | null {
  const known = cache.get(position);
  if (known !== undefined) return known;
  const strike = sureStrike(position, side, () => {
    const legal = legalChoices(position, side, { tera });
    return isCombined(legal) ? legal : own;
  }, tera);
  cache.set(position, strike);
  return strike;
}
