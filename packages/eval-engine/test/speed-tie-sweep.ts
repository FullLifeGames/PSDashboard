import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { fingerprint } from '../src/sim-ask';
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

export const RULE_SETS = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `gen ${gen}`, format: `gen${gen}customgame` })),
  { name: 'Champions', format: 'gen9championsou' },
];

/** The suite's cut: the generations with their own speed or priority code (1 to 5 carry the Gen 1 to 4 mods and the base rules) and the two newest rule sets; the probe lanes/B/tie-matrix.vt.ts runs all ten in all eight speed-layer modes. */
export const SUITE_RULE_SETS = RULE_SETS.filter(rules => ['gen 1', 'gen 2', 'gen 3', 'gen 4', 'gen 5', 'gen 9', 'Champions'].includes(rules.name));

const EQUAL: Scenario = { name: 'equal speed', holderLevel: 100, otherLevel: 100, full: true };

export interface TieSweep { holders: number; scenarios: number; asked: number; ties: number; wrong: string[] }

type SpeedTie = (battle: Battle, p1Choice: string, p2Choice: string) => boolean;

/** One holder on one side in one scenario: every move pair against the oracle, then the live battle's fingerprint. */
function sweepConfig(format: string, holder: Holder | null, side: 0 | 1, scenario: Scenario, reps: { holder: string[]; other: string[] }, speedTie: SpeedTie, result: TieSweep): void {
  const label = `${holder?.id ?? 'no holder'} on p${side + 1}, ${scenario.name}`;
  const battle: Battle = sweepBattle(format, holder, side, scenario);
  const before = fingerprint(battle);
  const tieOf = cheapOracle(battle, ...SLOT_A);
  // A holder that moves only the speed does not read the move: the few priority classes tell it apart.
  const holderMoves = scenario.full && !holder?.speedOnly ? reps.holder : reps.other;
  for (const own of holderMoves) {
    for (const foe of reps.other) {
      const [m1, m2] = side === 0 ? [own, foe] : [foe, own];
      const expected = tieOf(m1, m2);
      const ours = speedTie(battle, `move ${m1}`, `move ${m2}`);
      result.asked++;
      if (expected) result.ties++;
      if (ours !== expected && result.wrong.length < 12) result.wrong.push(`${label}, ${m1} against ${m2}: simulator ${expected}, speedTie ${ours}`);
    }
  }
  if (fingerprint(battle) !== before) result.wrong.push(`${label}: the live battle changed`);
}

/**
 * Every holder in every scenario on either side, every move pair: `speedTie` against the cheap oracle, and the live
 * battle's fingerprint after each configuration. The caller sets the speed-layer mode and the development check.
 */
export function tieSweep(format: string, speedTie: SpeedTie): TieSweep {
  const probe = sweepBattle(format, null, 0, EQUAL);
  const holders: (Holder | null)[] = [null, ...holdersOf(probe)];
  const reps = moveReps(probe);
  const scenarios = scenariosOf(probe);
  const result: TieSweep = { holders: holders.length, scenarios: scenarios.length, asked: 0, ties: 0, wrong: [] };
  for (const holder of holders) {
    for (const scenario of scenarios) {
      // Holders that only change the speed run in the equal-speed cases; the others run every scenario.
      if (holder?.speedOnly && !scenario.full) continue;
      for (const side of [0, 1] as const) sweepConfig(format, holder, side, scenario, reps, speedTie, result);
    }
  }
  return result;
}

export { cheapOracle, SLOT_A };
