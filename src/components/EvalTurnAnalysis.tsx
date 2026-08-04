import { REGRET_THRESHOLD, diffChoices, playedSetupMove, type SideAnalysis, type TurnAnalysis } from '../lib/eval/analysis';
import type { RankedChoice } from '../lib/eval/types';
import { summarizeTurn } from '../lib/eval/summary';
import { attributionBadge } from './eval-badges';

interface EvalTurnAnalysisProps {
  analysis: TurnAnalysis;
  playerNames: [string, string];
  /** Click on an engine line: play it out in a branch at this turn. */
  onExplore?: (side: 'p1' | 'p2', choice: RankedChoice) => void;
}

/** The engine's line as a click-to-explore button, or a plain span. */
function ExplorableLabel({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return <span style={{ color: '#cde' }}>{label}</span>;
  return (
    <button
      type="button"
      className="ps-btn"
      title="Play this line out in a branch"
      onClick={onClick}
      style={{ padding: '0 4px', fontSize: 10, color: '#cde', whiteSpace: 'normal', textAlign: 'left' }}
    >
      {label} ↗
    </button>
  );
}

const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

/** Tiny centered gauge on [−1, +1] — makes score gaps visual at a glance. */
export function MiniBar({ value }: { value: number }) {
  const pct = 50 + 50 * Math.max(-1, Math.min(1, value));
  const positive = value >= 0;
  return (
    <span
      aria-hidden
      style={{
        position: 'relative', display: 'inline-block', width: 48, height: 7, flex: 'none',
        background: 'rgba(255,255,255,0.08)', borderRadius: 2,
      }}
    >
      <span
        style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${positive ? 50 : pct}%`, width: `${Math.abs(pct - 50)}%`,
          background: positive ? '#8c8' : '#f3a6a6', borderRadius: 1,
        }}
      />
      <span style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: '#667' }} />
    </span>
  );
}

/** Untracked (doubles): only the engine's preferred line — no played/blame. */
function EngineRow({ name, side, onExplore }: { name: string; side: SideAnalysis; onExplore?: (choice: RankedChoice) => void }) {
  if (!side.best) return null;
  const best = side.best;
  return (
    <div className="ps-eval-analysis-side">
      <div className="ps-eval-analysis-row">
        <span style={{ color: '#cde', fontWeight: 'bold' }}>{name}</span>
        <span style={{ color: '#aab' }}>
          engine: <ExplorableLabel label={best.label} onClick={onExplore && (() => onExplore(best))} /> ({signed(best.worstCase)})
        </span>
        {best.line && best.line.length > 0 && (
          <span className="ps-eval-line">then {best.line.map(step => `${step.p1} · ${step.p2}`).join(' → ')}</span>
        )}
      </div>
    </div>
  );
}

function SideRow({ name, side, onExplore }: { name: string; side: SideAnalysis; onExplore?: (choice: RankedChoice) => void }) {
  const playedRawName = side.playedRaw?.kind === 'switch'
    ? `→ ${side.playedRaw.species ?? side.playedRaw.name}`
    : side.playedRaw?.name;
  const slotText = side.playedSlots
    ?.filter((action): action is NonNullable<typeof action> => action !== null)
    .map(action => (action.kind === 'switch' ? `→ ${action.species ?? action.name}` : action.name))
    .join(' + ');
  const playedText = side.played
    ? `${side.played.label} (${signed(side.played.worstCase)})`
    : slotText
      ? `${slotText} — not among the engine's candidates`
      : side.playedRaw
        ? `${playedRawName} — not among the engine's options`
        : 'could not act (fainted or fully prevented)';
  const regretful = (side.regret ?? 0) >= REGRET_THRESHOLD;
  const setupMove = playedSetupMove(side);
  const difference = regretful && side.played && side.best ? diffChoices(side.played, side.best) : null;

  return (
    <div className="ps-eval-analysis-side">
      <div className="ps-eval-analysis-row">
        <span style={{ color: '#cde', fontWeight: 'bold' }}>{name}</span>
        <span style={{ color: '#aab' }}>played {playedText}</span>
        {side.played && side.best && !regretful && side.played.choice === side.best.choice && (
          <span style={{ color: '#8c8' }}>✓ the engine's move</span>
        )}
        {side.played && side.best && !regretful && side.played.choice !== side.best.choice && (
          <span style={{ color: '#778' }}>
            engine: {side.best.label} ({signed(side.best.worstCase)})
          </span>
        )}
        {regretful && side.regret !== null && (setupMove ? (
          <span
            style={{ color: '#b6a46a' }}
            title={`${setupMove} is a setup move — its payoff lies past the search horizon, so the regret may be overstated.`}
          >
            −{side.regret.toFixed(2)} regret · setup caveat
          </span>
        ) : (
          <span style={{ color: '#f3a6a6' }}>−{side.regret.toFixed(2)} regret</span>
        ))}
      </div>
      {regretful && side.played && side.best && (
        <>
          <div className="ps-eval-analysis-row" style={{ color: '#aab' }}>
            <MiniBar value={side.played.worstCase} />
            <span style={{ whiteSpace: 'nowrap' }}>{signed(side.played.worstCase)} played</span>
            {side.played.punishedBy && <span style={{ color: '#778' }}>· worst vs {side.played.punishedBy}</span>}
          </div>
          <div className="ps-eval-analysis-row" style={{ color: '#aab' }}>
            <MiniBar value={side.best.worstCase} />
            <span style={{ whiteSpace: 'nowrap' }}>{signed(side.best.worstCase)} better:</span>
            <ExplorableLabel
              label={side.best.label}
              onClick={onExplore && (() => onExplore(side.best!))}
            />
            {side.best.punishedBy && <span style={{ color: '#778' }}>· worst vs {side.best.punishedBy}</span>}
            {side.best.line && side.best.line.length > 0 && (
              <span className="ps-eval-line">then {side.best.line.map(step => `${step.p1} · ${step.p2}`).join(' → ')}</span>
            )}
          </div>
          {difference && (
            <div className="ps-eval-analysis-row">
              <span style={{ color: '#778' }}>difference:</span>
              <span style={{ color: '#cde' }}>{difference}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Chess-style explanation of one analyzed turn: played vs best, and why the score moved. */
export function EvalTurnAnalysis({ analysis, playerNames, onExplore }: EvalTurnAnalysisProps) {
  const badge = attributionBadge(analysis, playerNames);
  const exploreFor = (side: 'p1' | 'p2') =>
    onExplore && ((choice: RankedChoice) => onExplore(side, choice));
  return (
    <div className="ps-eval-analysis">
      <div className="ps-eval-analysis-row">
        <span style={{ fontWeight: 'bold', fontSize: 11, color: '#cde' }}>Turn {analysis.turn}</span>
        {analysis.swing !== null && (
          <span style={{ color: '#aab' }}>swing {signed(analysis.swing)}</span>
        )}
        <span style={{ color: badge.color }}>{badge.text}</span>
      </div>
      <div className="ps-eval-analysis-summary">{summarizeTurn(analysis, playerNames)}</div>
      {analysis.decisionDelta !== null && analysis.chanceDelta !== null && (
        <div className="ps-eval-analysis-row" style={{ color: '#778' }}>
          {signed(analysis.decisionDelta)} expected from the choices · {signed(analysis.chanceDelta)} from how it rolled
        </div>
      )}
      {analysis.playedTracking === false ? (
        <>
          <EngineRow name={playerNames[0]} side={analysis.p1} onExplore={exploreFor('p1')} />
          <EngineRow name={playerNames[1]} side={analysis.p2} onExplore={exploreFor('p2')} />
        </>
      ) : (
        <>
          <SideRow name={playerNames[0]} side={analysis.p1} onExplore={exploreFor('p1')} />
          <SideRow name={playerNames[1]} side={analysis.p2} onExplore={exploreFor('p2')} />
        </>
      )}
    </div>
  );
}
