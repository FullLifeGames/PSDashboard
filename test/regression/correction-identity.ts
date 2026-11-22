import type { Battle as SimBattle, Pokemon as SimPokemon } from '@pkmn/sim';

/**
 * Round 89 (#138, lane M): the observer of the protocol correction. `observed` wraps `correctActivesFromProtocol` (a spec mocks the
 * module and puts the wrapper in its place), and for every block whose slots the simulator already holds as the log's last entrants it
 * prints the board before and after the correction. The correction may add (a start the board lacked, T212) and must change nothing
 * else: a lost volatile, a reset move or a moved body is a difference. The held item is not read: `applyProtocolHeldItems` is its own
 * correction (T133) and the protocol-proven lock stamp (spec 1b) move it or the move flags on any block, and a block that enters each slot once is outside what
 * the pass-through of a slot changes (`passing`: a slot with two entry lines). A body that is off the field after the correction (the one the block shows fainted on
 * arrival) is read for its volatiles and boosts only: its entry rewrites the move flags, the active flag and the place on the bench, which
 * the simulator's own switch-in rewrites again, and no turn reads them before then.
 */

export interface Observation {
  game: string;
  turn: number;
  /** The simulator's actives were the log's last entrants of every slot the block enters (the blocks the correction has nothing to move on). */
  matched: boolean;
  /** Blocks with two entry lines on one slot (the passing repoint) among the observed. */
  passing: boolean;
  differences: string[];
}

export const observations: Observation[] = [];
export const context = { game: '' };

const ENTRY = /^\|(?:switch|drag)\|(p[12])([a-d]): ?([^|]*)\|/;

function bodyPrint(body: SimPokemon) {
  return {
    species: body.species.name, active: body.isActive, position: body.position, fainted: body.fainted, hp: body.hp, status: body.status,
    ability: body.ability, boosts: { ...body.boosts }, lastMove: body.lastMove?.id ?? null, transformed: !!body.transformed,
    moveIds: body.moveSlots.map(slot => slot.id), disabled: body.moveSlots.map(slot => slot.disabled), pp: body.moveSlots.map(slot => slot.pp),
  };
}

function printOf(battle: SimBattle) {
  return battle.sides.map(side => ({
    order: side.pokemon.map(body => body.name),
    active: side.active.map(body => body?.name ?? null),
    bodies: Object.fromEntries(side.pokemon.map(body => [body.name, { ...bodyPrint(body), volatiles: Object.keys(body.volatiles).sort() }])),
  }));
}

/** What the correction changed between two prints, except a volatile it added. */
export function differencesOf(before: ReturnType<typeof printOf>, after: ReturnType<typeof printOf>): string[] {
  const out: string[] = [];
  before.forEach((side, index) => {
    const now = after[index];
    // The bench's order is the simulator's own bookkeeping: bodies the block passes through swap places on the way (U-turn, a drag, a faint), and the position fields follow the array.
    if (JSON.stringify(side.order.slice(0, side.active.length)) !== JSON.stringify(now.order.slice(0, now.active.length))) out.push(`p${index + 1} team order of the field`);
    if (JSON.stringify(side.active) !== JSON.stringify(now.active)) out.push(`p${index + 1} actives`);
    for (const [name, was] of Object.entries(side.bodies)) {
      const is = now.bodies[name];
      const { volatiles: wasVolatiles, ...wasRest } = was;
      const { volatiles: isVolatiles, ...isRest } = is;
      const onField = now.active.includes(name) && !is.fainted;
      for (const key of Object.keys(wasRest) as (keyof typeof wasRest)[]) {
        if (!onField && ['disabled', 'lastMove', 'active', 'position'].includes(key)) continue;
        if (JSON.stringify(wasRest[key]) !== JSON.stringify(isRest[key])) out.push(`p${index + 1} ${name} ${key} ${JSON.stringify(wasRest[key])} -> ${JSON.stringify(isRest[key])}`);
      }
      for (const lost of wasVolatiles.filter(id => !isVolatiles.includes(id))) out.push(`p${index + 1} ${name} lost volatile ${lost}`);
    }
  });
  return out;
}

type Correct = (battle: SimBattle, events: string[], locks?: unknown, residualAt?: number) => void;

export function observed(original: Correct): Correct {
  return (battle, events, locks, residualAt) => {
    const entries = events.flatMap(line => { const match = ENTRY.exec(line.replace(/\r$/, '')); return match ? [{ line, side: match[1], slot: match[2], name: match[3] }] : []; });
    if (entries.length === 0) return original(battle, events, locks, residualAt);
    const last = new Map(entries.map(entry => [`${entry.side}${entry.slot}`, entry]));
    const matched = [...last.values()].every(entry => battle.sides[entry.side === 'p1' ? 0 : 1].active['abcd'.indexOf(entry.slot)]?.name === entry.name);
    const passing = last.size < entries.length;
    const before = matched ? printOf(battle) : null;
    original(battle, events, locks, residualAt);
    observations.push({ game: context.game, turn: battle.turn, matched, passing, differences: before ? differencesOf(before, printOf(battle)) : [] });
  };
}
