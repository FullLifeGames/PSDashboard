import { useState } from 'react';
import { parseTeamText } from '../lib/team-parser';

interface Props {
  onLoad: (url: string) => void;
  onTeamLoad: (teamText: string) => void;
  loading: boolean;
  error: string | null;
  teamLoaded: boolean;
}

export function ReplayLoader({ onLoad, onTeamLoad, loading, error, teamLoaded }: Props) {
  const [url, setUrl] = useState('https://replay.pokemonshowdown.com/gen9draft-2298735122');
  const [teamText, setTeamText] = useState('');

  return (
    <div className="bg-[#16213e] rounded-xl p-6 mb-6">
      <h2 className="text-xl font-bold mb-4">Load Replay</h2>
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Replay URL or ID"
          className="flex-1 bg-[#0f3460] border border-[#1a1a5e] rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[#e94560]"
        />
        <button
          onClick={() => onLoad(url)}
          disabled={loading}
          className="bg-[#e94560] hover:bg-[#d63851] disabled:opacity-50 px-6 py-2 rounded-lg font-semibold transition-colors"
        >
          {loading ? 'Loading...' : 'Load'}
        </button>
      </div>

      <details className="mb-2">
        <summary className="cursor-pointer text-gray-400 hover:text-white text-sm">
          Paste your team (for branching with full movesets)
          {teamLoaded && <span className="ml-2 text-green-400 text-xs">Team loaded</span>}
        </summary>
        <textarea
          value={teamText}
          onChange={e => setTeamText(e.target.value)}
          placeholder="Paste PS team export here (supports German stat names)"
          rows={8}
          className="w-full mt-2 bg-[#0f3460] border border-[#1a1a5e] rounded-lg px-4 py-2 text-white text-sm font-mono placeholder-gray-500 focus:outline-none focus:border-[#e94560] resize-y"
        />
        <button
          onClick={() => onTeamLoad(parseTeamText(teamText))}
          className="mt-2 bg-[#0f3460] hover:bg-[#1a1a5e] px-4 py-1.5 rounded text-sm transition-colors"
        >
          Save Team
        </button>
      </details>

      {error && (
        <div className="mt-3 text-[#e94560] text-sm bg-[#e9456020] rounded-lg px-4 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
