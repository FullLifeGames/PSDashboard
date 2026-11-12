import type { PokemonSet } from '@pkmn/sim';
import type { BranchSimState, BranchSlotChoice } from '@fulllifegames/eval-engine';
import { loadSimMods, startGameLog } from '@fulllifegames/eval-engine';
import { newGameRecord, type NewGameRecord } from '../../../src/lib/new-game/record';

/** Round 89 (lane H, #105): a new game for the hook specs: six bodies that exist in every generation, a started record, default picks. */
export const SIX: PokemonSet[] = ['Garchomp', 'Gengar', 'Dragonite', 'Tyranitar', 'Snorlax', 'Starmie'].map(species => ({
  name: species, species, item: '', ability: '', moves: ['Earthquake', 'Protect', 'Return', 'Substitute'], nature: '', gender: '',
  evs: { hp: 4, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
}));

export async function startedRecord(format: string, team: PokemonSet[] = SIX): Promise<NewGameRecord> {
  await loadSimMods(format);
  const start = await startGameLog({ format, p1Team: team, p2Team: team, playerNames: ['Alice', 'Bob'], seed: '7,8,9,10' });
  return newGameRecord({ start, formatName: format, players: ['Alice', 'Bob'], seed: '7,8,9,10', now: new Date('2026-11-12T10:00:00Z') });
}

type Side = 'p1' | 'p2';
const id = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The default picks of a side at a request: its replacements, else the first usable move of each live slot (`rotate` varies the move). */
export function picks(state: BranchSimState, side: Side, rotate = 0): (BranchSlotChoice | null)[] {
  const forced = state[`${side}ForceSwitches`];
  const taken = new Set<string>();
  return state[`${side}ActiveSlots`].map((active, slot) => {
    if (forced.some(Boolean)) {
      const next = forced[slot] ? state[`${side}SwitchesBySlot`][slot].find(option => !option.fainted && !taken.has(option.name)) : undefined;
      if (!next) return null;
      taken.add(next.name);
      return { kind: 'switch', speciesId: id(next.species), pokemonName: next.name };
    }
    if (!active || active.fainted) return null;
    const usable = state[`${side}MovesBySlot`][slot].filter(option => !option.disabled);
    const move = usable[rotate % usable.length];
    if (!move) return null;
    const target = move.requiresTarget ? move.targetOptions.find(option => option.side !== side)?.targetLoc : undefined;
    return { kind: 'move', moveId: id(move.name), moveName: move.name, ...(target !== undefined ? { targetLoc: target } : {}) };
  });
}
