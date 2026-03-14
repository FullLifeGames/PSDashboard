/**
 * PS-faithful battle scene — renders the battlefield with sprites, stat boxes,
 * team indicators, field effects, and side conditions.
 * Used by both the replay viewer and the branching simulator.
 */

interface PokemonDisplayInfo {
  name: string;
  species: string;
  hp: number;
  maxhp: number;
  hpPercent: number;
  status: string;
  fainted: boolean;
  level: number;
  gender?: string;
  boosts?: Record<string, number>;
  terastallized?: string;
}

interface TeamMemberInfo {
  name: string;
  fainted: boolean;
  hpPercent: number;
  status: string;
}

interface FieldInfo {
  weather?: string;
  terrain?: string;
  pseudoWeather?: Record<string, unknown>;
}

interface SideConditions {
  [key: string]: unknown;
}

interface Props {
  p1Active: PokemonDisplayInfo | null;
  p2Active: PokemonDisplayInfo | null;
  p1Team: TeamMemberInfo[];
  p2Team: TeamMemberInfo[];
  field?: FieldInfo;
  p1Conditions?: SideConditions;
  p2Conditions?: SideConditions;
}

function spriteUrl(species: string, back?: boolean) {
  const id = species.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const dir = back ? 'gen5-back' : 'gen5';
  return `https://play.pokemonshowdown.com/sprites/${dir}/${id}.png`;
}

function hpBarClass(pct: number): string {
  if (pct > 50) return 'ps-hpbar-green';
  if (pct > 20) return 'ps-hpbar-yellow';
  return 'ps-hpbar-red';
}

function pokeballClass(member: TeamMemberInfo): string {
  if (member.fainted) return 'ps-pokeball ps-pokeball-fainted';
  if (member.status) return 'ps-pokeball ps-pokeball-status';
  return 'ps-pokeball ps-pokeball-alive';
}

function formatConditions(conds: SideConditions): string[] {
  const labels: string[] = [];
  for (const [id, data] of Object.entries(conds)) {
    const c = data as { name?: string; level?: number };
    if (id === 'stealthrock') labels.push('Stealth Rock');
    else if (id === 'spikes') labels.push(`Spikes ×${c.level || 1}`);
    else if (id === 'toxicspikes') labels.push(`T-Spikes ×${c.level || 1}`);
    else if (id === 'stickyweb') labels.push('Sticky Web');
    else if (id === 'reflect') labels.push('Reflect');
    else if (id === 'lightscreen') labels.push('Light Screen');
    else if (id === 'auroraveil') labels.push('Aurora Veil');
    else if (id === 'tailwind') labels.push('Tailwind');
    else labels.push(c.name || id);
  }
  return labels;
}

function statusClass(status: string): string {
  const map: Record<string, string> = {
    brn: 'ps-status ps-status-brn',
    psn: 'ps-status ps-status-psn',
    tox: 'ps-status ps-status-tox',
    par: 'ps-status ps-status-par',
    slp: 'ps-status ps-status-slp',
    frz: 'ps-status ps-status-frz',
  };
  return map[status] || 'ps-status';
}

