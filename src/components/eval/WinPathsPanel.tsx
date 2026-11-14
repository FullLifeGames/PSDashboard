import { useState } from 'react';
import { lineAnchor, type LinesHost } from '../../lib/line-view';
import { winStepViews, type WinStepView } from '../../lib/win-paths-view';
import { LineConfirm } from './LineConfirm';
import { LineRows } from './LinesSection';

interface WinPathsPanelProps {
  host: LinesHost;
  playerNames: [string, string];
  doubles: boolean;
  /** The turn picker of the endgame's turns (the Game review's); the turn card searches its own turn and has none. */
  picker?: boolean;
}

function StepView({ view, turn, host, clicked, onClick }: { view: WinStepView; turn: number; host: LinesHost; clicked: boolean; onClick: () => void }) {
  const { block } = view;
  const { confirm, onPlay } = host;
  return (
    <div className="ps-eval-line-block ps-winpaths-step" data-step={view.kind}>
      <div className="ps-eval-line-head">
        <span className="ps-winpaths-step-title">{view.title}</span>
        {block && onPlay && (
          <button type="button" className="ps-btn ps-eval-inline-btn" title={block.tooltip} onClick={() => { onClick(); onPlay(block.line, turn); }}>
            ▶ Play
          </button>
        )}
      </div>
      {view.headline && <span className="ps-eval-line ps-winpaths-headline">{view.headline}</span>}
      {view.empty && <span className="ps-eval-line ps-winpaths-empty">{view.empty}</span>}
      {block && confirm && clicked && confirm.anchor === lineAnchor(block.line, turn) && <LineConfirm confirm={confirm} />}
      {block && <LineRows block={block} />}
      {block?.note && <span className="ps-eval-line">{block.note}</span>}
    </div>
  );
}

const STEP_COUNT = 3;

/** What the panel says while the job runs or after it broke. */
function statusLine(status: 'positioning' | 'searching' | 'done' | 'failed', turn: number, arrived: number): string | null {
  if (status === 'positioning') return `Rebuilding turn ${turn}…`;
  if (status === 'searching') return `Searching step ${Math.min(arrived + 1, STEP_COUNT)} of ${STEP_COUNT}…`;
  if (status === 'failed') return 'The search could not run.';
  return null;
}

/**
 * Round 89 (#130), step G8b: "How could <player> have won?". Under the Endgame row of the Game review and under the turn card of an
 * endgame turn. A picker names every turn of the endgame; the turn picked is searched when picked. The steps appear one by one in
 * the order the user ruled (a stronger play, luck, a mistake by the opponent); a step without a find says so in one sentence.
 * ▶ Play opens the line as a variation, with the dice it forces (the replace question stands under the step that was clicked).
 */
export function WinPathsPanel({ host, playerNames, doubles, picker = true }: WinPathsPanelProps) {
  const { winPaths } = host;
  const [clicked, setClicked] = useState<string | null>(null);
  const run = winPaths?.run;
  if (!winPaths || !run || !winPaths.endgame) return null;
  const { turns } = winPaths.endgame;
  const player = playerNames[run.side === 'p1' ? 0 : 1];
  const views = winStepViews(run.steps, { turn: run.turn, playerNames, doubles, host, side: run.side, playedLabel: winPaths.playedLabel(run.turn) });
  const status = statusLine(run.status, run.turn, run.steps.length);
  return (
    <div className="ps-winpaths" role="region" aria-label={`How could ${player} have won?`}>
      <div className="ps-eval-line-head">
        <span className="ps-eval-lines-title">How could {player} have won?</span>
        <button type="button" className="ps-btn ps-eval-inline-btn" onClick={winPaths.hide}>Close</button>
      </div>
      {picker && turns.length > 1 && (
        <div className="ps-winpaths-turns" role="group" aria-label="Endgame turn">
          {turns.map(turn => (
            <button key={turn} type="button" className="ps-btn ps-eval-inline-btn" aria-pressed={turn === run.turn} disabled={!!winPaths.unavailable} onClick={() => winPaths.show(turn)}>
              T{turn}
            </button>
          ))}
        </div>
      )}
      {status && <span className="ps-eval-line ps-winpaths-status" role="status">{status}</span>}
      {views.map(view => <StepView key={view.kind} view={view} turn={run.turn} host={host} clicked={clicked === view.kind} onClick={() => setClicked(view.kind)} />)}
    </div>
  );
}
