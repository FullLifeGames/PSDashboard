import { useEffect, useRef, useState } from 'react';
import type { OpponentTeamInfo, PokemonEvs, StatId, RevealedPokemonInfo } from '../types';
import { EMPTY_EVS, manualEvs, manualField, manualMove } from '../lib/team-info';

interface Props {
  title: string;
  teamInfo: OpponentTeamInfo;
  /** Replay generation — decides which pools exist (abilities gen 3+, tera gen 9). */
  gen: number;
  onSave: (updatedInfo: OpponentTeamInfo) => void;
  onClose: () => void;
}

interface EditorPools {
  items: string[];
  teraTypes: string[];
  natures: readonly string[];
  movesBySpecies: Record<string, string[]>;
  abilitiesBySpecies: Record<string, string[]>;
}

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sourceLabel(source: RevealedPokemonInfo['ability']['source'], probability?: number) {
  const suffix = probability === undefined ? '' : ` ${Math.round(probability * 1000) / 10}%`;
  return `${source.toUpperCase()}${suffix}`;
}

const EV_STATS: { id: StatId; label: string }[] = [
  { id: 'hp', label: 'HP' },
  { id: 'atk', label: 'Atk' },
  { id: 'def', label: 'Def' },
  { id: 'spa', label: 'SpA' },
  { id: 'spd', label: 'SpD' },
  { id: 'spe', label: 'Spe' },
];

function clampEv(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(252, Math.max(0, parsed));
}

