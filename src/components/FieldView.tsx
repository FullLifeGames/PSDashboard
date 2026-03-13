import type { FieldSnapshot } from '../types';

interface Props {
  field: FieldSnapshot;
}

export function FieldView({ field }: Props) {
  const { weather, terrain, pseudoWeather } = field;
  const hasAnything = weather || terrain || Object.keys(pseudoWeather).length > 0;

  if (!hasAnything) return null;

  return (
    <div className="flex items-center justify-center gap-2 py-2">
      {weather && (
        <span className="text-xs px-2 py-1 rounded-full bg-sky-900/60 text-sky-300 border border-sky-700">
          {weather}
        </span>
      )}
      {terrain && (
        <span className="text-xs px-2 py-1 rounded-full bg-emerald-900/60 text-emerald-300 border border-emerald-700">
          {terrain} Terrain
        </span>
      )}
      {Object.entries(pseudoWeather).map(([id, data]) => (
        <span key={id} className="text-xs px-2 py-1 rounded-full bg-violet-900/60 text-violet-300 border border-violet-700">
          {(data as { id: string }).id || id}
        </span>
      ))}
    </div>
  );
}
