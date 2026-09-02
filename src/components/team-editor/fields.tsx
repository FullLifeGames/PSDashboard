import type { RevealedPokemonInfo } from '../../types';
import { itemSetValue } from '../../lib/team-info';
import { EV_STATS, sourceLabel, type EditorPools } from '../../lib/team-editor';
import type { TeamDraft } from '../../hooks/useTeamDraft';
import { ComboBox } from '../ComboBox';
import { toId } from '../../lib/ids';

interface FieldProps {
  entry: RevealedPokemonInfo;
  index: number;
  pools: EditorPools | null;
  draft: TeamDraft;
}

function FieldCaption({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 9, color: '#8899aa', marginBottom: 2 }}>{children}</div>;
}

export function AbilityField({ entry, index, pools, draft }: FieldProps) {
  const { updateField } = draft;
  return (
    <div>
      <FieldCaption>
        Ability ({sourceLabel(entry.ability.source, entry.ability.probability)})
      </FieldCaption>
      {pools && (pools.abilitiesBySpecies[entry.species]?.length ?? 0) > 0 ? (
        <select
          value={entry.ability.value}
          onChange={e => updateField(index, 'ability', e.target.value)}
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
          onChange={e => updateField(index, 'ability', e.target.value)}
          aria-label={`${entry.species} ability`}
          className="ps-input"
          style={{ width: '100%' }}
        />
      )}
    </div>
  );
}

export function ItemField({ entry, index, pools, draft }: FieldProps) {
  const { updateField, setItemWarning } = draft;
  return (
    <div>
      <FieldCaption>
        Item ({sourceLabel(entry.item.source, entry.item.probability)})
      </FieldCaption>
      <ComboBox
        options={pools?.items ?? []}
        // Annotations like "(consumed)" are battle knowledge, not
        // part of the set — the editor works on the plain item.
        value={entry.item.source === 'manual' ? entry.item.value : itemSetValue(entry.item.value)}
        onChange={value => updateField(index, 'item', value)}
        onSelect={value => {
          updateField(index, 'item', value);
          setItemWarning(prev => ({ ...prev, [index]: null }));
        }}
        onBlur={() => {
          const value = (entry.item.source === 'manual' ? entry.item.value : itemSetValue(entry.item.value)).trim();
          const known = !value || !pools || pools.items.length === 0 ||
            pools.items.some(name => toId(name) === toId(value));
          setItemWarning(prev => ({ ...prev, [index]: known ? null : `"${value}" is not a known item.` }));
        }}
        ariaLabel={`${entry.species} item`}
      />
    </div>
  );
}

export function TeraField({ entry, index, pools, draft }: FieldProps) {
  const { updateField } = draft;
  return (
    <div>
      <FieldCaption>
        Tera Type ({sourceLabel(entry.teraType.source, entry.teraType.probability)})
      </FieldCaption>
      {pools && pools.teraTypes.length > 0 ? (
        <select
          value={entry.teraType.value}
          onChange={e => updateField(index, 'teraType', e.target.value)}
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
          onChange={e => updateField(index, 'teraType', e.target.value)}
          placeholder="Unknown"
          aria-label={`${entry.species} tera type`}
          className="ps-input"
          style={{ width: '100%' }}
        />
      )}
    </div>
  );
}

export function NatureField({ entry, index, pools, draft }: FieldProps) {
  const { updateField } = draft;
  return (
    <div>
      <FieldCaption>
        Nature ({sourceLabel(entry.nature?.source ?? 'unknown', entry.nature?.probability)})
      </FieldCaption>
      {pools ? (
        <select
          value={entry.nature?.value ?? ''}
          onChange={e => updateField(index, 'nature', e.target.value)}
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
          onChange={e => updateField(index, 'nature', e.target.value)}
          placeholder="Unknown"
          aria-label={`${entry.species} nature`}
          className="ps-input"
          style={{ width: '100%' }}
        />
      )}
    </div>
  );
}

export function EvGrid({ entry, index, draft }: Omit<FieldProps, 'pools'>) {
  const { updateEv } = draft;
  return (
    <div style={{ marginBottom: 6 }}>
      <FieldCaption>
        EVs ({sourceLabel(entry.evs.source, entry.evs.probability)})
      </FieldCaption>
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
              onChange={e => updateEv(index, stat.id, e.target.value)}
              className="ps-input"
              style={{ width: '100%', fontSize: 10, padding: '3px 4px' }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function MoveChips({ entry, index, draft }: Omit<FieldProps, 'pools'>) {
  const { removeMove } = draft;
  return (
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
            onClick={() => removeMove(index, moveIndex)}
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
  );
}

function MoveAdder({ entry, index, pools, draft }: FieldProps) {
  const { moveDraft, setMoveDraft, addMove } = draft;
  return (
    <ComboBox
      options={(pools?.movesBySpecies[entry.species] ?? [])
        .filter(name => !entry.moves.some(known => toId(known.name) === toId(name)))}
      value={moveDraft[index] ?? ''}
      onChange={value => setMoveDraft(prev => ({ ...prev, [index]: value }))}
      onSelect={option => {
        if (addMove(index, option)) setMoveDraft(prev => ({ ...prev, [index]: '' }));
      }}
      onEnterFreeText={text => {
        if (addMove(index, text)) setMoveDraft(prev => ({ ...prev, [index]: '' }));
      }}
      placeholder="Add move..."
      inputStyle={{ fontSize: 10 }}
    />
  );
}

export function MovesField({ entry, index, pools, draft }: FieldProps) {
  const { moveError } = draft;
  return (
    <div>
      <FieldCaption>Moves ({entry.moves.length}/4)</FieldCaption>
      <MoveChips entry={entry} index={index} draft={draft} />
      {entry.moves.length < 4 && <MoveAdder entry={entry} index={index} pools={pools} draft={draft} />}
      {moveError[index] && (
        <div role="alert" style={{ fontSize: 10, color: '#f3a6a6', marginTop: 4 }}>
          {moveError[index]}
        </div>
      )}
    </div>
  );
}
