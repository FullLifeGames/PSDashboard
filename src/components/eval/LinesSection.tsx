import { Fragment } from 'react';
import type { EvalResult, TurnAnalysis } from '@fulllifegames/eval-engine';
import { LineConfirm } from './LineConfirm';
import { cardLines } from './turn-copy';
import { activeNamesAt, lineAnchor, lineBlocks, type LineBlockView, type LinesHost, type LineSideView } from '../../lib/line-view';

interface LinesSectionProps {
  turn: number;
  result: EvalResult | null | undefined;
  playerNames: [string, string];
  doubles: boolean;
  host: LinesHost;
  /** The turn card's analysis: the engine's line is the line of the engine choice the card names. */
  analysis?: Pick<TurnAnalysis, 'p1' | 'p2'> | null;
}

function SideText({ view }: { view: LineSideView }) {
  return (
    <>
      <span className="side">{view.player}</span> {view.text}
      {view.chips.map((chip, index) => <span key={`${index}-${chip}`} className="ps-line-chip">{chip}</span>)}
    </>
  );
}

function LineBlock({ block, turn, onPlay, confirm }: { block: LineBlockView; turn: number; onPlay?: LinesHost['onPlay']; confirm?: LinesHost['confirm'] }) {
  return (
    <div className="ps-eval-line-block">
      <div className="ps-eval-line-head">
        <span style={{ color: '#cde' }}>{block.player} · {block.role}</span>
        {onPlay && (
          <button type="button" className="ps-btn ps-eval-inline-btn" title={block.tooltip} onClick={() => onPlay(block.line, turn)}>
            ▶ Play
          </button>
        )}
        <span style={{ color: '#778' }}>{block.end}</span>
      </div>
      {confirm && confirm.anchor === lineAnchor(block.line, turn) && <LineConfirm confirm={confirm} />}
      {block.rows.map(row => (
        <div key={row.key} className="ps-eval-line-turn">
          <span className="t">{row.turn}</span>
          <span>
            {row.sides.map((view, index) => (
              <Fragment key={view.side}>{index > 0 && ' · '}<SideText view={view} /></Fragment>
            ))}
          </span>
        </div>
      ))}
      {block.note && <span className="ps-eval-line">{block.note}</span>}
    </div>
  );
}

/**
 * Why a turn holds no line. A matrix turn (a result with a matrix and no tree cells) ran no tree, so it cannot have kept lines;
 * a tree search that kept none says so of the search.
 */
function noLineSentence(result: EvalResult): string {
  if (result.engine) return `No line: ${result.engine.name} sends none.`;
  if (result.matrix && !result.matrix.cells) return 'No line on this turn: the matrix pass keeps none. Analyze the position with MCTS to get lines.';
  return 'No line on this turn: the search kept none for these choices.';
}

/**
 * Round 89 (#104), step G3: the Lines section under a turn's rows. Per player the engine's line and the played line (one line for a
 * player who played the engine's move), each with ▶ Play, the end value and the dice that could have gone the other way. A turn
 * that holds no line says why in one muted sentence; a turn without a result shows nothing.
 */
export function LinesSection({ turn, result, playerNames, doubles, host, analysis }: LinesSectionProps) {
  if (!result) return null;
  const lines = cardLines(result.lines ?? [], analysis);
  if (lines.length === 0) {
    return (
      <div className="ps-eval-lines">
        <span className="ps-eval-lines-title">Lines</span>
        <span className="ps-eval-line" style={{ marginTop: 0 }}>
          {noLineSentence(result)}
        </span>
      </div>
    );
  }
  const blocks = lineBlocks(lines, { turn, playerNames, doubles, rules: host.rules, actives: activeNamesAt(host.snapshot) });
  return (
    <div className="ps-eval-lines">
      <span className="ps-eval-lines-title">Lines</span>
      {blocks.map(block => <LineBlock key={block.key} block={block} turn={turn} onPlay={host.onPlay} confirm={host.confirm} />)}
    </div>
  );
}