export function TeamEditor({ title, teamInfo, gen, onSave, onClose }: Props) {
  const [pokemon, setPokemon] = useState<RevealedPokemonInfo[]>(teamInfo.pokemon);
  const [pools, setPools] = useState<EditorPools | null>(null);
  const [moveError, setMoveError] = useState<Record<number, string | null>>({});
  const [itemWarning, setItemWarning] = useState<Record<number, string | null>>({});
  const dialogRef = useRef<HTMLDivElement>(null);

  // Legal pools load lazily — the editor stays usable as free text until then.
  useEffect(() => {
    let active = true;
    void (async () => {
      const options = await import('../lib/pokemon-options');
      const movesBySpecies: Record<string, string[]> = {};
      const abilitiesBySpecies: Record<string, string[]> = {};
      await Promise.all(teamInfo.pokemon.map(async entry => {
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
  }, [teamInfo.pokemon, gen]);

  // WAI-ARIA dialog behaviour (G20): move focus into the dialog on open and
  // hand it back to the trigger on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  const handleDialogKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const updateField = (
    index: number,
    field: 'ability' | 'item' | 'teraType' | 'nature',
    value: string,
  ) => {
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
    const pool = pools?.movesBySpecies[species];
    if (pool && pool.length > 0 && !pool.some(name => toId(name) === toId(trimmed))) {
      setMoveError(prev => ({ ...prev, [index]: `${trimmed} is not in ${species}'s legal moves for this generation.` }));
      return false;
    }
    const canonical = pool?.find(name => toId(name) === toId(trimmed)) ?? trimmed;

    setMoveError(prev => ({ ...prev, [index]: null }));
    setPokemon(prev => {
      const updated = [...prev];
      if (updated[index].moves.length < 4 && !updated[index].moves.some(entry => toId(entry.name) === toId(canonical))) {
        updated[index] = {
          ...updated[index],
          moves: [...updated[index].moves, manualMove(canonical)],
        };
      }
      return updated;
    });
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

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
      }}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={handleDialogKeyDown}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          background: '#2a3a5c', border: '2px solid #8aa', borderRadius: 8,
          padding: 20, maxWidth: 640, width: '100%', maxHeight: '80vh', overflowY: 'auto', outline: 'none',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 'bold' }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close team editor"
            className="ps-modal-close"
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
                {gen >= 3 && (
                  <div>
                    <div style={{ fontSize: 9, color: '#8899aa', marginBottom: 2 }}>
                      Ability ({sourceLabel(entry.ability.source, entry.ability.probability)})
                    </div>
                    {pools && (pools.abilitiesBySpecies[entry.species]?.length ?? 0) > 0 ? (
                      <select
                        value={entry.ability.value}
                        onChange={e => updateField(i, 'ability', e.target.value)}
                        aria-label={`${entry.species} ability`}
                        className="ps-input"
                        style={{ width: '100%' }}
                      >
                        <option value="">Unknown</option>
                        {pools.abilitiesBySpecies[entry.species].map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                        {entry.ability.value &&
                          !pools.abilitiesBySpecies[entry.species].includes(entry.ability.value) && (
                          <option value={entry.ability.value}>{entry.ability.value}</option>
                        )}
                      </select>
                    ) : (
                      <input
                        value={entry.ability.value}
                        onChange={e => updateField(i, 'ability', e.target.value)}
                        aria-label={`${entry.species} ability`}
                        className="ps-input"
                        style={{ width: '100%' }}
                      />
                    )}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 9, color: '#8899aa', marginBottom: 2 }}>
                    Item ({sourceLabel(entry.item.source, entry.item.probability)})
                  </div>
                  <input
                    value={entry.item.value}
                    onChange={e => updateField(i, 'item', e.target.value)}
                    onBlur={e => {
                      const value = e.target.value.trim();
                      const known = !value || !pools || pools.items.length === 0 ||
                        pools.items.some(name => toId(name) === toId(value));
                      setItemWarning(prev => ({ ...prev, [i]: known ? null : `"${value}" is not a known item.` }));
                    }}
                    list="ps-item-pool"
                    aria-label={`${entry.species} item`}
                    className="ps-input"
                    style={{ width: '100%' }}
                  />
                </div>
                {gen >= 9 && (
                  <div>
                    <div style={{ fontSize: 9, color: '#8899aa', marginBottom: 2 }}>
                      Tera Type ({sourceLabel(entry.teraType.source, entry.teraType.probability)})
                    </div>
                    {pools && pools.teraTypes.length > 0 ? (
                      <select
                        value={entry.teraType.value}
                        onChange={e => updateField(i, 'teraType', e.target.value)}
                        aria-label={`${entry.species} tera type`}
                        className="ps-input"
                        style={{ width: '100%' }}
                      >
                        <option value="">Unknown</option>
                        {pools.teraTypes.map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={entry.teraType.value}
                        onChange={e => updateField(i, 'teraType', e.target.value)}
                        placeholder="Unknown"
                        aria-label={`${entry.species} tera type`}
                        className="ps-input"
                        style={{ width: '100%' }}
                      />
                    )}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 9, color: '#8899aa', marginBottom: 2 }}>
                    Nature ({sourceLabel(entry.nature?.source ?? 'unknown', entry.nature?.probability)})
                  </div>
                  {pools ? (
                    <select
                      value={entry.nature?.value ?? ''}
                      onChange={e => updateField(i, 'nature', e.target.value)}
                      aria-label={`${entry.species} nature`}
                      className="ps-input"
                      style={{ width: '100%' }}
                    >
                      <option value="">Unknown</option>
                      {pools.natures.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={entry.nature?.value ?? ''}
                      onChange={e => updateField(i, 'nature', e.target.value)}
                      placeholder="Unknown"
                      aria-label={`${entry.species} nature`}
                      className="ps-input"
                      style={{ width: '100%' }}
                    />
                  )}
                </div>
              </div>
              {itemWarning[i] && (
                <div role="alert" style={{ fontSize: 10, color: '#f3a6a6', marginBottom: 6 }}>
                  {itemWarning[i]}
                </div>
              )}

              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 9, color: '#8899aa', marginBottom: 2 }}>
                  EVs ({sourceLabel(entry.evs.source, entry.evs.probability)})
                </div>
                <div className="ps-ev-grid">
                  {EV_STATS.map(stat => (
                    <label key={stat.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 9, color: '#8899aa' }}>
                      {stat.label}
                      <input
                        type="number"
                        min={0}
                        max={252}
                        step={4}
                        aria-label={`${entry.species} ${stat.label} EVs`}
                        value={entry.evs.value[stat.id]}
                        onChange={e => updateEv(i, stat.id, e.target.value)}
                        className="ps-input"
                        style={{ width: '100%', fontSize: 10, padding: '3px 4px' }}
                      />
                    </label>
                  ))}
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
                        aria-label={`Remove ${move.name} from ${entry.species}`}
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
                  <>
                    <input
                      placeholder="Add move..."
                      list={`ps-move-pool-${i}`}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          if (addMove(i, (e.target as HTMLInputElement).value)) {
                            (e.target as HTMLInputElement).value = '';
                          }
                        }
                      }}
                      className="ps-input"
                      style={{ width: '100%', fontSize: 10 }}
                    />
                    <datalist id={`ps-move-pool-${i}`}>
                      {(pools?.movesBySpecies[entry.species] ?? [])
                        .filter(name => !entry.moves.some(known => toId(known.name) === toId(name)))
                        .map(name => <option key={name} value={name} />)}
                    </datalist>
                  </>
                )}
                {moveError[i] && (
                  <div role="alert" style={{ fontSize: 10, color: '#f3a6a6', marginTop: 4 }}>
                    {moveError[i]}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <datalist id="ps-item-pool">
          {(pools?.items ?? []).map(name => <option key={name} value={name} />)}
        </datalist>

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
