import { useState } from 'react';
import { SavedGamesList } from './SavedGamesList';
import { ShareLinkField } from './BranchSaveSharePanel';
import type { NewGameRecord } from '../lib/new-game/record';

export interface GameEntryProps {
  onNewGame: () => void;
  onOpenGame: (record: NewGameRecord) => Promise<unknown> | void;
  currentGameId: string | null;
  /** The link of the open game as it stands (main line, open variation, turn on screen); absent where no game is open. */
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

export function LandingGamesPanel({ onNewGame, onOpenGame, currentGameId }: GameEntryProps) {
  return (
    <div className="ps-panel ps-entry-landing" style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>New game</div>
      <NewGameRow onNewGame={onNewGame} text="Play both sides of a game from two team sheets. Paste both teams, pick the format, and the game starts at its first step: Team Preview, or turn 0 where the format has none." />
      <SavedGamesList onOpen={onOpenGame} currentId={currentGameId} />
    </div>
  );
}
