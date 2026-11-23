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

/**
 * The sure strike, a candidate the forced-win prover tries first: a move that knocks out the foe's last standing body in every roll and
 * moves before every damaging move the foe can click ends the game before the foe acts (only a stalling move can reply, which the delay
 * rule reads). Three reads, none from a list of moves:
 * - the kill: the damage calculator's odds (`boundaryEvent`, 16 rolls with the crit) say every roll knocks the body out;
 * - the order: the simulator's queue on a copy (`queuePlace`: the Dex priority after every modifier, then the action speed under Trick
 *   Room, Tailwind and paralysis), the foe's moves read with every chance answering yes (a Quick Claw that may fire counts against the
 *   strike) and the own move with every chance answering no; an equal place is a speed tie the queue shuffles, so no strike;
 * - the rules: the strike turn is played on copies against each damaging foe move on the seeds a plain cell draws, and the game must
 *   end in the side's win with no foe move in the turn's log (Psychic Terrain, Dazzling and its kin, a Focus Sash: the calculator knows none).
 * Only the foe's last standing body counts: a second body keeps its moves, its redirection and its switch in play. Gens 1 and 2 have no
 * kill odds in the model (`boundaryEvent` returns null), so no strike is offered there.
 */

interface Part { id: string; target: number | null; plain: boolean }

/** The move parts of a choice (`move <id> [target]`, a gimmick suffix makes the part not plain); null when a part is no move. */
function parse(choice: string): Part[] | null {
  const parts = choice.split(',').map(text => text.trim().split(' '));
  if (parts.some(tokens => tokens[0] !== 'move' || !tokens[1])) return null;
  return parts.map(tokens => {
    const aimed = /^-?\d+$/.test(tokens[2] ?? '');
    return { id: tokens[1], target: aimed ? Number(tokens[2]) : null, plain: tokens.length === (aimed ? 3 : 2) };
  });
}

/** The ids of the damaging moves (a category other than Status) a reply clicks. */
const damaging = (battle: Battle, reply: ChoiceOption): string[] => (parse(reply.choice) ?? []).map(part => part.id).filter(id => battle.dex.moves.get(id).category !== 'Status');

const before = (own: QueuePlace, foe: QueuePlace): boolean => own.priority > foe.priority || (own.priority === foe.priority && own.speed > foe.speed);

/** A part's score for the order among strikes (the kill odds first, as `orderByOdds` scores a move). */
function partScore(battle: Battle, attacker: Pokemon, foeBody: Pokemon, id: string): number {
  const event = boundaryEvent(battle, attacker, foeBody, id);
  if (event) return 3 + event.pKill;
  const move = battle.dex.moves.get(id);
  return move.exists && move.basePower > 0 ? 2 + move.basePower / 1000 : 1;
}

/** What the strike rule reads from a position: the foe's last body, the side's standing bodies, the foe's replies and the places of its damaging moves. */
interface Board {
  battle: Battle;
  foeBody: Pokemon;
  bodies: Pokemon[];
  /** The foe's replies the strike turn is played against: the damaging ones; a foe with none is played against what it can click besides a stall. */
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

/**
 * Whether a part is a strike: a damaging move at the foe's body that kills in every roll (also under the foe's Tera click) and moves before
 * every damaging foe move.
 */
function isStrike(board: Board, slot: number, part: Part): boolean {
  const { battle, foeBody } = board;
  const attacker = board.bodies[slot];
  const move = battle.dex.moves.get(part.id);
  if (!attacker || !part.plain || !move.exists || move.category === 'Status' || (part.target !== null && part.target <= 0)) return false;
  // the queue first (a plain read for most moves), the calculator only for a part that moves before the foe
  const own = queuePlace(battle, attacker, part.id, false);
  if (!board.foePlaces.every(foe => before(own, foe))) return false;
  const clicks = [{}, ...(board.foeCanTera ? [{ defender: true }] : [])];
  return clicks.every(click => boundaryEvent(battle, attacker, foeBody, part.id, click)?.pKill === 1);
}

/** The strike turn on the seeds of a plain cell against each reply: the side wins and no foe move shows in the turn's log. */
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

/**
 * The strike among `pool`, the side's choices (the legal combinations in doubles, the search's list in singles; a function reads it
 * only where the foe has one body left), or null. Reads everything from copies of the position's battle: the live battle is unchanged.
 * Of several strikes the one whose parts score highest goes first, the pool's order breaking a tie; a strike part the simulator's
 * play refuses is not offered again beside another partner.
 */
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

/**
 * The Dex names the card gives a winning choice that is a strike (`ForcedWin.choiceNames`): the strike part that moves first (by the
 * simulator's queue) and the partner's move, from the battle's own Dex; undefined for a choice that is no strike of this position.
 */
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

/**
 * The strike of a position, read once per position object (the cache is the prover's own); the pool is the legal combinations in doubles
 * and the search's list in singles.
 */
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
