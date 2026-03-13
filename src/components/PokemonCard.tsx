import type { PokemonSnapshot } from '../types';
import { Sprites } from '@pkmn/img';

interface Props {
  pokemon: PokemonSnapshot;
  isOpponent?: boolean;
  compact?: boolean;
}

function getHpColor(percent: number): string {
  if (percent > 50) return 'bg-green-500';
  if (percent > 20) return 'bg-yellow-500';
  return 'bg-red-500';
}

function getStatusBadge(status: string): { text: string; color: string } | null {
  const map: Record<string, { text: string; color: string }> = {
    psn: { text: 'PSN', color: 'bg-purple-600' },
    tox: { text: 'TOX', color: 'bg-purple-800' },
    brn: { text: 'BRN', color: 'bg-orange-600' },
    par: { text: 'PAR', color: 'bg-yellow-600' },
    slp: { text: 'SLP', color: 'bg-gray-600' },
    frz: { text: 'FRZ', color: 'bg-cyan-400' },
  };
  return map[status] || null;
}

function getSpriteUrl(speciesForme: string): string {
  try {
    const data = Sprites.getDexPokemon(speciesForme, { gen: 'gen5' as any });
    if (data) return data.url;
  } catch {
    // fallback
  }
  // Fallback to PS sprite URL
  const id = speciesForme.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`;
}

export function PokemonCard({ pokemon, isOpponent, compact }: Props) {
  const { name, speciesForme, hpPercent, status, fainted, isActive, boosts, moves, ability, item, terastallized, level } = pokemon;

  if (compact) {
    return (
      <div className={`flex items-center gap-2 px-2 py-1 rounded ${fainted ? 'opacity-30' : ''} ${isActive ? 'bg-[#1a1a5e]' : ''}`}>
        <img
          src={getSpriteUrl(speciesForme)}
          alt={name}
          className="w-8 h-8 object-contain pixelated"
          style={{ imageRendering: 'pixelated' }}
        />
        <span className="text-xs truncate flex-1">{name}</span>
        <div className="w-12 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div className={`h-full ${getHpColor(hpPercent)} transition-all`} style={{ width: `${hpPercent}%` }} />
        </div>
        {status && (() => {
          const badge = getStatusBadge(status);
          return badge ? <span className={`text-[10px] px-1 rounded ${badge.color}`}>{badge.text}</span> : null;
        })()}
      </div>
    );
  }

  return (
    <div className={`bg-[#0f3460] rounded-xl p-4 ${fainted ? 'opacity-40' : ''} ${isActive ? 'ring-2 ring-[#e94560]' : ''}`}>
      <div className="flex items-start gap-3">
        <img
          src={getSpriteUrl(speciesForme)}
          alt={name}
          className={`w-20 h-20 object-contain ${isOpponent ? 'scale-x-[-1]' : ''}`}
          style={{ imageRendering: 'pixelated' }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold truncate">{name}</span>
            {level !== 100 && <span className="text-xs text-gray-400">Lv.{level}</span>}
            {terastallized && (
              <span className="text-xs px-1.5 py-0.5 bg-[#e94560] rounded">Tera: {terastallized}</span>
            )}
          </div>

          {/* HP Bar */}
          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1 h-2.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full ${getHpColor(hpPercent)} transition-all duration-300`}
                style={{ width: `${hpPercent}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 min-w-[40px] text-right">
              {fainted ? 'Fainted' : `${hpPercent}%`}
            </span>
          </div>

          {/* Status */}
          <div className="flex flex-wrap gap-1 mb-2">
            {status && (() => {
              const badge = getStatusBadge(status);
              return badge ? <span className={`text-xs px-1.5 py-0.5 rounded ${badge.color}`}>{badge.text}</span> : null;
            })()}
            {ability && <span className="text-xs px-1.5 py-0.5 rounded bg-[#1a1a5e] text-gray-300">{ability}</span>}
            {item && <span className="text-xs px-1.5 py-0.5 rounded bg-[#1a1a5e] text-gray-300">{item}</span>}
          </div>

          {/* Boosts */}
          {Object.entries(boosts).some(([, v]) => v !== 0) && (
            <div className="flex flex-wrap gap-1 mb-2">
              {Object.entries(boosts).map(([stat, val]) => {
                if (!val) return null;
                return (
                  <span
                    key={stat}
                    className={`text-[10px] px-1 py-0.5 rounded ${val > 0 ? 'bg-blue-900 text-blue-300' : 'bg-red-900 text-red-300'}`}
                  >
                    {stat} {val > 0 ? `+${val}` : val}
                  </span>
                );
              })}
            </div>
          )}

          {/* Moves */}
          {moves.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {moves.map(move => (
                <span key={move} className="text-[11px] px-1.5 py-0.5 rounded bg-[#16213e] text-gray-300">
                  {move}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
