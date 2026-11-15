import type { LinesHost } from '../../lib/line-view';
import { WinPathsPanel } from './WinPathsPanel';

interface WinPathsEntryProps {
  turn: number;
  host: LinesHost;
  playerNames: [string, string];
  doubles: boolean;
}

/**
 * Round 89 (#130), step G8b (ruling W2b): the turn card of an endgame turn asks "How could <the player who lost> have won from
 * here?". The click searches this turn; the panel opens under the entry while its search is the open one.
 */
export function WinPathsEntry({ turn, host, playerNames, doubles }: WinPathsEntryProps) {
  const { winPaths } = host;
  const { endgame } = winPaths ?? {};
  if (!winPaths || !endgame || !endgame.turns.includes(turn)) return null;
  const player = playerNames[endgame.loser === 'p1' ? 0 : 1];
  const open = winPaths.run?.turn === turn;
  return (
    <div className="ps-eval-lines ps-winpaths-entry">
      <button
        type="button" className="ps-btn ps-eval-inline-btn" aria-expanded={open} disabled={!!winPaths.unavailable && !open}
        title={winPaths.unavailable ?? 'Search the position for a way the player could have won'}
        onClick={() => (open ? winPaths.hide() : winPaths.show(turn))}
      >
        How could {player} have won from here?
      </button>
      {open && <WinPathsPanel host={host} playerNames={playerNames} doubles={doubles} picker={false} />}
    </div>
  );
}
