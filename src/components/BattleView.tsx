import type { TurnSnapshot } from '../types';
import { BattleScene } from './BattleScene';

interface Props {
  snapshot: TurnSnapshot;
}

export function BattleView({ snapshot }: Props) {
  const p1Active = snapshot.p1.pokemon.find(p => p.isActive);
  const p2Active = snapshot.p2.pokemon.find(p => p.isActive);

  const toDisplay = (p: typeof p1Active) => p ? {
    name: p.name,
    species: p.speciesForme,
    hp: p.hp,
    maxhp: p.maxhp,
    hpPercent: p.hpPercent,
    status: p.status,
    fainted: p.fainted,
    level: p.level,
    gender: p.gender,
    boosts: p.boosts,
    terastallized: p.terastallized,
  } : null;

  const toTeam = (pokemon: typeof snapshot.p1.pokemon) =>
    pokemon.map(p => ({
      name: p.name,
      fainted: p.fainted,
      hpPercent: p.hpPercent,
      status: p.status,
    }));

  return (
    <div className="ps-replay-frame">
      <BattleScene
        p1Active={toDisplay(p1Active)}
        p2Active={toDisplay(p2Active)}
        p1Team={toTeam(snapshot.p1.pokemon)}
        p2Team={toTeam(snapshot.p2.pokemon)}
        field={{
          weather: snapshot.field.weather,
          terrain: snapshot.field.terrain,
          pseudoWeather: snapshot.field.pseudoWeather,
        }}
        p1Conditions={snapshot.p1.sideConditions}
        p2Conditions={snapshot.p2.sideConditions}
      />

      {/* Info bar below the scene — like PS replay info */}
      <div style={{ background: '#2a3a5c', padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
          <span style={{ color: '#8ac' }}>{snapshot.p1.name || 'Player 1'}</span>
          <span style={{ color: '#666' }}>vs</span>
          <span style={{ color: '#c8a' }}>{snapshot.p2.name || 'Player 2'}</span>
        </div>

        {/* Show revealed moves / ability / item for active Pokemon */}
        <div style={{ display: 'flex', gap: 12, fontSize: 10 }}>
          {p1Active && p1Active.moves.length > 0 && (
            <div style={{ color: '#8ac' }}>
              {p1Active.moves.join(' / ')}
              {p1Active.ability && <span style={{ color: '#88a', marginLeft: 6 }}>[{p1Active.ability}]</span>}
              {p1Active.item && <span style={{ color: '#88a', marginLeft: 4 }}>@ {p1Active.item}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
