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
      {report.misplays.length > 0 && (
        <div className="ps-eval-report-moments">
          {report.misplays.map(misplay => {
            const tone = misplay.riskUnpunished ? '#b6a46a' : '#f3a6a6';
            return (
              <button
                key={`${misplay.turn}-${misplay.side}`}
                type="button"
                className="ps-btn ps-eval-report-moment"
                onClick={() => onSelectTurn?.(misplay.turn)}
                title={misplay.riskUnpunished
                  ? "The engine's floor priced in a reply that never came — jump to this turn's analysis"
                  : "Jump to this turn's analysis"}
              >
                <span style={{ color: '#cde' }}>T{misplay.turn}</span>
                <span style={{ color: tone }}>{playerNames[misplay.side === 'p1' ? 0 : 1]}</span>
                <span style={{ color: '#aab' }}>{misplay.played}</span>
                {misplay.riskUnpunished
                  ? <span style={{ color: tone }}>risk (unpunished)</span>
                  : <span style={{ color: '#778' }}>better: {misplay.better}</span>}
                <span style={{ color: tone }}>−{misplay.regret.toFixed(2)}</span>
              </button>
            );
          })}
          {report.tracked && (['p1', 'p2'] as const)
            .filter(side => !report.misplays.some(misplay => misplay.side === side))
            .map(side => (
              <span key={side} style={{ color: '#778', fontSize: 10, alignSelf: 'center' }}>
                {playerNames[side === 'p1' ? 0 : 1]}: no clear misplays
              </span>
            ))}
        </div>
      )}
      {report.reads.length > 0 && (
        <div className="ps-eval-report-moments">
          {report.reads.map(read => (
            <button
              key={`${read.turn}-${read.side}`}
              type="button"
              className="ps-btn ps-eval-report-moment"
              onClick={() => onSelectTurn?.(read.turn)}
              title="A risk whose read won value — jump to this turn's analysis"
            >
              <span style={{ color: '#cde' }}>T{read.turn}</span>
              <span style={{ color: '#8c8' }}>{playerNames[read.side === 'p1' ? 0 : 1]}</span>
              <span style={{ color: '#aab' }}>{read.played}</span>
              <span style={{ color: '#8c8' }}>read paid off +{read.payoff.toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}
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
