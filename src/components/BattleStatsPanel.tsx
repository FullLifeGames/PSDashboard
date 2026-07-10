import type {
  KnowledgeSource,
  OpponentTeamInfo,
  PokemonEvsInfo,
  PokemonFieldInfo,
  PokemonMoveInfo,
  ReplayData,
  RevealedPokemonInfo,
} from '../types';
import { spriteUrl } from '../lib/sprite-url';

interface Props {
  replayData: ReplayData;
  p1Info: OpponentTeamInfo | null;
  p2Info: OpponentTeamInfo | null;
}

const TYPE_BG: Record<string, string> = {
  Normal: '#A8A878',
  Fire: '#F08030',
  Water: '#6890F0',
  Electric: '#F8D030',
  Grass: '#78C850',
  Ice: '#98D8D8',
  Fighting: '#C03028',
  Poison: '#A040A0',
  Ground: '#E0C068',
  Flying: '#A890F0',
  Psychic: '#F85888',
  Bug: '#A8B820',
  Rock: '#B8A038',
  Ghost: '#705898',
  Dragon: '#7038F8',
  Dark: '#705848',
  Steel: '#B8B8D0',
  Fairy: '#EE99AC',
  Stellar: '#40B5A5',
  '???': '#68A090',
};


function sourceAccent(source: KnowledgeSource): string {
  switch (source) {
    case 'revealed':
      return '#6cc2ff';
    case 'guessed':
      return '#f3c969';
    case 'manual':
      return '#78df9b';
    default:
      return '#8899aa';
  }
}

function formatProbability(probability: number | undefined): string {
  if (probability === undefined) return '';
  return `${Math.round(probability * 1000) / 10}%`;
}

function sourceLabel(source: KnowledgeSource, probability?: number): string {
  switch (source) {
    case 'revealed':
      return 'revealed';
    case 'guessed':
      return probability === undefined ? 'guessed' : `guessed ${formatProbability(probability)}`;
    case 'manual':
      return 'manual';
    default:
      return 'unknown';
  }
}

function formatFieldValue(field: PokemonFieldInfo): string {
  if (!field.value) return '';
  if (field.value === '(has item)') return 'Has item';
  return field.value;
}

function formatEvs(evs: PokemonEvsInfo, isRandomFormat: boolean): string {
  const labels = [
    ['HP', evs.value.hp],
    ['Atk', evs.value.atk],
    ['Def', evs.value.def],
    ['SpA', evs.value.spa],
    ['SpD', evs.value.spd],
    ['Spe', evs.value.spe],
  ] as const;
  const nonZero = labels.filter(([, value]) => value > 0);
  if (nonZero.length === 0) {
    // Random sets run fixed 85 EVs across the board; "0 EVs" would be
    // misleading for unknown spreads too (G21).
    if (isRandomFormat && evs.source === 'unknown') return '85 EVs each (random set)';
    return evs.source === 'unknown' ? 'EVs ?' : '0 EVs';
  }
  return `${nonZero.map(([label, value]) => `${value} ${label}`).join(' / ')} EVs`;
}

function MetaTag({
  field,
  className,
  children,
  background,
}: {
  field: PokemonFieldInfo;
  className?: string;
  children?: string;
  background?: string;
}) {
  const value = children || formatFieldValue(field);
  if (!value) return null;

  return (
    <span
      className={className}
      style={{
        background: background || undefined,
        color: background ? '#fff' : undefined,
        border: `1px solid ${sourceAccent(field.source)}`,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
      }}
      title={field.sourceDetail || sourceLabel(field.source, field.probability)}
    >
      {value}
      <span style={{ marginLeft: 6, color: sourceAccent(field.source), fontSize: 9, textTransform: 'uppercase' }}>
        {sourceLabel(field.source, field.probability)}
      </span>
    </span>
  );
}

