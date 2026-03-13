import { useState } from 'react';
import type { OpponentTeamInfo, RevealedPokemonInfo } from '../types';

interface Props {
  opponentInfo: OpponentTeamInfo;
  onSave: (updatedInfo: OpponentTeamInfo) => void;
  onClose: () => void;
}

const DEFAULT_ABILITIES: Record<string, string> = {
  'Scizor': 'Technician',
  'Ting-Lu': 'Vessel of Ruin',
  'Ninetales-Alola': 'Snow Warning',
  'Amoonguss': 'Regenerator',
  'Thundurus-Therian': 'Volt Absorb',
  'Torkoal': 'Drought',
};

const DEFAULT_ITEMS: Record<string, string> = {
  'Scizor': 'Heavy-Duty Boots',
  'Ting-Lu': 'Leftovers',
  'Ninetales-Alola': 'Light Clay',
  'Amoonguss': 'Rocky Helmet',
  'Thundurus-Therian': 'Choice Specs',
  'Torkoal': 'Heat Rock',
};

export function OpponentEditor({ opponentInfo, onSave, onClose }: Props) {
  const [pokemon, setPokemon] = useState<RevealedPokemonInfo[]>(
    opponentInfo.pokemon.map(p => ({
      ...p,
      ability: p.ability || DEFAULT_ABILITIES[p.species] || '',
      item: p.item.includes('(') ? DEFAULT_ITEMS[p.species] || '' : p.item || DEFAULT_ITEMS[p.species] || '',
    }))
  );

  const updatePokemon = (index: number, field: keyof RevealedPokemonInfo, value: string) => {
    setPokemon(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const addMove = (index: number, move: string) => {
    if (!move.trim()) return;
    setPokemon(prev => {
      const updated = [...prev];
      if (updated[index].moves.length < 4 && !updated[index].moves.includes(move)) {
        updated[index] = { ...updated[index], moves: [...updated[index].moves, move] };
      }
      return updated;
    });
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

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#16213e] rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Edit Opponent Team</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Revealed info shown in white. Fill in unknown data for branching simulation accuracy.
        </p>

        <div className="space-y-4">
          {pokemon.map((p, i) => (
            <div key={p.species} className="bg-[#0f3460] rounded-lg p-4">
              <h3 className="font-bold mb-2">{p.species} <span className="text-xs text-gray-400">Lv.{p.level}</span></h3>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Ability</label>
                  <input
                    value={p.ability}
                    onChange={e => updatePokemon(i, 'ability', e.target.value)}
                    className="w-full bg-[#16213e] rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#e94560]"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Item</label>
                  <input
                    value={p.item}
                    onChange={e => updatePokemon(i, 'item', e.target.value)}
                    className="w-full bg-[#16213e] rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#e94560]"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Tera Type</label>
                  <input
                    value={p.teraType}
                    onChange={e => updatePokemon(i, 'teraType', e.target.value)}
                    placeholder="Unknown"
                    className="w-full bg-[#16213e] rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#e94560]"
                  />
                </div>
              </div>

              <div className="mt-2">
                <label className="text-xs text-gray-400 block mb-1">Moves ({p.moves.length}/4)</label>
                <div className="flex flex-wrap gap-1 mb-1">
                  {p.moves.map((m, mi) => (
                    <span key={m} className="text-xs px-2 py-0.5 rounded bg-[#16213e] flex items-center gap-1">
                      {m}
                      <button onClick={() => removeMove(i, mi)} className="text-red-400 hover:text-red-300">&times;</button>
                    </span>
                  ))}
                </div>
                {p.moves.length < 4 && (
                  <input
                    placeholder="Add move..."
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        addMove(i, (e.target as HTMLInputElement).value);
                        (e.target as HTMLInputElement).value = '';
                      }
                    }}
                    className="w-full bg-[#16213e] rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#e94560]"
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3 mt-4">
          <button
            onClick={() => onSave({ pokemon })}
            className="flex-1 bg-[#e94560] hover:bg-[#d63851] py-2 rounded-lg font-semibold text-sm transition-colors"
          >
            Save
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-[#0f3460] hover:bg-[#1a1a5e] py-2 rounded-lg text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
