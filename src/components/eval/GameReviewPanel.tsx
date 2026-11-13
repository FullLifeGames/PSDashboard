import { useMemo } from 'react';
import type { EvalResult, TurnAnalysis } from '@fulllifegames/eval-engine';
import { lineAnchor, type LinesHost } from '../../lib/line-view';
import { LineConfirm } from './LineConfirm';
import { gameReview, type ReviewGrade, type ReviewLineView, type ReviewRowView, type ReviewSideView } from './game-review';

interface GameReviewPanelProps {
  analyses: readonly (TurnAnalysis | null)[];
  /** The sweep's result of every turn (`graph.results`): the lines of a row come from its turn's result. */
  results: readonly (EvalResult | null | undefined)[];
  playerNames: [string, string];
  doubles: boolean;
  host: LinesHost;
  onSelectTurn?: (turn: number) => void;
}

/** The grades' colours of the turn card (SideRow). */
const GRADE_COLORS: Record<ReviewGrade, string> = { inaccuracy: '#b6a46a', mistake: '#f3a6a6', blunder: '#ff7a7a' };

function ReviewLine({ line, turn, onPlay, confirm }: { line: ReviewLineView; turn: number; onPlay: LinesHost['onPlay']; confirm?: LinesHost['confirm'] }) {
  return (
    <>
      <div className="ps-eval-review-line">
        <span className="role">{line.role}:</span>
        <span className="text">{line.text}</span>
        {onPlay && (
          <button type="button" className="ps-btn ps-eval-inline-btn" title={line.block.tooltip} onClick={() => onPlay(line.block.line, turn)}>
            ▶ Play
          </button>
        )}
      </div>
      {confirm && confirm.anchor === lineAnchor(line.block.line, turn) && <LineConfirm confirm={confirm} />}
    </>
  );
}

function ReviewRow({ row, onPlay, confirm, onSelectTurn }: { row: ReviewRowView; onPlay: LinesHost['onPlay']; confirm?: LinesHost['confirm']; onSelectTurn?: (turn: number) => void }) {
  return (
    <div className="ps-eval-review-row">
      <div className="ps-eval-review-head">
        <button type="button" className="ps-btn ps-eval-inline-btn" title="Open this turn's analysis" onClick={() => onSelectTurn?.(row.turn)}>
          T{row.turn}
        </button>
        <span style={{ color: GRADE_COLORS[row.grade] }} title={row.lossTitle}>{row.grade} · {row.loss}</span>
        <span style={{ color: '#aab' }}>played {row.played}</span>
        <span style={{ color: '#778' }}>{row.engineWord} {row.engine}</span>
      </div>
      {row.lines.length === 0
        ? <div className="ps-eval-review-line"><span className="text" style={{ color: '#667' }}>no line</span></div>
        : row.lines.map(line => <ReviewLine key={line.key} line={line} turn={row.turn} onPlay={onPlay} confirm={confirm} />)}
    </div>
  );
}

function ReviewSide({ view, onPlay, confirm, onSelectTurn }: { view: ReviewSideView; onPlay: LinesHost['onPlay']; confirm?: LinesHost['confirm']; onSelectTurn?: (turn: number) => void }) {
  return (
    <div className="ps-eval-review-side" role="group" aria-label={view.player}>
      <div className="name">{view.player}</div>
      {view.rows.length === 0
        ? <span className="ps-eval-line" style={{ marginTop: 0 }}>{view.player}: no inaccuracy, mistake or blunder.</span>
        : view.rows.map(row => <ReviewRow key={row.key} row={row} onPlay={onPlay} confirm={confirm} onSelectTurn={onSelectTurn} />)}
    </div>
  );
}

/**
 * Round 89 (#104), step G4 (ruling 33, 4a): the Game review under the game report. One list per player of the turns the cards
 * grade, with the played and the engine's value, the loss, the engine's line and the played line, each with ▶ Play, and a
 * button that opens the turn. The graph marks the same turns.
 */
export function GameReviewPanel({ analyses, results, playerNames, doubles, host, onSelectTurn }: GameReviewPanelProps) {
  const sides = useMemo(
    () => gameReview({ analyses, results, playerNames, doubles, host }),
    [analyses, results, playerNames, doubles, host],
  );
  return (
    <div className="ps-eval-review">
      <span className="ps-eval-lines-title">Game review · what the engine would have played</span>
      {sides.map(view => <ReviewSide key={view.side} view={view} onPlay={host.onPlay} confirm={host.confirm} onSelectTurn={onSelectTurn} />)}
    </div>
  );
}
