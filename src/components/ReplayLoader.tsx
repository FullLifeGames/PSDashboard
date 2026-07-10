import { useState } from 'react';
import { parseTeamText } from '../lib/team-parser';

interface Props {
  onLoad: (url: string) => void;
  onTeamLoad: (teamText: string) => void;
  loading: boolean;
  error: string | null;
  teamStatus?: string | null;
  teamError?: string | null;
  showGuide?: boolean;
}

export function ReplayLoader({ onLoad, onTeamLoad, loading, error, teamStatus = null, teamError = null, showGuide = false }: Props) {
  const [url, setUrl] = useState('https://replay.pokemonshowdown.com/gen9draft-2298735122');
  const [teamText, setTeamText] = useState('');

  return (
    <div className="ps-panel" style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>Load Replay</div>

      <form
        style={{ display: 'flex', gap: 6, marginBottom: 8 }}
        onSubmit={event => {
          event.preventDefault();
          if (!loading) onLoad(url);
        }}
      >
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Replay URL or ID"
          aria-label="Replay URL or ID"
          className="ps-input"
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          disabled={loading}
          className="ps-btn ps-btn-red"
        >
          {loading ? 'Loading…' : 'Load'}
        </button>
      </form>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 8, fontSize: 12, color: '#f3a6a6',
            background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.25)',
            borderRadius: 4, padding: '6px 10px',
          }}
        >
          {error}
        </div>
      )}

      {showGuide && (
        <div className="ps-loader-guide" aria-label="Replay branching workflow">
          <div className="ps-guide-step">
            <span>1</span>
            <strong>Pick a branch turn</strong>
            <small>Scrub the real Showdown replay to the exact decision point.</small>
          </div>
          <div className="ps-guide-step">
            <span>2</span>
            <strong>Choose both sides</strong>
            <small>Use recommendations, custom choices, switches, or edited team data.</small>
          </div>
          <div className="ps-guide-step">
            <span>3</span>
            <strong>Compare outcomes</strong>
            <small>Inspect the original line beside your alternate branch history.</small>
          </div>
        </div>
      )}

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 11, color: '#8899aa' }}>
          Paste your team (for branching with full movesets)
          {teamStatus && <span style={{ marginLeft: 6, color: '#6c6', fontSize: 10 }}>{teamStatus}</span>}
        </summary>
        <textarea
          value={teamText}
          onChange={e => setTeamText(e.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              onTeamLoad(parseTeamText(teamText));
            }
          }}
          placeholder="Paste PS team export here (supports German stat names) — Ctrl+Enter saves"
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
        {teamError && (
          <div
            role="alert"
            style={{
              marginTop: 6, fontSize: 11, color: '#f3a6a6',
              background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.25)',
              borderRadius: 4, padding: '5px 8px',
            }}
          >
            {teamError}
          </div>
        )}
      </details>
    </div>
  );
}
