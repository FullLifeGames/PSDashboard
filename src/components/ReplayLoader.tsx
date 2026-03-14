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
    <div className="ps-panel" style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>Load Replay</div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Replay URL or ID"
          className="ps-input"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={() => onLoad(url)}
          disabled={loading}
          className="ps-btn ps-btn-red"
        >
          {loading ? 'Loading…' : 'Load'}
        </button>
      </div>

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 11, color: '#8899aa' }}>
          Paste your team (for branching with full movesets)
          {teamLoaded && <span style={{ marginLeft: 6, color: '#6c6', fontSize: 10 }}>Team loaded</span>}
        </summary>
        <textarea
          value={teamText}
          onChange={e => setTeamText(e.target.value)}
          placeholder="Paste PS team export here (supports German stat names)"
          rows={6}
          className="ps-input"
          style={{ width: '100%', marginTop: 6, fontFamily: 'Consolas, monospace', fontSize: 11, resize: 'vertical' }}
        />
        <button
          type="button"
          onClick={() => onTeamLoad(parseTeamText(teamText))}
          className="ps-btn"
          style={{ marginTop: 4, fontSize: 10 }}
        >
          Save Team
        </button>
      </details>

      {error && (
        <div style={{
          marginTop: 8, fontSize: 11, color: '#f88',
          background: 'rgba(255,80,80,0.1)', borderRadius: 4, padding: '6px 10px',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
