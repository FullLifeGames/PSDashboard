import { useState } from 'react';
import type { OpponentTeamInfo, RevealedPokemonInfo } from '../types';
import { getDefaultAbility, getDefaultItem, fillDefaultMoves } from '../lib/common-sets';

interface Props {
  opponentInfo: OpponentTeamInfo;
  onSave: (updatedInfo: OpponentTeamInfo) => void;
  onClose: () => void;
}

export function OpponentEditor({ opponentInfo, onSave, onClose }: Props) {
  const [pokemon, setPokemon] = useState<RevealedPokemonInfo[]>(
    opponentInfo.pokemon.map(p => ({
      ...p,
      ability: p.ability || getDefaultAbility(p.species),
      item: p.item.includes('(') ? getDefaultItem(p.species) || '' : p.item || getDefaultItem(p.species),
      moves: fillDefaultMoves(p.species, p.moves),
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
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
    }}>
      <div style={{
        background: '#2a3a5c', border: '2px solid #8aa', borderRadius: 8,
        padding: 20, maxWidth: 640, width: '100%', maxHeight: '80vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 'bold' }}>Edit Opponent Team</div>
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
          Unknown fields auto-filled from common competitive sets.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pokemon.map((p, i) => (
            <div key={p.species} className="ps-panel" style={{ padding: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 6 }}>
                {p.species} <span style={{ fontSize: 10, color: '#8899aa' }}>Lv.{p.level}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 9, color: '#8899aa', marginBottom: 2 }}>Ability</div>
                  <input
                    value={p.ability}
                    onChange={e => updatePokemon(i, 'ability', e.target.value)}
                    className="ps-input"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 9, color: '#8899aa', marginBottom: 2 }}>Item</div>
                  <input
                    value={p.item}
                    onChange={e => updatePokemon(i, 'item', e.target.value)}
                    className="ps-input"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 9, color: '#8899aa', marginBottom: 2 }}>Tera Type</div>
                  <input
                    value={p.teraType}
                    onChange={e => updatePokemon(i, 'teraType', e.target.value)}
                    placeholder="Unknown"
                    className="ps-input"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div>
                <div style={{ fontSize: 9, color: '#8899aa', marginBottom: 2 }}>Moves ({p.moves.length}/4)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                  {p.moves.map((m, mi) => (
                    <span key={m} style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 3,
                      background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      {m}
                      <button
                        type="button"
                        onClick={() => removeMove(i, mi)}
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
                {p.moves.length < 4 && (
                  <input
                    placeholder="Add move…"
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
