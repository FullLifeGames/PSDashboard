import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { cheapOracle, SLOT_A } from './speed-tie-oracle';

/**
 * Round 72 (T196a): the sweep behind speed-tie-sim.spec.ts. Every Dex entry of a generation (or the Champions mod) that
 * can move the queue's answer, as the holder on either side, against the moves of the Dex, in the speed situations that
 * tie or do not: the cheap oracle of speed-tie-oracle.ts is the simulator's answer, the code under test is held to it.
 * What counts as an entry that can move the answer comes from the Dex, not from a list of names: a handler for the
 * move's priority, for its fractional priority or for the speed (the stat itself is the Pokémon's own; its modifiers
 * are handlers). Quick Claw of Gens 2 and 3 has no handler (the battle rolls it at the turn's start) and joins by id.
 */

type Entry = { id: string; name: string; exists: boolean; gen: number; isNonstandard?: string | null } & Record<string, unknown>;
const KEYS = ['onModifyPriority', 'onFractionalPriority', 'onModifySpe'];
const SPEED_ONLY = new Set(['onModifySpe']);

export interface Holder { kind: 'ability' | 'item'; id: string; name: string; /** Moves the entry's speed only. */ speedOnly: boolean }

/** Entries of the battle's own Dex (the one that keeps handlers) that can move a priority or a speed. */
export function holdersOf(battle: Battle): Holder[] {
  const dex = battle.dex;
  const live = (entry: Entry) => entry.exists && entry.gen <= dex.gen && entry.isNonstandard !== 'Future';
  const read = (kind: 'ability' | 'item', entries: Iterable<Entry>): Holder[] => [...entries].filter(live).flatMap(entry => {
    const keys = KEYS.filter(key => typeof entry[key] === 'function' || typeof entry[key] === 'number');
    return keys.length ? [{ kind, id: entry.id, name: entry.name, speedOnly: keys.every(key => SPEED_ONLY.has(key)) }] : [];
  });
  const holders = [
    ...read('ability', dex.abilities.all() as unknown as Iterable<Entry>),
    ...read('item', dex.items.all() as unknown as Iterable<Entry>),
  ];
  const claw = dex.items.get('quickclaw') as unknown as Entry;
  if (live(claw) && !holders.some(holder => holder.id === claw.id)) holders.push({ kind: 'item', id: claw.id, name: claw.name, speedOnly: false });
  return holders;
}

interface MoveLike { id: string; exists: boolean; gen: number; isZ?: unknown; isMax?: unknown; priority: number; category: string; type: string; flags: Record<string, unknown>; isNonstandard?: string | null }

/** One move of every kind the handlers can tell apart: category, type, the heal flag, and the priority value. */
export function moveReps(battle: Battle): { holder: string[]; other: string[] } {
  const dex = battle.dex;
  const moves = (dex.moves.all() as unknown as MoveLike[]).filter(move => move.exists && move.gen <= dex.gen && !move.isZ && !move.isMax && move.isNonstandard !== 'Future');
  const first = (key: (move: MoveLike) => string) => {
    const seen = new Map<string, string>();
    for (const move of moves) if (!seen.has(key(move))) seen.set(key(move), move.id);
    return [...seen.values()];
  };
  const kinds = first(move => `${move.category}|${move.type}|${move.flags['heal'] ? 1 : 0}|${typeof (dex.moves.get(move.id) as unknown as Entry)['onModifyPriority']}`);
  const priorities = [...new Set(moves.map(move => move.priority))].sort((a, b) => a - b);
  const plain = (priority: number) => moves.find(move => move.priority === priority && move.category !== 'Status')?.id ?? moves.find(move => move.priority === priority)?.id as string;
  const other = [0, 1, priorities[0], priorities[priorities.length - 1]].filter((p, at, all) => all.indexOf(p) === at).map(plain);
  return { holder: [...new Set([...kinds, ...priorities.map(plain)])], other };
}

export interface Scenario { name: string; holderLevel: number; otherLevel: number; setup?: (battle: Battle, holder: 0 | 1) => void; full: boolean }

export function scenariosOf(battle: Battle): Scenario[] {
  const dex = battle.dex;
  const mon = (side: 0 | 1, battleOf: Battle) => battleOf.sides[side].active[0] as Pokemon;
  const scenarios: Scenario[] = [
    { name: 'equal speed', holderLevel: 100, otherLevel: 100, full: true },
    { name: 'holder faster', holderLevel: 100, otherLevel: 50, full: false },
    { name: 'holder slower', holderLevel: 50, otherLevel: 100, full: false },
    { name: 'holder at a fifth of its HP', holderLevel: 100, otherLevel: 100, full: false, setup: (b, holder) => { const m = mon(holder, b); m.hp = Math.max(1, Math.floor(m.maxhp / 5)); } },
    { name: 'foe paralyzed', holderLevel: 100, otherLevel: 100, full: false, setup: (b, holder) => { mon(holder === 0 ? 1 : 0, b).setStatus('par'); } },
  ];
  const inThisGen = (id: string) => dex.moves.get(id).exists && dex.moves.get(id).gen <= dex.gen;
  if (inThisGen('trickroom')) {
    scenarios.push({ name: 'Trick Room at equal speed', holderLevel: 100, otherLevel: 100, full: true, setup: b => { b.field.addPseudoWeather('trickroom', mon(0, b)); } });
    scenarios.push({ name: 'Trick Room, holder faster', holderLevel: 100, otherLevel: 50, full: false, setup: b => { b.field.addPseudoWeather('trickroom', mon(0, b)); } });
  }
  if (inThisGen('tailwind')) {
    scenarios.push({ name: 'Tailwind on the holder', holderLevel: 100, otherLevel: 100, full: false, setup: (b, holder) => { b.sides[holder].addSideCondition('tailwind', mon(holder, b)); } });
  }
  return scenarios;
}

/** A singles battle, the holder on one side, in a scenario. The other body has no entry. */
export function sweepBattle(format: string, holder: Holder | null, side: 0 | 1, scenario: Scenario): Battle {
  const body = (extra: Partial<PokemonSet>) => set('Snorlax', ['tackle'], { evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 252 }, ...extra });
  const held = body({
    level: scenario.holderLevel,
    ...(holder?.kind === 'ability' ? { ability: holder.name } : {}),
    ...(holder?.kind === 'item' ? { item: holder.name } : {}),
  });
  const other = body({ level: scenario.otherLevel });
  const battle = battleOf(format, side === 0 ? [held] : [other], side === 0 ? [other] : [held]);
  scenario.setup?.(battle, side);
  return battle;
}

export { cheapOracle, SLOT_A };
