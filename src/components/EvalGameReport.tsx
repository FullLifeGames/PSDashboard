import type { GameReport } from '../lib/eval/report';
import type { LeadAnalysis } from '../lib/eval/leads';
import type { TurnEvalSettings } from '../hooks/useEvaluation';
import { winDeltaText } from '../lib/eval/winprob';
import { attributionBadge } from './eval-badges';
import { sideIndex } from '../lib/ids';

interface EvalGameReportProps {
  report: GameReport;
  playerNames: [string, string];
  onSelectTurn?: (turn: number) => void;
  /** Turn-0 verdicts — a T0 chip appears for mistake-level lead choices. */
  leads?: LeadAnalysis | null;
  /** What produced each turn's numbers — chips carry a d1/d2/MCTS badge so
   * mixed-depth curves read honestly. */
  settingsFor?: (turn: number) => TurnEvalSettings | null;
}

// Deltas render as win-probability points ("−12%") — see winDeltaText.

type SettingsFor = EvalGameReportProps['settingsFor'];
type SelectTurn = EvalGameReportProps['onSelectTurn'];

function SettingsBadge({ turn, settingsFor }: { turn: number; settingsFor: SettingsFor }) {
  const settings = settingsFor?.(turn);
  if (!settings) return null;
  return (
    <span
      style={{ color: '#667', fontSize: 9 }}
      title={settings.mode === 'mcts'
        ? 'Evaluated with the MCTS engine'
        : `Evaluated at depth ${settings.depth} · ${settings.samples} sample${settings.samples > 1 ? 's' : ''}${settings.depth === 1 && settings.samples === 1 ? ' (fast scan)' : ''} · deepen from the turn view`}
    >
      {settings.mode === 'mcts' ? 'MCTS' : `d${settings.depth}`}
    </span>
  );
}

function AccuracyLine({ report, playerNames }: Pick<EvalGameReportProps, 'report' | 'playerNames'>) {
  if (!(report.accuracy && (report.accuracy.p1 !== null || report.accuracy.p2 !== null))) return null;
  return (
    <div
      className="ps-eval-analysis-row"
      style={{ fontSize: 10, color: '#aab' }}
      title="Win-probability loss per graded turn through the Lichess accuracy curve; forced turns excluded. Harmonic + volatility-weighted aggregate: one blunder drags hard."
    >
      accuracy: {playerNames[0]} {report.accuracy.p1 !== null ? `${Math.round(report.accuracy.p1)}%` : '—'}
      {' · '}{playerNames[1]} {report.accuracy.p2 !== null ? `${Math.round(report.accuracy.p2)}%` : '—'}
    </div>
  );
}

function LeadChips({ leads, playerNames, onSelectTurn }: { leads: LeadAnalysis; playerNames: [string, string]; onSelectTurn: SelectTurn }) {
  const leadMisplays = (['p1', 'p2'] as const).filter(side =>
    leads[side].tier === 'mistake' || leads[side].tier === 'blunder');
  if (leadMisplays.length === 0) return null;
  return (
    <div className="ps-eval-report-moments">
      {leadMisplays.map(side => {
        const lead = leads[side];
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
            <span style={{ color: tone }}>{playerNames[sideIndex(side)]}</span>
            <span style={{ color: '#aab' }}>led {lead.played ? strip(lead.played.label) : '?'}</span>
            <span style={{ color: '#778' }}>better: {lead.best ? strip(lead.best.label) : '?'}</span>
            <span style={{ color: tone }}>{winDeltaText(-(lead.regret ?? 0))}</span>
          </button>
        );
      })}
    </div>
  );
}

