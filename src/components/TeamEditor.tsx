import type { OpponentTeamInfo } from '../types';
import { useEditorPools, useTeamDraft } from '../hooks/useTeamDraft';
import { ModalDialog } from './ModalDialog';
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
  const { pokemon } = draft;

  return (
    <ModalDialog title={title} closeLabel="Close team editor" onClose={onClose}>
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
    </ModalDialog>
  );
}