function MoveTag({ move }: { move: PokemonMoveInfo }) {
  return (
    <span
      className="ps-stats-move"
      style={{
        border: `1px solid ${sourceAccent(move.source)}`,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
      }}
      title={move.sourceDetail || sourceLabel(move.source, move.probability)}
    >
      {move.name}
      <span style={{ marginLeft: 6, color: sourceAccent(move.source), fontSize: 9, textTransform: 'uppercase' }}>
        {sourceLabel(move.source, move.probability)}
      </span>
    </span>
  );
}

function PokemonEntry({ poke, isRandomFormat }: { poke: RevealedPokemonInfo; isRandomFormat: boolean }) {
  return (
    <div className="ps-stats-pokemon">
      <img
        src={spriteUrl(poke.species)}
        alt={poke.species}
        className="ps-stats-sprite"
      />
      <div className="ps-stats-details">
        <div className="ps-stats-species">
          {poke.species}
          {poke.level !== 100 && <span className="ps-stats-level"> L{poke.level}</span>}
          {poke.gender && <span className="ps-stats-gender"> {poke.gender === 'M' ? '♂' : '♀'}</span>}
        </div>
        {poke.moves.length > 0 && (
          <div className="ps-stats-moves">
            {poke.moves.map(move => (
              <MoveTag key={`${move.name}-${move.source}`} move={move} />
            ))}
          </div>
        )}
        <div className="ps-stats-meta">
          <MetaTag field={poke.ability} className="ps-stats-tag" />
          <MetaTag field={poke.item} className="ps-stats-tag ps-stats-tag-item" />
          <span
            className="ps-stats-tag"
            style={{
              border: `1px solid ${sourceAccent(poke.evs.source)}`,
              boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
            }}
            title={poke.evs.sourceDetail || sourceLabel(poke.evs.source, poke.evs.probability)}
          >
            {formatEvs(poke.evs, isRandomFormat)}
            <span style={{ marginLeft: 6, color: sourceAccent(poke.evs.source), fontSize: 9, textTransform: 'uppercase' }}>
              {sourceLabel(poke.evs.source, poke.evs.probability)}
            </span>
          </span>
          {poke.teraType.value && (
            <MetaTag
              field={poke.teraType}
              className="ps-stats-tag"
              background={TYPE_BG[poke.teraType.value] || '#68A090'}
            >
              {`Tera ${poke.teraType.value}`}
            </MetaTag>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamColumn({ label, playerName, info, isRandomFormat }: {
  label: string;
  playerName: string;
  info: OpponentTeamInfo;
  isRandomFormat: boolean;
}) {
  // Random battles always run six Pokémon — show the not-yet-revealed slots
  // instead of implying the team is complete (G21).
  const hiddenSlots = isRandomFormat ? Math.max(0, 6 - info.pokemon.length) : 0;

  return (
    <div className="ps-stats-team">
      <div className="ps-stats-header">
        <span className="ps-stats-label">{label}</span> {playerName}
      </div>
      {info.pokemon.map(p => (
        <PokemonEntry key={p.species} poke={p} isRandomFormat={isRandomFormat} />
      ))}
      {Array.from({ length: hiddenSlots }, (_, index) => (
        <div key={`hidden-${index}`} className="ps-stats-pokemon" style={{ opacity: 0.55 }}>
          <div className="ps-stats-sprite" aria-hidden="true" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: '#8899aa',
          }}>?</div>
          <div className="ps-stats-details">
            <div className="ps-stats-species" style={{ color: '#8899aa' }}>Not yet revealed</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function BattleStatsPanel({ replayData, p1Info, p2Info }: Props) {
  if (!p1Info && !p2Info) return null;
  const isRandomFormat = (replayData.formatid || '').includes('random');

  return (
    <div className="ps-panel" style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>Battle Statistics</div>
      <div className="ps-stats-grid">
        {p1Info && (
          <TeamColumn label="P1" playerName={replayData.players[0]} info={p1Info} isRandomFormat={isRandomFormat} />
        )}
        {p2Info && (
          <TeamColumn label="P2" playerName={replayData.players[1]} info={p2Info} isRandomFormat={isRandomFormat} />
        )}
      </div>
    </div>
  );
}
