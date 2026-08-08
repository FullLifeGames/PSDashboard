import type { GameReport } from '../lib/eval/report';
import type { LeadAnalysis } from '../lib/eval/leads';
import { attributionBadge } from './eval-badges';

interface EvalGameReportProps {
  report: GameReport;
  playerNames: [string, string];
  onSelectTurn?: (turn: number) => void;
  /** Turn-0 verdicts — a T0 chip appears for mistake-level lead choices. */
  leads?: LeadAnalysis | null;
}

const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

/** Game-level story from a completed sweep: the tip, the seeds, the key moments. */
export function EvalGameReport({ report, playerNames, onSelectTurn, leads }: EvalGameReportProps) {
  const leadMisplays = leads
    ? (['p1', 'p2'] as const).filter(side =>
      leads[side].tier === 'mistake' || leads[side].tier === 'blunder')
    : [];
  return (
    <div className="ps-eval-report">
      <div className="ps-eval-analysis-row">
        <span style={{ fontWeight: 'bold', fontSize: 11, color: '#cde' }}>Game report</span>
      </div>
      <div className="ps-eval-analysis-summary">{report.summary}</div>
      {report.accuracy && (report.accuracy.p1 !== null || report.accuracy.p2 !== null) && (
        <div
          className="ps-eval-analysis-row"
          style={{ fontSize: 10, color: '#aab' }}
          title="Win-probability loss per graded turn through the Lichess accuracy curve; forced turns excluded. Harmonic + volatility-weighted aggregate — one blunder drags hard."
        >
          accuracy — {playerNames[0]} {report.accuracy.p1 !== null ? `${Math.round(report.accuracy.p1)}%` : '—'}
          {' · '}{playerNames[1]} {report.accuracy.p2 !== null ? `${Math.round(report.accuracy.p2)}%` : '—'}
        </div>
      )}
      {leadMisplays.length > 0 && (
        <div className="ps-eval-report-moments">
          {leadMisplays.map(side => {
            const lead = leads![side];
            const tone = lead.tier === 'blunder' ? '#ff7a7a' : '#f3a6a6';
            const strip = (label: string) => label.replace(/^Lead /, '');
            return (
              <button
                key={`lead-${side}`}
                type="button"
                className="ps-btn ps-eval-report-moment"
                onClick={() => onSelectTurn?.(0)}
                title="Jump to the team-preview analysis"
              >
                <span style={{ color: '#cde' }}>T0</span>
                <span style={{ color: tone }}>{playerNames[side === 'p1' ? 0 : 1]}</span>
                <span style={{ color: '#aab' }}>led {lead.played ? strip(lead.played.label) : '?'}</span>
                <span style={{ color: '#778' }}>better: {lead.best ? strip(lead.best.label) : '?'}</span>
                <span style={{ color: tone }}>−{(lead.regret ?? 0).toFixed(2)}</span>
              </button>
            );
          })}
        </div>
      )}
      {report.misplays.length > 0 && (
        <div className="ps-eval-report-moments">
          {report.misplays.map(misplay => {
            const tone = misplay.sacrifice ? '#9aa5b1'
              : misplay.riskUnpunished ? '#b6a46a'
                : misplay.tier === 'blunder' ? '#ff7a7a' : '#f3a6a6';
            return (
              <button
                key={`${misplay.turn}-${misplay.side}`}
                type="button"
                className="ps-btn ps-eval-report-moment"
                onClick={() => onSelectTurn?.(misplay.turn)}
                title={misplay.sacrifice
                  ? 'A nearly-dead Pokémon was fed deliberately — a low-cost sack, not a misplay'
                  : misplay.riskUnpunished
                    ? "The engine's floor priced in a reply that never came — jump to this turn's analysis"
                    : "Jump to this turn's analysis"}
              >
                <span style={{ color: '#cde' }}>T{misplay.turn}</span>
                <span style={{ color: tone }}>{playerNames[misplay.side === 'p1' ? 0 : 1]}</span>
                <span style={{ color: '#aab' }}>{misplay.played}</span>
                {misplay.sacrifice
                  ? <span style={{ color: tone }}>sack</span>
                  : misplay.riskUnpunished
                    ? <span style={{ color: tone }}>risk (unpunished)</span>
                    : (
                      <span style={{ color: '#778' }}>
                        {misplay.tier === 'blunder' ? 'blunder — better: ' : 'better: '}{misplay.better}
                      </span>
                    )}
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
