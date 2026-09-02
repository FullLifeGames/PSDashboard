import type { OpponentTeamInfo } from '../types';
import { useEditorPools, useTeamDraft } from '../hooks/useTeamDraft';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { PokemonRow } from './team-editor/PokemonRow';

interface Props {
  title: string;
  teamInfo: OpponentTeamInfo;
  /** Replay generation — decides which pools exist (abilities gen 3+, tera gen 9). */
  gen: number;
  onSave: (updatedInfo: OpponentTeamInfo) => void;
  onClose: () => void;
}

export function TeamEditor({ title, teamInfo, gen, onSave, onClose }: Props) {
  const pools = useEditorPools(teamInfo, gen);
  const draft = useTeamDraft(teamInfo.pokemon, pools);
  const { dialogRef, handleDialogKeyDown } = useDialogFocus(onClose);
  const { pokemon } = draft;

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
            <PokemonRow key={entry.species} entry={entry} index={i} gen={gen} pools={pools} draft={draft} />
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
