import { useState } from 'react';
import type { OpponentTeamInfo, RevealedPokemonInfo } from '../types';
import { manualField, manualMove } from '../lib/team-info';

interface Props {
  title: string;
  teamInfo: OpponentTeamInfo;
  onSave: (updatedInfo: OpponentTeamInfo) => void;
  onClose: () => void;
}

function sourceLabel(source: RevealedPokemonInfo['ability']['source'], probability?: number) {
  const suffix = probability === undefined ? '' : ` ${Math.round(probability * 1000) / 10}%`;
  return `${source.toUpperCase()}${suffix}`;
}

export function TeamEditor({ title, teamInfo, onSave, onClose }: Props) {
  const [pokemon, setPokemon] = useState<RevealedPokemonInfo[]>(teamInfo.pokemon);

  const updateField = (
    index: number,
    field: 'ability' | 'item' | 'teraType',
    value: string,
  ) => {
    setPokemon(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: manualField(value) };
      return updated;
    });
  };

  const addMove = (index: number, move: string) => {
    const trimmed = move.trim();
    if (!trimmed) return;

    setPokemon(prev => {
      const updated = [...prev];
      if (updated[index].moves.length < 4 && !updated[index].moves.some(entry => entry.name === trimmed)) {
        updated[index] = {
          ...updated[index],
          moves: [...updated[index].moves, manualMove(trimmed)],
        };
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
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
    }}>
      <div style={{
        background: '#2a3a5c', border: '2px solid #8aa', borderRadius: 8,
        padding: 20, maxWidth: 640, width: '100%', maxHeight: '80vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 'bold' }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: '#889', cursor: 'pointer',
              fontSize: 18, fontFamily: 'inherit',
            }}
          >
            &times;
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#8899aa', marginBottom: 12 }}>
          Revealed, guessed, and manual values are shown separately. Editing a field marks it as manual.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pokemon.map((entry, i) => (
            <div key={entry.species} className="ps-panel" style={{ padding: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 6 }}>
                {entry.species} <span style={{ fontSize: 10, color: '#8899aa' }}>Lv.{entry.level}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 9, color: '#8899aa', marginBottom: 2 }}>
                    Ability ({sourceLabel(entry.ability.source, entry.ability.probability)})
                  </div>
                  <input
                    value={entry.ability.value}
                    onChange={e => updateField(i, 'ability', e.target.value)}
                    className="ps-input"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 9, color: '#8899aa', marginBottom: 2 }}>
                    Item ({sourceLabel(entry.item.source, entry.item.probability)})
                  </div>
                  <input
                    value={entry.item.value}
                    onChange={e => updateField(i, 'item', e.target.value)}
                    className="ps-input"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 9, color: '#8899aa', marginBottom: 2 }}>
                    Tera Type ({sourceLabel(entry.teraType.source, entry.teraType.probability)})
                  </div>
                  <input
                    value={entry.teraType.value}
                    onChange={e => updateField(i, 'teraType', e.target.value)}
                    placeholder="Unknown"
                    className="ps-input"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div>
                <div style={{ fontSize: 9, color: '#8899aa', marginBottom: 2 }}>Moves ({entry.moves.length}/4)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                  {entry.moves.map((move, moveIndex) => (
                    <span key={`${move.name}-${move.source}-${moveIndex}`} style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 3,
                      background: 'rgba(0,0,0,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}>
                      {move.name}
                      <span style={{ color: '#9fb5d9', fontSize: 9 }}>
                        {sourceLabel(move.source, move.probability)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeMove(i, moveIndex)}
                        style={{
                          background: 'none', border: 'none', color: '#f88', cursor: 'pointer',
                          fontSize: 12, padding: 0, fontFamily: 'inherit',
                        }}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
                {entry.moves.length < 4 && (
                  <input
                    placeholder="Add move..."
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        addMove(i, (e.target as HTMLInputElement).value);
                        (e.target as HTMLInputElement).value = '';
                      }
                    }}
                    className="ps-input"
                    style={{ width: '100%', fontSize: 10 }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" className="ps-btn ps-btn-red" style={{ flex: 1 }} onClick={() => onSave({ pokemon })}>
            Save
          </button>
          <button type="button" className="ps-btn" style={{ flex: 1 }} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
