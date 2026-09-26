import { readdirSync, readFileSync } from 'node:fs';
import type { Battle } from '@pkmn/sim';
import { configureSimFast, resetSimFastForTests, type SimFastLever } from '../src/forward/sim-fast/state';

/** A bank position under fixtures/positions (the four older files and the twelve of round 59). */
export interface FixturePosition {
  id: string;
  turn: number;
  format: string;
  gameType: 'singles' | 'doubles';
  serialized: string;
}

const DIR = new URL('./fixtures/positions/', import.meta.url);

export function loadPositions(): FixturePosition[] {
  return readdirSync(DIR).filter(name => name.endsWith('.json')).sort().map(name => {
    const raw = JSON.parse(readFileSync(new URL(name, DIR), 'utf-8')) as { id: string; turn: number; serialized: string };
    const state = JSON.parse(raw.serialized) as { formatid: string; gameType: 'singles' | 'doubles' };
    return { id: `${raw.id}#${raw.turn}`, turn: raw.turn, format: state.formatid, gameType: state.gameType, serialized: raw.serialized };
  });
}

/** The two seeds every identity comparison plays. */
export const SEEDS = ['1,2,3,4', '5,6,7,8'] as const;

/** A turn's protocol lines without the sim's wall-clock |t:| stamps (battle.mjs:2739), which differ between two runs of the same turn. */
export const stableLog = (log: readonly string[]): string => log.filter(line => !line.startsWith('|t:|')).join('\n');

/**
 * The own keys, in order, of the battle, its field, every side and every
 * Pokemon, a key holding undefined marked as such: a copy and today's fork
 * must agree on names, order and which keys are empty.
 */
export function ownKeyLists(battle: Battle): string[] {
  const list = (object: object) => Object.entries(object).map(([key, value]) => value === undefined ? `${key}=undefined` : key).join();
  return [list(battle), list(battle.field), ...battle.sides.flatMap(side => [list(side), ...side.pokemon.map(list)])];
}

/**
 * Runs with exactly these levers, then hands the switch back to the environment.
 * Forced when any lever is on: a break throws instead of silently taking the standard path.
 */
export function withSimFast<T>(levers: readonly SimFastLever[], run: () => T): T {
  configureSimFast(levers, { forced: levers.length > 0 });
  try {
    return run();
  } finally {
    resetSimFastForTests();
  }
}
