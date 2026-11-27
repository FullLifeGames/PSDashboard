import type { LinesHost } from '../../lib/line-view';
import type { WinPathsQuestion } from '../../lib/win-paths-host';
import { CardToggle } from './CardToggle';
import { WinPathsPanel } from './WinPathsPanel';

interface WinPathsEntryProps {
  turn: number;
  host: LinesHost;
  playerNames: [string, string];
  doubles: boolean;
}

const PROOF_TITLE = 'Show the line of the forced win the engine proved from this position';
const LOST_TITLE = 'Search the position for a way the player could have won';

/** A toggle is open only while the open search is the card's own, for this turn and its question. */
export function WinPathsEntry({ turn, host, playerNames, doubles }: WinPathsEntryProps) {
  const { winPaths } = host;
  if (!winPaths) return null;
  const { offered, run, unavailable } = winPaths;
  const proof = winPaths.proofAt(turn);
  const lost = offered?.turns.includes(turn) ? offered.loser : null;
  const toggle = (question: WinPathsQuestion, label: string, title: string) => {
    const open = run?.turn === turn && run.from === 'card' && run.question === question;
    return (
      <div className="ps-eval-lines ps-winpaths-entry">
        <CardToggle
          label={label} lazy open={open} disabled={!!unavailable && !open} title={unavailable ?? title}
          onToggle={next => (next ? winPaths.show(turn, 'card', question) : winPaths.hide())}
        >
          <WinPathsPanel host={host} playerNames={playerNames} doubles={doubles} picker={false} from="card" question={question} />
        </CardToggle>
      </div>
    );
  };
  return (
    <>
      {proof && toggle('proof', `How does ${playerNames[proof.side === 'p1' ? 0 : 1]} win from here?`, PROOF_TITLE)}
      {lost && toggle('lost', `How could ${playerNames[lost === 'p1' ? 0 : 1]} have won from here?`, LOST_TITLE)}
    </>
  );
}