/* ── Stat bar (floating HP/name box) ── */
function StatBar({ pokemon, isOpponent }: { pokemon: PokemonDisplayInfo; isOpponent?: boolean }) {
  const posClass = isOpponent ? 'ps-statbar-opponent' : 'ps-statbar-player';
  const hasBoosts = pokemon.boosts && Object.entries(pokemon.boosts).some(([, v]) => v !== 0);

  return (
    <div className={`ps-statbar ${posClass}`}>
      {/* Row 1: name, level, status */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span className="ps-statbar-name">{pokemon.name}</span>
        {pokemon.level !== 100 && (
          <span className="ps-statbar-level">L{pokemon.level}</span>
        )}
        {pokemon.gender && pokemon.gender !== '' && (
          <span style={{
            marginLeft: 3,
            fontSize: 11,
            color: pokemon.gender === 'M' ? '#88f' : '#f88',
            fontWeight: 'bold',
          }}>
            {pokemon.gender === 'M' ? '\u2642' : '\u2640'}
          </span>
        )}
        {pokemon.status && (
          <span className={statusClass(pokemon.status)}>
            {pokemon.status.toUpperCase()}
          </span>
        )}
        {pokemon.terastallized && (
          <span style={{
            marginLeft: 4,
            fontSize: 8,
            padding: '0 4px',
            borderRadius: 3,
            background: '#cc4455',
            color: '#fff',
            fontWeight: 'bold',
          }}>
            TERA {pokemon.terastallized.toUpperCase()}
          </span>
        )}
      </div>

      {/* Row 2: HP bar */}
      <div className="ps-hpbar-track">
        <div
          className={`ps-hpbar-fill ${hpBarClass(pokemon.hpPercent)}`}
          style={{ width: `${pokemon.hpPercent}%` }}
        />
      </div>

      {/* HP text */}
      <div style={{ fontSize: 9, color: '#aab', marginTop: 1, textAlign: 'right' }}>
        {pokemon.fainted ? 'Fainted' : `${pokemon.hpPercent}%`}
      </div>

      {/* Boosts */}
      {hasBoosts && (
        <div style={{ marginTop: 1 }}>
          {Object.entries(pokemon.boosts!).map(([stat, val]) => {
            if (!val) return null;
            return (
              <span key={stat} className={`ps-boost ${val > 0 ? 'ps-boost-up' : 'ps-boost-down'}`}>
                {stat} {val > 0 ? `+${val}` : val}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Main BattleScene ── */
export function BattleScene({ p1Active, p2Active, p1Team, p2Team, field, p1Conditions, p2Conditions }: Props) {
  const p1Conds = p1Conditions ? formatConditions(p1Conditions) : [];
  const p2Conds = p2Conditions ? formatConditions(p2Conditions) : [];

  return (
    <div className="ps-battle-scene">
      {/* Field effects overlay */}
      {field && (field.weather || field.terrain) && (
        <div className="ps-field-overlay">
          {field.weather && (
            <span className="ps-field-tag ps-field-weather">{field.weather}</span>
          )}
          {field.terrain && (
            <span className="ps-field-tag ps-field-terrain">{field.terrain} Terrain</span>
          )}
        </div>
      )}

      {/* Opponent stat bar */}
      {p2Active && !p2Active.fainted && <StatBar pokemon={p2Active} isOpponent />}

      {/* Opponent sprite (front sprite, positioned top-right) */}
      {p2Active && !p2Active.fainted && (
        <img
          src={spriteUrl(p2Active.species)}
          alt={p2Active.name}
          className="ps-sprite ps-sprite-opponent"
        />
      )}

      {/* Opponent pokeballs */}
      <div style={{ position: 'absolute', top: '5%', left: '5%', zIndex: 11, display: 'flex', gap: 3, marginTop: p2Active ? 0 : 0 }}>
        {/* Show above stat bar on opponent side */}
      </div>

      {/* Opponent team pokeballs (below stat bar) */}
      {p2Team.length > 0 && (
        <div style={{
          position: 'absolute', top: '8%', left: '5%', zIndex: 11,
          marginTop: 48, display: 'flex', gap: 2,
        }}>
          {p2Team.map(m => (
            <span key={m.name} className={pokeballClass(m)} title={`${m.name} ${m.hpPercent}%`} />
          ))}
        </div>
      )}

      {/* Opponent side conditions */}
      {p2Conds.length > 0 && (
        <div className="ps-sidecond ps-sidecond-opponent">
          {p2Conds.map(c => <span key={c} className="ps-sidecond-tag">{c}</span>)}
        </div>
      )}

      {/* Player stat bar */}
      {p1Active && !p1Active.fainted && <StatBar pokemon={p1Active} />}

      {/* Player sprite (back sprite, positioned bottom-left) */}
      {p1Active && !p1Active.fainted && (
        <img
          src={spriteUrl(p1Active.species, true)}
          alt={p1Active.name}
          className="ps-sprite ps-sprite-player"
        />
      )}

      {/* Player team pokeballs (above stat bar) */}
      {p1Team.length > 0 && (
        <div style={{
          position: 'absolute', bottom: '12%', right: '5%', zIndex: 11,
          marginBottom: 52, display: 'flex', gap: 2,
        }}>
          {p1Team.map(m => (
            <span key={m.name} className={pokeballClass(m)} title={`${m.name} ${m.hpPercent}%`} />
          ))}
        </div>
      )}

      {/* Player side conditions */}
      {p1Conds.length > 0 && (
        <div className="ps-sidecond ps-sidecond-player">
          {p1Conds.map(c => <span key={c} className="ps-sidecond-tag">{c}</span>)}
        </div>
      )}
    </div>
  );
}

export type { PokemonDisplayInfo, TeamMemberInfo, FieldInfo };
