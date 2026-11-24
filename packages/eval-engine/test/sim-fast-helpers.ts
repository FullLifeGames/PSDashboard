import { readdirSync, readFileSync } from 'node:fs';
import type { Battle } from '@pkmn/sim';
import { configureSimFast, resetSimFastForTests, type SimFastLever } from '../src/forward/sim-fast/state';

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

export const SEEDS = ['1,2,3,4', '5,6,7,8'] as const;

/** A turn's protocol lines without the sim's wall-clock |t:| stamps (battle.mjs:2739). */
export const stableLog = (log: readonly string[]): string => log.filter(line => !line.startsWith('|t:|')).join('\n');

export function ownKeyLists(battle: Battle): string[] {
  const list = (object: object) => Object.entries(object).map(([key, value]) => value === undefined ? `${key}=undefined` : key).join();
  return [list(battle), list(battle.field), ...battle.sides.flatMap(side => [list(side), ...side.pokemon.map(list)])];
}

/** Runs with exactly these levers; a break throws instead of taking the standard path, then the switch goes back. */
export function withSimFast<T>(levers: readonly SimFastLever[], run: () => T): T {
  configureSimFast(levers, { forced: levers.length > 0 });
  try {
    return run();
  } finally {
    resetSimFastForTests();
  }
}
