import { Fragment } from 'react';
import type { EvalResult, TurnAnalysis } from '@fulllifegames/eval-engine';
import { gameReviewEnabled } from '../../lib/feature-flags';
import { LineConfirm } from './LineConfirm';
import { cardLines, neverActedOf, rowValueTexts } from './turn-copy';
import { linesForMode, worstLookup } from '../../lib/worst-reply';
import { activeNamesAt, differsSentences, lineAnchor, lineBlocks, ranksOf, READS_LINES_NOTE, REPLY_OFF_TOP_TITLE, type LineBlockView, type LinesHost, type LineSideView } from '../../lib/line-view';

interface LinesSectionProps {
  turn: number;
  result: EvalResult | null | undefined;
  playerNames: [string, string];
  doubles: boolean;
  host: LinesHost;
  analysis?: Pick<TurnAnalysis, 'p1' | 'p2'> | null;
}

function SideText({ view }: { view: LineSideView }) {
  const [first, ...rest] = view.text.split(' + ');
  return (
    <span className="ps-eval-line-side">
      <span className="ps-eval-line-lead"><span className="side">{view.player}</span> {first}</span>
      {rest.map((part, index) => <span key={`${index}-${part}`} className="ps-eval-line-part"> + {part}</span>)}
      {view.chips.map((chip, index) => <span key={`${index}-${chip}`} className="ps-lines-chip">{chip}</span>)}
    </span>
  );
}

export function LineRows({ block }: { block: LineBlockView }) {
  return (
    <>
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
    </>
  );
}

function LineBlock({ block, turn, onPlay, confirm }: { block: LineBlockView; turn: number; onPlay?: LinesHost['onPlay']; confirm?: LinesHost['confirm'] }) {
  return (
    <div className="ps-eval-line-block">
      <div className="ps-eval-line-head">
        <span style={{ color: '#cde' }}>{block.player} · {block.role}</span>
        {block.reply && (
          <span style={{ color: '#9ab' }} title={block.reply.off ? REPLY_OFF_TOP_TITLE : undefined}>{`vs ${block.reply.label} (${block.reply.rank})`}</span>
        )}
        {onPlay && (
          <button type="button" className="ps-btn ps-eval-inline-btn" title={block.tooltip} onClick={() => onPlay(block.line, turn, 'lines')}>
            ▶ Play
          </button>
        )}
        <span style={{ color: '#778' }}>{block.end}</span>
      </div>
      {confirm && confirm.anchor === lineAnchor(block.line, turn) && <LineConfirm confirm={confirm} />}
      <LineRows block={block} />
      {block.note && <span className="ps-eval-line">{block.note}</span>}
      {block.endNote && <span className="ps-eval-line">{block.endNote}</span>}
      {block.worstNote && <span className="ps-eval-line">{block.worstNote}</span>}
    </div>
  );
}

// A matrix turn ran no tree, so it cannot have kept lines.
function noLineSentence(result: EvalResult, coming: ReturnType<NonNullable<LinesHost['lineComing']>> = null): string {
  if (result.engine) return `No line: ${result.engine.name} sends none.`;
  if (coming === 'stage') return `No line yet: the app searches this turn after the game report${gameReviewEnabled() ? ' (the review shows the progress)' : ''}.`;
  if (coming === 'sweep') return 'No line yet: the game analysis is still running. If the report grades this turn, its lines follow the report.';
  if (result.matrix && !result.matrix.cells) return 'No line on this turn: the matrix pass keeps none. Analyze the position with MCTS to get lines.';
  return 'No line on this turn: the search kept none for these choices.';
}

export function LinesSection({ turn, result, playerNames, doubles, host, analysis }: LinesSectionProps) {
  if (!result) return null;
  const lines = linesForMode(cardLines(result.lines ?? [], analysis), !!host.hardMode);
  if (lines.length === 0) {
    return (
      <div className="ps-eval-lines-body">
        <span className="ps-eval-line" style={{ marginTop: 0 }}>
          {noLineSentence(result, host.lineComing?.(turn))}
        </span>
      </div>
    );
  }
  const blocks = lineBlocks(lines, { turn, playerNames, doubles, rules: host.rules, actives: activeNamesAt(host.snapshot), rowValues: rowValueTexts(analysis), neverActed: neverActedOf(analysis), ranks: ranksOf(result), ...(host.hardMode ? { worst: worstLookup(result, { p1: analysis?.p1.faintedFraction, p2: analysis?.p2.faintedFraction }) } : {}) });
  return (
    <div className="ps-eval-lines-body">
      {host.hardMode && <span className="ps-eval-line">{READS_LINES_NOTE}</span>}
      {blocks.map(block => <LineBlock key={block.key} block={block} turn={turn} onPlay={host.onPlay} confirm={host.confirm} />)}
      {differsSentences(blocks).map(sentence => <span key={sentence} className="ps-eval-line">{sentence}</span>)}
    </div>
  );
}
