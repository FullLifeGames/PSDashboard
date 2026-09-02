import type { RevealedPokemonInfo } from '../../types';
import type { EditorPools } from '../../lib/team-editor';
import type { TeamDraft } from '../../hooks/useTeamDraft';
import { AbilityField, EvGrid, ItemField, MovesField, NatureField, TeraField } from './fields';

/** One Pokémon's editable set: identity line, the set fields, EVs, and moves. */
export function PokemonRow({ entry, index, gen, pools, draft }: {
  entry: RevealedPokemonInfo;
  index: number;
  gen: number;
  pools: EditorPools | null;
  draft: TeamDraft;
}) {
  const { itemWarning } = draft;
  return (
    <div className="ps-panel" style={{ padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 6 }}>
        {entry.species} <span style={{ fontSize: 10, color: '#8899aa' }}>Lv.{entry.level}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
        {gen >= 3 && <AbilityField entry={entry} index={index} pools={pools} draft={draft} />}
        <ItemField entry={entry} index={index} pools={pools} draft={draft} />
        {gen >= 9 && <TeraField entry={entry} index={index} pools={pools} draft={draft} />}
        <NatureField entry={entry} index={index} pools={pools} draft={draft} />
      </div>
      {itemWarning[index] && (
        <div role="alert" style={{ fontSize: 10, color: '#f3a6a6', marginBottom: 6 }}>
          {itemWarning[index]}
        </div>
      )}

      <EvGrid entry={entry} index={index} draft={draft} />

      <MovesField entry={entry} index={index} pools={pools} draft={draft} />
    </div>
  );
}
