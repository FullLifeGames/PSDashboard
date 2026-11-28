import { useState } from 'react';
import { lineAnchor, type LinesHost } from '../../lib/line-view';
import type { WinPathsFrom, WinPathsHost, WinPathsQuestion, WinPathsRun } from '../../lib/win-paths-host';
import { sequenceNote, winStepViews, type WinStepView } from '../../lib/win-paths-view';
import { LineConfirm } from './LineConfirm';
import { LineRows } from './LinesSection';

interface WinPathsPanelProps {
  host: LinesHost;
  playerNames: [string, string];
  doubles: boolean;
  picker?: boolean;
  from?: WinPathsFrom;
  question?: WinPathsQuestion;
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

function statusLine(run: WinPathsRun): string | null {
  const { status, turn, steps } = run;
  if (status === 'positioning') return `Rebuilding turn ${turn}…`;
  if (status === 'searching') return run.question === 'proof' ? 'Searching for the proof\'s line…' : `Searching step ${Math.min(steps.length + 1, STEP_COUNT)} of ${STEP_COUNT}…`;
  if (status === 'failed') return 'The search could not run.';
  return null;
}

function PanelTurns({ turns, run, winPaths }: { turns: number[]; run: WinPathsRun; winPaths: WinPathsHost }) {
  if (turns.length < 2) return null;
  return (
    <div className="ps-winpaths-turns" role="group" aria-label="Endgame turn">
      {turns.map(turn => (
        <button key={turn} type="button" className="ps-btn ps-eval-inline-btn" aria-pressed={turn === run.turn} disabled={!!winPaths.unavailable} onClick={() => winPaths.show(turn, run.from)}>
          T{turn}
        </button>
      ))}
    </div>
  );
}

const titleOf = (question: WinPathsQuestion, player: string): string => (question === 'proof' ? `How does ${player} win?` : `How could ${player} have won?`);

function viewsOf(run: WinPathsRun, question: WinPathsQuestion, winPaths: WinPathsHost, props: Pick<WinPathsPanelProps, 'host' | 'playerNames' | 'doubles'>): WinStepView[] {
  const { turn, side } = run;
  return winStepViews(run.steps, {
    ...props, turn, side, question, turns: question === 'proof' ? winPaths.proofAt(turn)?.turns : undefined,
    playedLabel: winPaths.playedLabel(turn, side), playedNeverActed: winPaths.playedNeverActed?.(turn, side),
  });
}

export function WinPathsPanel({ host, playerNames, doubles, picker = true, from = 'review', question = 'lost' }: WinPathsPanelProps) {
  const { winPaths } = host;
  const [clicked, setClicked] = useState<string | null>(null);
  const run = winPaths?.run;
  if (!winPaths || !run || run.from !== from || run.question !== question) return null;
  const { turn, side } = run;
  const player = playerNames[side === 'p1' ? 0 : 1];
  const views = viewsOf(run, question, winPaths, { host, playerNames, doubles });
  const note = sequenceNote(views);
  const status = statusLine(run);
  const title = titleOf(question, player);
  return (
    <div className="ps-winpaths" role="region" aria-label={title}>
      <div className="ps-eval-line-head">
        <span className="ps-eval-lines-title">{title}</span>
        <button type="button" className="ps-btn ps-eval-inline-btn" onClick={winPaths.hide}>Close</button>
      </div>
      {picker && <PanelTurns turns={winPaths.endgame?.turns ?? []} run={run} winPaths={winPaths} />}
      {status && <span className="ps-eval-line ps-winpaths-status" role="status">{status}</span>}
      {views.map(view => <StepView key={view.kind} view={view} turn={turn} host={host} clicked={clicked === view.kind} onClick={() => setClicked(view.kind)} />)}
      {note && <span className="ps-eval-line">{note}</span>}
    </div>
  );
}
