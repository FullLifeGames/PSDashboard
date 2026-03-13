import type { SideSnapshot } from '../types';
import { PokemonCard } from './PokemonCard';

interface Props {
  side: SideSnapshot;
  isOpponent?: boolean;
}

function formatSideConditions(conditions: Record<string, unknown>): string[] {
  const labels: string[] = [];
  for (const [id, data] of Object.entries(conditions)) {
    const cond = data as { name: string; level: number };
    if (id === 'stealthrock') labels.push('Stealth Rock');
    else if (id === 'spikes') labels.push(`Spikes x${cond.level}`);
    else if (id === 'toxicspikes') labels.push(`T-Spikes x${cond.level}`);
    else if (id === 'stickyweb') labels.push('Sticky Web');
    else if (id === 'reflect') labels.push('Reflect');
    else if (id === 'lightscreen') labels.push('Light Screen');
    else if (id === 'auroraveil') labels.push('Aurora Veil');
    else if (id === 'tailwind') labels.push('Tailwind');
    else labels.push(cond.name || id);
  }
  return labels;
}

export function SideView({ side, isOpponent }: Props) {
  const activePokemon = side.pokemon.find(p => p.isActive);
  const benchPokemon = side.pokemon.filter(p => !p.isActive);
  const conditions = formatSideConditions(side.sideConditions);

  return (
    <div className={`${isOpponent ? 'mb-3' : 'mt-3'}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold text-gray-400">{side.name || side.id}</span>
        {conditions.length > 0 && (
          <div className="flex gap-1">
            {conditions.map(c => (
              <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Active Pokemon */}
      {activePokemon && (
        <PokemonCard pokemon={activePokemon} isOpponent={isOpponent} />
      )}

      {/* Bench */}
      <div className="mt-2 grid grid-cols-5 gap-1">
        {benchPokemon.map(p => (
          <PokemonCard key={p.name} pokemon={p} compact />
        ))}
      </div>
    </div>
  );
}
