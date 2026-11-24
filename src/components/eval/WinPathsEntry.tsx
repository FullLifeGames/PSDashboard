import type { LinesHost } from '../../lib/line-view';
import { CardToggle } from './CardToggle';
import { WinPathsPanel } from './WinPathsPanel';

interface WinPathsEntryProps {
  turn: number;
  host: LinesHost;
  playerNames: [string, string];
  doubles: boolean;
}

/**
 * The turn card of an endgame turn asks "How could <the player who lost> have won from here?" in a toggle that starts closed on every
 * turn; it is open only while the open search is the card's own, for this turn (a search the Game review opened shows in the review).
 */
export function WinPathsEntry({ turn, host, playerNames, doubles }: WinPathsEntryProps) {
  const { winPaths } = host;
  const { endgame } = winPaths ?? {};
  if (!winPaths || !endgame || !endgame.turns.includes(turn)) return null;
  const player = playerNames[endgame.loser === 'p1' ? 0 : 1];
  const open = winPaths.run?.turn === turn && winPaths.run.from === 'card';
  return (
    <div className="ps-eval-lines ps-winpaths-entry">
      <CardToggle
        label={`How could ${player} have won from here?`} lazy open={open} disabled={!!winPaths.unavailable && !open}
        title={winPaths.unavailable ?? 'Search the position for a way the player could have won'}
        onToggle={next => (next ? winPaths.show(turn, 'card') : winPaths.hide())}
      >
        <WinPathsPanel host={host} playerNames={playerNames} doubles={doubles} picker={false} from="card" />
      </CardToggle>
    </div>
  );
}
