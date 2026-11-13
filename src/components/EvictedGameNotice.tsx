import { useEffect, useState } from 'react';
import { onGameEvicted, type SavedGameRow } from '../lib/new-game/store';

/**
 * Round 89 (lane H, #105), H15a (user ruling 13.11.2026): the store keeps 20 games; a save over the limit pushes one out (first a game
 * without a played turn, then the oldest) and this line names it, in the words of the saved list's row, until the user dismisses it.
 */
const describeRow = (row: SavedGameRow): string => {
  const played = row.turns === 0 ? 'no turn played' : `${row.turns} ${row.turns === 1 ? 'turn' : 'turns'} played`;
  return `${row.players[0]} vs ${row.players[1]} (${row.formatName}, ${played})`;
};

export function EvictedGameNotice() {
  const [gone, setGone] = useState<SavedGameRow[]>([]);
  useEffect(() => onGameEvicted(rows => setGone(held => [...held, ...rows])), []);
  if (gone.length === 0) return null;
  return (
    <div className="ps-entry-notice" role="status">
      The browser keeps 20 saved games. {gone.map(describeRow).join(' and ')} {gone.length === 1 ? 'was' : 'were'} removed to make room.
      <button type="button" className="ps-btn ps-newgame-small" style={{ marginLeft: 8 }} onClick={() => setGone([])}>Dismiss</button>
    </div>
  );
}
