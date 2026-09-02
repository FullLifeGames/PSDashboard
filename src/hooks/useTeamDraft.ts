import { useEffect, useState } from 'react';
import {
  type OpponentTeamInfo, type PokemonEvs, type RevealedPokemonInfo, type StatId, EMPTY_EVS, manualEvs,
  manualField,
} from '@fulllifegames/replay-core';
import { canonicalMove, clampEv, withAddedMove, type EditorPools } from '../lib/team-editor';

/** Legal pools load lazily — the editor stays usable as free text until then. */
export function useEditorPools(teamInfo: OpponentTeamInfo, gen: number): EditorPools | null {
  const [pools, setPools] = useState<EditorPools | null>(null);
  const { pokemon: teamPokemon } = teamInfo;
  useEffect(() => {
    let active = true;
    void (async () => {
      const options = await import('../lib/pokemon-options');
      const movesBySpecies: Record<string, string[]> = {};
      const abilitiesBySpecies: Record<string, string[]> = {};
      await Promise.all(teamPokemon.map(async entry => {
        movesBySpecies[entry.species] = await options.getMovePool(entry.species, gen);
        abilitiesBySpecies[entry.species] = options.getAbilityPool(entry.species, gen);
      }));
      if (!active) return;
      setPools({
        items: options.getItemPool(gen),
        teraTypes: options.getTeraTypePool(gen),
        natures: options.NATURES,
        movesBySpecies,
        abilitiesBySpecies,
      });
    })();
    return () => {
      active = false;
    };
  }, [teamPokemon, gen]);
  return pools;
}

export type EditableField = 'ability' | 'item' | 'teraType' | 'nature';

/** The editable team plus its per-Pokémon validation state and the edit handlers. */
export function useTeamDraft(initial: RevealedPokemonInfo[], pools: EditorPools | null) {
  const [pokemon, setPokemon] = useState<RevealedPokemonInfo[]>(initial);
  const [moveError, setMoveError] = useState<Record<number, string | null>>({});
  const [itemWarning, setItemWarning] = useState<Record<number, string | null>>({});
  const [moveDraft, setMoveDraft] = useState<Record<number, string>>({});

  const updateField = (index: number, field: EditableField, value: string) => {
    setPokemon(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: manualField(value) };
      return updated;
    });
  };

  const updateEv = (index: number, stat: StatId, value: string) => {
    setPokemon(prev => {
      const updated = [...prev];
      const current = updated[index].evs?.value ?? EMPTY_EVS;
      const nextEvs: PokemonEvs = {
        ...current,
        [stat]: clampEv(value),
      };
      updated[index] = { ...updated[index], evs: manualEvs(nextEvs) };
      return updated;
    });
  };

  const addMove = (index: number, move: string): boolean => {
    const trimmed = move.trim();
    if (!trimmed) return false;

    const species = pokemon[index]?.species ?? '';
    const resolved = canonicalMove(pools?.movesBySpecies[species], trimmed);
    if ('illegal' in resolved) {
      setMoveError(prev => ({ ...prev, [index]: `${trimmed} is not in ${species}'s legal moves for this generation.` }));
      return false;
    }

    setMoveError(prev => ({ ...prev, [index]: null }));
    setPokemon(prev => withAddedMove(prev, index, resolved.canonical));
    return true;
  };

  const removeMove = (pokemonIndex: number, moveIndex: number) => {
    setPokemon(prev => {
      const updated = [...prev];
      updated[pokemonIndex] = {
        ...updated[pokemonIndex],
        moves: updated[pokemonIndex].moves.filter((_, i) => i !== moveIndex),
      };
      return updated;
    });
  };

  return { pokemon, moveError, itemWarning, moveDraft, setItemWarning, setMoveDraft, updateField, updateEv, addMove, removeMove };
}

export type TeamDraft = ReturnType<typeof useTeamDraft>;
