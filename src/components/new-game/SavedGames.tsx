import { useState } from 'react';
import type { SavedGameRow } from '../../lib/new-game/store';

/**
 * Round 89 (lane H, #105), stage H4: the saved games of the New game dialog, one row each as the saved branches show theirs: the
 * format, the two names, the turns played, the last save, the dice seed, Open and Delete. Delete asks once in the row (the viewer
 * never shows the browser's confirm in some hosts, so the app's own inline confirm stands here, red button as the replace confirm).
 * The game that is open now cannot be deleted from under itself: its row says so.
 */

interface Props {
  rows: readonly SavedGameRow[];
  /** The id of the game that is open in the workspace, if any. */
  currentId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}

const dateOf = (iso: string): string => {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
};

export function SavedGames({ rows, currentId, onOpen, onDelete, busy }: Props) {
  const [asking, setAsking] = useState<string | null>(null);
  if (rows.length === 0) return null;
  return (
    <div className="ps-newgame-saved">
      <div className="ps-newgame-saved-title">Saved games</div>
      {rows.map(row => (
        <div key={row.id} className="ps-newgame-saved-row">
          <span className="ps-newgame-saved-match">
            <span className="ps-format-tag" title={row.formatName}>{row.formatName}</span>
            <span className="ps-newgame-saved-players">
              <span className="ps-player" title={row.players[0]} style={{ fontSize: 11, color: '#8ac' }}>{row.players[0]}</span>
              <span style={{ fontSize: 10, color: '#556', flexShrink: 0 }}>vs</span>
              <span className="ps-player" title={row.players[1]} style={{ fontSize: 11, color: '#c8a' }}>{row.players[1]}</span>
            </span>
          </span>
          <span className="ps-newgame-saved-meta">
            <span>{row.turns} {row.turns === 1 ? 'turn' : 'turns'} played</span>
            <span className="ps-newgame-date">{dateOf(row.updatedAt)}</span>
            {row.seed && <span className="ps-newgame-seed-tag" title="Dice seed">seed {row.seed}</span>}
            {asking === row.id ? (
              <>
                <span className="ps-newgame-saved-confirm" role="alertdialog" aria-label="Delete this saved game?">Delete this game?</span>
                <button type="button" className="ps-btn ps-btn-red ps-newgame-small" onClick={() => { setAsking(null); onDelete(row.id); }}>Delete</button>
                <button type="button" className="ps-btn ps-newgame-small" onClick={() => setAsking(null)}>Keep</button>
              </>
            ) : row.id === currentId ? (
              <span>open now</span>
            ) : (
              <>
                <button type="button" className="ps-btn ps-newgame-small" disabled={busy} onClick={() => onOpen(row.id)}>Open</button>
                <button type="button" className="ps-btn ps-newgame-small" aria-label="Delete saved game" onClick={() => setAsking(row.id)}>Delete</button>
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