function MisplayChip({ misplay, playerNames, onSelectTurn, settingsFor }: {
  misplay: GameReport['misplays'][number]; playerNames: [string, string]; onSelectTurn: SelectTurn; settingsFor: SettingsFor;
}) {
  const tone = misplay.sacrifice ? '#9aa5b1'
    : misplay.riskUnpunished ? '#b6a46a'
      : misplay.tier === 'blunder' ? '#ff7a7a' : '#f3a6a6';
  return (
    <button
      type="button"
      className="ps-btn ps-eval-report-moment"
      onClick={() => onSelectTurn?.(misplay.turn)}
      title={misplay.sacrifice
        ? 'A deliberate feed: a sack (nearly dead, or simplifying a won position) rather than a misplay'
        : misplay.riskUnpunished
          ? "The engine's floor priced in a reply that never came. Jump to this turn's analysis"
          : "Jump to this turn's analysis"}
    >
      <span style={{ color: '#cde' }}>T{misplay.turn}</span>
      <SettingsBadge turn={misplay.turn} settingsFor={settingsFor} />
      <span style={{ color: tone }}>{playerNames[sideIndex(misplay.side)]}</span>
      <span style={{ color: '#aab' }}>{misplay.played}</span>
      {misplay.sacrifice
        ? <span style={{ color: tone }}>sack</span>
        : misplay.riskUnpunished
          ? <span style={{ color: tone }}>risk (unpunished)</span>
          : (
            <span style={{ color: '#778' }}>
              {misplay.tier === 'blunder' ? 'blunder · better: ' : 'better: '}{misplay.better}
            </span>
          )}
      <span style={{ color: tone }}>{winDeltaText(-misplay.regret)}</span>
    </button>
  );
}

function MisplayChips({ report, playerNames, onSelectTurn, settingsFor }: EvalGameReportProps) {
  if (report.misplays.length === 0) return null;
  return (
    <div className="ps-eval-report-moments">
      {report.misplays.map(misplay => (
        <MisplayChip key={`${misplay.turn}-${misplay.side}`} misplay={misplay} playerNames={playerNames} onSelectTurn={onSelectTurn} settingsFor={settingsFor} />
      ))}
      {report.tracked && (['p1', 'p2'] as const)
        .filter(side => !report.misplays.some(misplay => misplay.side === side))
        .map(side => (
          <span key={side} style={{ color: '#778', fontSize: 10, alignSelf: 'center' }}>
            {playerNames[sideIndex(side)]}: no clear misplays
          </span>
        ))}
    </div>
  );
}

function ReadChips({ report, playerNames, onSelectTurn, settingsFor }: EvalGameReportProps) {
  if (report.reads.length === 0) return null;
  return (
    <div className="ps-eval-report-moments">
      {report.reads.map(read => (
        <button
          key={`${read.turn}-${read.side}`}
          type="button"
          className="ps-btn ps-eval-report-moment"
          onClick={() => onSelectTurn?.(read.turn)}
          title="A risk whose read won value. Jump to this turn's analysis"
        >
          <span style={{ color: '#cde' }}>T{read.turn}</span>
          <SettingsBadge turn={read.turn} settingsFor={settingsFor} />
          <span style={{ color: '#8c8' }}>{playerNames[sideIndex(read.side)]}</span>
          <span style={{ color: '#aab' }}>{read.played}</span>
          <span style={{ color: '#8c8' }}>read paid off {winDeltaText(read.payoff)}</span>
        </button>
      ))}
    </div>
  );
}

function KeyMomentChips({ report, playerNames, onSelectTurn, settingsFor }: EvalGameReportProps) {
  if (report.keyMoments.length === 0) return null;
  return (
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
            <SettingsBadge turn={moment.turn} settingsFor={settingsFor} />
            <span style={{ color: badge.color }}>{badge.text}</span>
            {moment.swing !== null && <span style={{ color: '#aab' }}>{winDeltaText(moment.swing)}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Game-level story from a completed sweep: the tip, the seeds, the key moments. */
export function EvalGameReport(props: EvalGameReportProps) {
  const { report, playerNames, onSelectTurn, leads } = props;
  return (
    <div className="ps-eval-report">
      <div className="ps-eval-analysis-row">
        <span style={{ fontWeight: 'bold', fontSize: 11, color: '#cde' }}>Game report</span>
      </div>
      <div className="ps-eval-analysis-summary">{report.summary}</div>
      <AccuracyLine report={report} playerNames={playerNames} />
      {leads && <LeadChips leads={leads} playerNames={playerNames} onSelectTurn={onSelectTurn} />}
      <MisplayChips {...props} />
      <ReadChips {...props} />
      <KeyMomentChips {...props} />
    </div>
  );
}
