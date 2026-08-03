import type { PokemonSet } from '@pkmn/sim';
import type {
  OpponentTeamInfo, PokemonEvs, PokemonFieldInfo, PokemonMoveInfo, RevealedPokemonInfo,
} from '../types';

/**
 * Display overlay for posted open team sheets: knowledge the engine already
 * uses (via buildTeamsFromReplay) surfaced into the stats panel with its own
 * 'sheet' provenance. Sim-free — type-only @pkmn/sim import, main-bundle
 * safe (the sheet extraction itself lives in the lazily-loaded team-builder).
 */

const SHEET_DETAIL = 'from the team sheet posted in the replay chat';

const toId = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Proven or user-stated knowledge always beats the sheet. */
const locked = (source: string): boolean => source === 'revealed' || source === 'manual';

function sheetMatchFor(info: RevealedPokemonInfo, sheet: PokemonSet[]): PokemonSet | undefined {
  const infoId = toId(info.species);
  return sheet.find(candidate => {
    const candidateId = toId(candidate.species);
    return candidateId === infoId ||
      toId(candidate.name || '') === infoId ||
      candidateId === toId(info.species.split('-')[0]) ||
      infoId === toId(candidate.species.split('-')[0]);
  });
}

const hasNonZeroEvs = (evs: PokemonSet['evs'] | undefined): boolean =>
  !!evs && Object.values(evs).some(value => (value ?? 0) > 0);

/**
 * Fills fields the protocol never proved from the posted team sheet.
 * Usage guesses are replaced — the sheet is authoritative for its side.
 */
export function applyTeamSheetToInfo(info: OpponentTeamInfo, sheet: PokemonSet[] | null): OpponentTeamInfo {
  if (!sheet || sheet.length === 0) return info;
  return {
    ...info,
    pokemon: info.pokemon.map(pokemon => {
      const match = sheetMatchFor(pokemon, sheet);
      if (!match) return pokemon;

      // The "(has item)" team-preview marker is revealed-source but names no
      // item — a sheet's concrete name always beats the placeholder.
      const field = (current: PokemonFieldInfo, value: string | undefined): PokemonFieldInfo =>
        (locked(current.source) && current.value !== '(has item)') || !value
          ? current
          : { value, source: 'sheet', sourceDetail: SHEET_DETAIL };

      const knownMoves = pokemon.moves.filter(move => locked(move.source));
      const knownIds = new Set(knownMoves.map(move => toId(move.name)));
      const sheetMoves: PokemonMoveInfo[] = match.moves
        .filter(name => !knownIds.has(toId(name)))
        .map(name => ({ name, source: 'sheet', sourceDetail: SHEET_DETAIL }));

      const evs = !locked(pokemon.evs.source) && hasNonZeroEvs(match.evs)
        ? { value: { ...match.evs } as PokemonEvs, source: 'sheet' as const, sourceDetail: SHEET_DETAIL }
        : pokemon.evs;

      return {
        ...pokemon,
        item: field(pokemon.item, match.item),
        ability: field(pokemon.ability, match.ability),
        teraType: field(pokemon.teraType, match.teraType),
        evs,
        moves: [...knownMoves, ...sheetMoves],
      };
    }),
  };
}
