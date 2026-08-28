import { useRef, useState } from 'react';
import { parseTeamText } from '../lib/team-parser';

interface Props {
  onLoad: (url: string) => void;
  onLoadFile: (content: string, fileName?: string) => void;
  onTeamLoad: (teamText: string) => void;
  loading: boolean;
  error: string | null;
  /** Canonical link of the replay that is currently loaded — mirrored into the input. */
  loadedUrl?: string | null;
  teamStatus?: string | null;
  teamError?: string | null;
  showGuide?: boolean;
}

export function ReplayLoader({ onLoad, onLoadFile, onTeamLoad, loading, error, loadedUrl = null, teamStatus = null, teamError = null, showGuide = false }: Props) {
  const [url, setUrl] = useState('https://replay.pokemonshowdown.com/gen9draft-2058494320');

  // Once a replay is loaded the input shows ITS link, not the default or a
  // stale draft — a replay can arrive through share links, files, or embed
  // messages, not just typing here. Mirrored during render (the React-docs
  // adjust-state-when-a-prop-changes form) rather than in an effect, which
  // react-hooks/set-state-in-effect forbids.
  const [mirroredUrl, setMirroredUrl] = useState<string | null>(null);
  if (loadedUrl !== mirroredUrl) {
    setMirroredUrl(loadedUrl);
    if (loadedUrl) setUrl(loadedUrl);
  }
  const [teamText, setTeamText] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readReplayFile = (file: File | null | undefined) => {
    if (!file || loading) return;
    void file.text().then(content => onLoadFile(content, file.name));
  };

  return (
    <div
      className="ps-panel"
      style={{
        marginBottom: 8,
        outline: dragActive ? '2px dashed #8cf' : 'none',
        outlineOffset: -2,
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={event => {
        event.preventDefault();
        setDragActive(false);
        readReplayFile(event.dataTransfer.files?.[0]);
      }}
    >
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 11, color: '#8899aa' }}>
        <span>… or drop an exported replay (.html) anywhere in this panel</span>
        <button
          type="button"
          className="ps-btn"
          disabled={loading}
          onClick={() => fileInputRef.current?.click()}
          style={{ padding: '2px 8px', fontSize: 10 }}
        >
          Browse file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".html,.htm,.log,.txt"
          aria-label="Load exported replay file"
          style={{ display: 'none' }}
          onChange={event => {
            readReplayFile(event.target.files?.[0]);
            // Allow picking the same file again after an error.
            event.target.value = '';
          }}
        />
      </div>

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
        <div className="ps-loader-guide" aria-label="Unified timeline workflow">
          <div className="ps-guide-step">
            <span>1</span>
            <strong>Find the decision point</strong>
            <small>Scrub the timeline to any turn; the move pickers are always there.</small>
          </div>
          <div className="ps-guide-step">
            <span>2</span>
            <strong>Play a different move</strong>
            <small>Pick for both sides (the played move is marked) and a gold variation branches off, like in a chess engine.</small>
          </div>
          <div className="ps-guide-step">
            <span>3</span>
            <strong>Compare the lines</strong>
            <small>Evaluate positions, let the engine play it out, and hop between main line and variation with one click.</small>
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
          placeholder="Paste PS team export here (supports German stat names). Ctrl+Enter saves"
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
