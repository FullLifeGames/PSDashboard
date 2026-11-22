import { useState } from 'react';
import { SavedGamesList } from './SavedGamesList';
import { ShareLinkField } from './BranchSaveSharePanel';
import type { NewGameRecord } from '../lib/new-game/record';

/**
 * Round 89 (lane H, #105), stage H4b (user ruling 13.11.2026, H10b and H11a): the ways into a game besides a replay. The Game menu
 * holds them as its second and third part, the start page as its second panel under the loader's. The words are Showdown's and the
 * app's own ("Load", "New game", "Saved games"); every rule of the look is an existing app rule (new-game.css names each).
 */

export interface GameEntryProps {
  /** Opens the New game dialog. */
  onNewGame: () => void;
  /** Opens a saved game in the workspace. */
  onOpenGame: (record: NewGameRecord) => Promise<unknown> | void;
  /** The id of the game that is open now, if any. */
  currentGameId: string | null;
  /** The Game menu's share row: the link of the open game as it stands (its main line, the open variation, the turn on screen). Absent where no game is open. */
  onShareGame?: () => string | null;
}

function NewGameRow({ onNewGame, text }: { onNewGame: () => void; text: string }) {
  return (
    <div className="ps-entry-row">
      <span>{text}</span>
      <button type="button" className="ps-btn" onClick={onNewGame}>New game</button>
    </div>
  );
}

/** Copy Share Link for the open game, at every position of it: Team Preview, the main line, the tip, the end (ruling 31 H6a). */
function GameShareRow({ onShare }: { onShare: () => string | null }) {
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const next = onShare();
    if (!next) return;
    setLink(next);
    setCopied(false);
    try {
      await navigator.clipboard?.writeText(next);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <div className="ps-entry-row">
        <span>Share this game: a link that opens it at the turn on screen, with the open variation.</span>
        <button type="button" className="ps-btn" onClick={() => void copy()} title="Copies a link that opens this game and its open variation at this turn.">Copy Share Link</button>
      </div>
      {link && <ShareLinkField link={link} label="Game share link" />}
      {copied && <div style={{ marginTop: 4, fontSize: 10, color: '#8fd19e' }}>Copied to clipboard.</div>}
    </>
  );
}

/** The Game menu's second and third part, each behind a divider; the saved games leave out theirs when there are none. */
export function MenuGameParts({ onNewGame, onOpenGame, currentGameId, onShareGame }: GameEntryProps) {
  return (
    <>
      <div className="ps-entry-sep" />
      <NewGameRow onNewGame={onNewGame} text="Play both sides of a game from two team sheets." />
      {onShareGame && <GameShareRow onShare={onShareGame} />}
      <SavedGamesList onOpen={onOpenGame} currentId={currentGameId} divider />
    </>
  );
}

/** The start page's second panel: the New game button with its sentence, and the saved games under it. */
export function LandingGamesPanel({ onNewGame, onOpenGame, currentGameId }: GameEntryProps) {
  return (
    <div className="ps-panel ps-entry-landing" style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>New game</div>
      <NewGameRow onNewGame={onNewGame} text="Play both sides of a game from two team sheets. Paste both teams, pick the format, and the game starts at its first step: Team Preview, or turn 0 where the format has none." />
      <SavedGamesList onOpen={onOpenGame} currentId={currentGameId} />
    </div>
  );
}
