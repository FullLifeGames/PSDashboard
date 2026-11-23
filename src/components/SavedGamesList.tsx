import { useRef, useState } from 'react';
import { deleteGame, listGames, loadGame, type SavedGameRow } from '../lib/new-game/store';
import type { NewGameRecord } from '../lib/new-game/record';

/**
 * The saved games as rows with Open and Delete, in the Game menu and on the start page: the three newest show, "Show all N saved games"
 * unfolds the rest (the store keeps 20). Delete asks once in the row; the open game cannot be deleted from under itself.
 */

const SHOWN = 3;

/**
 * After a delete the rows below move up and the next row's Open lands under the pointer; the second click of a double click on the confirm's
 * red Delete would open that game. An Open within this time of a delete is not a deliberate click.
 */
const AFTER_DELETE_MS = 600;

interface Props {
  onOpen: (record: NewGameRecord) => Promise<unknown> | void;
  currentId: string | null;
  divider?: boolean;
}

const dateOf = (iso: string): string => {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function Row({ row, currentId, asking, busy, setAsking, onOpen, onDelete }: {
  row: SavedGameRow; currentId: string | null; asking: string | null; busy: boolean;
  setAsking: (id: string | null) => void; onOpen: (id: string) => void; onDelete: (id: string) => void;
}) {
  return (
    <div className="ps-newgame-saved-row">
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
      {row.seed && <span className="ps-entry-seed">Seed <code>{row.seed}</code></span>}
    </div>
  );
}

export function SavedGamesList({ onOpen, currentId, divider = false }: Props) {
  const [rows, setRows] = useState(listGames);
  const [all, setAll] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deletedAt = useRef(0);
  if (rows.length === 0) return null;
  const open = async (id: string) => {
    if (Date.now() - deletedAt.current < AFTER_DELETE_MS) return;
    const record = loadGame(id);
    if (!record) {
      setError('That saved game could not be read.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onOpen(record);
    } catch (failure) {
      setError(`The game could not open: ${messageOf(failure)}`);
    } finally {
      setBusy(false);
    }
  };
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <>
    {divider && <div className="ps-entry-sep" />}
    <div className="ps-newgame-saved">
      <div className="ps-entry-head">Saved games</div>
      {shown.map(row => (
        <Row key={row.id} row={row} currentId={currentId} asking={asking} busy={busy} setAsking={setAsking} onOpen={id => void open(id)} onDelete={id => { deletedAt.current = Date.now(); setRows(deleteGame(id)); }} />
      ))}
      {error && <div className="ps-newgame-error" role="alert">{error}</div>}
      {!all && rows.length > SHOWN && (
        <div className="ps-entry-more">
          <button type="button" className="ps-support-link" onClick={() => setAll(true)}>Show all {rows.length} saved games</button>
        </div>
      )}
    </div>
    </>
  );
}
