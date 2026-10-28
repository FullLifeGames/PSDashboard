import type {
  KnowledgeSource, OpponentTeamInfo, PokemonEvsInfo, PokemonFieldInfo, PokemonMoveInfo, RevealedPokemonInfo,
} from '@fulllifegames/replay-core';
import type { FormatKind } from './sim-state';

export const field = (value: string, source: KnowledgeSource = 'revealed', extra: Partial<PokemonFieldInfo> = {}): PokemonFieldInfo =>
  ({ value, source, ...extra });

export const unknownField = (): PokemonFieldInfo => ({ value: '', source: 'unknown' });

export const move = (name: string, source: PokemonMoveInfo['source'] = 'revealed', extra: Partial<PokemonMoveInfo> = {}): PokemonMoveInfo =>
  ({ name, source, ...extra });

export const evs = (source: KnowledgeSource = 'unknown', value = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }): PokemonEvsInfo =>
  ({ value, source });

const USAGE = 'Smogon gen9ou 2026-03';

/**
 * One team member the stats panel and the editor can show: a revealed move,
 * a usage guess with its share, a manual item, guessed ability and spread.
 */
export function revealedPokemon(species: string, overrides: Partial<RevealedPokemonInfo> = {}): RevealedPokemonInfo {
  return {
    species,
    moves: [
      move('Protect', 'revealed'),
      move('Earthquake', 'guessed', { probability: 0.72, sourceDetail: USAGE }),
    ],
    ability: field('Pressure', 'guessed', { probability: 0.9, sourceDetail: USAGE }),
    item: field('Leftovers', 'manual'),
    teraType: unknownField(),
    evs: evs('guessed', { hp: 252, atk: 0, def: 4, spa: 0, spd: 252, spe: 0 }),
    level: 100,
    gender: '',
    ...overrides,
  };
}

const SPECIES: Record<FormatKind, { p1: string[]; p2: string[] }> = {
  singles: {
    p1: ['Garchomp', 'Heatran', 'Latias', 'Clefable', 'Weavile', 'Toxapex'],
    p2: ['Ferrothorn', 'Rotom-Wash', 'Excadrill', 'Tornadus-Therian', 'Keldeo', 'Medicham'],
  },
  doubles: {
    p1: ['Incineroar', 'Amoonguss', 'Flutter Mane', 'Urshifu'],
    p2: ['Rillaboom', 'Tornadus', 'Kingambit', 'Ogerpon'],
  },
};

export function teamInfo(kind: FormatKind = 'singles', side: 'p1' | 'p2' = 'p1', overrides: Partial<OpponentTeamInfo> = {}): OpponentTeamInfo {
  return { pokemon: SPECIES[kind][side].map(species => revealedPokemon(species)), ...overrides };
}
