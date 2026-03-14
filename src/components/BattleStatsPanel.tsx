import type { ReplayData, OpponentTeamInfo, RevealedPokemonInfo } from '../types';

interface Props {
  replayData: ReplayData;
  p1Info: OpponentTeamInfo | null;
  p2Info: OpponentTeamInfo | null;
}

const TYPE_BG: Record<string, string> = {
  Normal:   '#A8A878', Fire:     '#F08030', Water:    '#6890F0',
  Electric: '#F8D030', Grass:    '#78C850', Ice:      '#98D8D8',
  Fighting: '#C03028', Poison:   '#A040A0', Ground:   '#E0C068',
  Flying:   '#A890F0', Psychic:  '#F85888', Bug:      '#A8B820',
  Rock:     '#B8A038', Ghost:    '#705898', Dragon:   '#7038F8',
  Dark:     '#705848', Steel:    '#B8B8D0', Fairy:    '#EE99AC',
  Stellar:  '#40B5A5', '???':    '#68A090',
};

function spriteUrl(species: string) {
  const id = species.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`;
}

function PokemonEntry({ poke }: { poke: RevealedPokemonInfo }) {
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
            {poke.moves.map(m => (
              <span key={m} className="ps-stats-move">{m}</span>
            ))}
          </div>
        )}
        <div className="ps-stats-meta">
          {poke.ability && <span className="ps-stats-tag">{poke.ability}</span>}
          {poke.item && !poke.item.startsWith('(') && (
            <span className="ps-stats-tag ps-stats-tag-item">{poke.item}</span>
          )}
          {poke.teraType && (
            <span
              className="ps-stats-tag"
              style={{ background: TYPE_BG[poke.teraType] || '#68A090', color: '#fff' }}
            >
              Tera {poke.teraType}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamColumn({ label, playerName, info }: {
  label: string;
  playerName: string;
  info: OpponentTeamInfo;
}) {
  return (
    <div className="ps-stats-team">
      <div className="ps-stats-header">
        <span className="ps-stats-label">{label}</span> {playerName}
      </div>
      {info.pokemon.map(p => (
        <PokemonEntry key={p.species} poke={p} />
      ))}
    </div>
  );
}

export function BattleStatsPanel({ replayData, p1Info, p2Info }: Props) {
  if (!p1Info && !p2Info) return null;

  return (
    <div className="ps-panel" style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>Battle Statistics</div>
      <div className="ps-stats-grid">
        {p1Info && (
          <TeamColumn label="P1" playerName={replayData.players[0]} info={p1Info} />
        )}
        {p2Info && (
          <TeamColumn label="P2" playerName={replayData.players[1]} info={p2Info} />
        )}
      </div>
    </div>
  );
}
