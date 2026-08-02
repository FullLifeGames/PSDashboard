import type { GameReport } from '../lib/eval/report';
import { attributionBadge } from './eval-badges';

interface EvalGameReportProps {
  report: GameReport;
  playerNames: [string, string];
  onSelectTurn?: (turn: number) => void;
}

const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

/** Game-level story from a completed sweep: the tip, the seeds, the key moments. */
export function EvalGameReport({ report, playerNames, onSelectTurn }: EvalGameReportProps) {
  return (
    <div className="ps-eval-report">
      <div className="ps-eval-analysis-row">
        <span style={{ fontWeight: 'bold', fontSize: 11, color: '#cde' }}>Game report</span>
      </div>
      <div className="ps-eval-analysis-summary">{report.summary}</div>
      {report.keyMoments.length > 0 && (
        <div className="ps-eval-report-moments">
          {report.keyMoments.map(moment => {
            const badge = attributionBadge(moment, playerNames);
            return (
              <button
                key={moment.turn}
                type="button"
                className="ps-btn ps-eval-report-moment"
                onClick={() => onSelectTurn?.(moment.turn)}
                title="Jump to this turn's analysis"
              >
                <span style={{ color: '#cde' }}>T{moment.turn}</span>
                <span style={{ color: badge.color }}>{badge.text}</span>
                {moment.swing !== null && <span style={{ color: '#aab' }}>{signed(moment.swing)}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
