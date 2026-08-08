import { diffChoices, playedSetupMove, type SideAnalysis, type TurnAnalysis } from '../lib/eval/analysis';
import type { LeadAnalysis, LeadSideAnalysis } from '../lib/eval/leads';
import type { RankedChoice, ReadRecommendation } from '../lib/eval/types';
import { formatRead, summarizeTurn } from '../lib/eval/summary';
import { attributionBadge } from './eval-badges';

interface EvalTurnAnalysisProps {
  analysis: TurnAnalysis;
  playerNames: [string, string];
  /** Selects the fitted win-probability curve for the summary's percents. */
  doubles?: boolean;
  /** Exploitative Read recommendations (advisory — never part of the grade). */
  reads?: { p1?: ReadRecommendation | null; p2?: ReadRecommendation | null } | null;
  /** Click on an engine line: play it out in a branch at this turn, the other side answering with `reply`. */
  onExplore?: (side: 'p1' | 'p2', choice: RankedChoice, reply?: RankedChoice | null) => void;
}

/** The engine's line as a click-to-explore button, or a plain span. */
function ExplorableLabel({ label, color = '#cde', onClick }: { label: string; color?: string; onClick?: () => void }) {
  if (!onClick) return <span style={{ color }}>{label}</span>;
  return (
    <button
      type="button"
      className="ps-btn ps-eval-inline-btn"
      title="Play this line out in a branch"
      onClick={onClick}
      style={{ padding: '0 4px', fontSize: 10, color, whiteSpace: 'normal', textAlign: 'left' }}
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
          engine: <ExplorableLabel label={best.label} onClick={onExplore && (() => onExplore(best))} /> ({signed(best.ev)})
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
  const regretful = side.tier === 'mistake' || side.tier === 'blunder';
  const setupMove = playedSetupMove(side);
  const difference = regretful && side.played && side.best ? diffChoices(side.played, side.best) : null;

  return (
    <div className="ps-eval-analysis-side">
      <div className="ps-eval-analysis-row">
        <span style={{ color: '#cde', fontWeight: 'bold' }}>{name}</span>
        <span style={{ color: '#aab' }}>played {playedText}</span>
        {side.playedPartial && (
          <span
            style={{ color: '#778' }}
            title="One slot's choice was never visible (flinched or asleep) — graded charitably against the best combo the observed action allows."
          >
            · partner unseen
          </span>
        )}
        {side.played && side.best && !regretful && side.played.choice === side.best.choice && (
          <ExplorableLabel
            label="✓ the engine's move"
            color="#8c8"
            onClick={onExplore && (() => onExplore(side.best!))}
          />
        )}
        {side.played && side.best && !regretful && side.played.choice !== side.best.choice && (
          <span style={{ color: '#778' }}>
            engine: <ExplorableLabel label={side.best.label} color="#778" onClick={onExplore && (() => onExplore(side.best!))} />
            {' '}({signed(side.best.ev)})
          </span>
        )}
        {side.verifiedAtDepth && (
          <span
            style={{ color: '#778' }}
            title="A deeper search re-checked this turn: the played line holds up, so the shallow misplay flag was cleared."
          >
            · verified deeper
          </span>
        )}
        {side.sacrifice && (
          <span
            style={{ color: '#9aa5b1' }}
            title="A nearly-dead Pokémon was fed deliberately — a low-cost sack, not graded as a misplay."
          >
            · sacked {side.sacrifice.name} ({Math.round(side.sacrifice.hpFraction * 100)}% HP)
          </span>
        )}
        {regretful && !side.sacrifice && side.regret !== null && (side.riskPaidOff ? (
          <span
            style={{ color: '#8c8' }}
            title={`The safe line guaranteed ${side.safe ? side.safe.worstCase.toFixed(2) : '?'}; the actual pair came out ${(side.riskPayoff ?? 0).toFixed(2)} better — the read won value.`}
          >
            read paid off · +{(side.riskPayoff ?? 0).toFixed(2)}
          </span>
        ) : setupMove ? (
          <span
            style={{ color: '#b6a46a' }}
            title={`${setupMove} is a setup move — its payoff lies past the search horizon, so the regret may be overstated.`}
          >
            −{side.regret.toFixed(2)} regret · setup caveat
          </span>
        ) : side.riskUnpunished ? (
          <span
            style={{ color: '#b6a46a' }}
            title={`The floor assumes ${side.played?.punishedBy ?? 'the punishing reply'} — the opponent chose differently, so the read came true.`}
          >
            −{side.regret.toFixed(2)} regret · risk unpunished
          </span>
        ) : side.tier === 'blunder' ? (
          <span style={{ color: '#ff7a7a' }}>blunder · −{side.regret.toFixed(2)}</span>
        ) : (
          <span style={{ color: '#f3a6a6' }}>mistake · −{side.regret.toFixed(2)}</span>
        ))}
        {side.tier === 'inaccuracy' && side.best && (
          <span
            style={{ color: '#b6a46a' }}
            title={`${side.best.label} was slightly better — a minor imprecision, not a mistake.`}
          >
            · inaccuracy (−{(side.regret ?? 0).toFixed(2)})
          </span>
        )}
      </div>
      {regretful && side.played && side.best && (
        <>
          <div className="ps-eval-analysis-row" style={{ color: '#aab' }}>
            <MiniBar value={side.played.ev} />
            <span style={{ whiteSpace: 'nowrap' }}>{signed(side.played.ev)} played</span>
            {side.played.punishedBy && <span style={{ color: '#778' }}>· worst vs {side.played.punishedBy}</span>}
          </div>
          {(() => {
            // For a read, the reference is the SAFE line (max floor) shown at
            // its guarantee — calling the ev-best "better" would credit what
            // the read outperformed. Red misplays compare against the ev-best
            // at its equilibrium value.
            const asSafe = side.riskUnpunished || side.riskPaidOff;
            const target = asSafe ? side.safe ?? side.best! : side.best!;
            const value = asSafe ? target.worstCase : target.ev;
            return (
              <div className="ps-eval-analysis-row" style={{ color: '#aab' }}>
                <MiniBar value={value} />
                <span style={{ whiteSpace: 'nowrap' }}>
                  {signed(value)} {asSafe ? 'safe:' : 'better:'}
                </span>
                <ExplorableLabel
                  label={target.label}
                  onClick={onExplore && (() => onExplore(target))}
                />
                {target.punishedBy && <span style={{ color: '#778' }}>· worst vs {target.punishedBy}</span>}
                {target.line && target.line.length > 0 && (
                  <span className="ps-eval-line">then {target.line.map(step => `${step.p1} · ${step.p2}`).join(' → ')}</span>
                )}
              </div>
            );
          })()}
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
export function EvalTurnAnalysis({ analysis, playerNames, reads, onExplore }: EvalTurnAnalysisProps) {
  const badge = attributionBadge(analysis, playerNames);
  const exploreFor = (side: 'p1' | 'p2') =>
    onExplore && ((choice: RankedChoice) =>
      onExplore(side, choice, side === 'p1' ? analysis.p2.best : analysis.p1.best));
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
      {(['p1', 'p2'] as const).map(side => {
        const read = reads?.[side];
        if (!read) return null;
        return (
          <div
            key={`read-${side}`}
            className="ps-eval-analysis-row"
            style={{ color: '#7da7d9' }}
            title={'Exploitative line: the best response to how the opponent actually plays — ' +
              'refutable by their perfect reply, priced by its spread. Advisory only; the grades above stay equilibrium-based.'}
          >
            <span style={{ fontWeight: 'bold' }}>{playerNames[side === 'p1' ? 0 : 1]}</span>
            <span>{formatRead(read)}</span>
          </div>
        );
      })}
    </div>
  );
}

const stripLead = (label: string) => label.replace(/^Lead /, '');

function LeadRow({ name, side }: { name: string; side: LeadSideAnalysis }) {
  const bad = side.tier === 'mistake' || side.tier === 'blunder';
  return (
    <div className="ps-eval-analysis-side">
      <div className="ps-eval-analysis-row">
        <span style={{ color: '#cde', fontWeight: 'bold' }}>{name}</span>
        <span style={{ color: '#aab' }}>
          led {side.played
            ? `${stripLead(side.played.label)} (${signed(side.played.ev)})`
            : 'leads not matched'}
        </span>
        {side.played && side.best && side.played.choice === side.best.choice && (
          <span style={{ color: '#8c8' }}>✓ the engine's leads</span>
        )}
        {bad && side.best && (
          <span style={{ color: side.tier === 'blunder' ? '#ff7a7a' : '#f3a6a6' }}>
            {side.tier} · −{(side.regret ?? 0).toFixed(2)} — better: {stripLead(side.best.label)} ({signed(side.best.ev)})
          </span>
        )}
        {side.tier === 'inaccuracy' && side.best && (
          <span style={{ color: '#b6a46a' }}>
            · inaccuracy (−{(side.regret ?? 0).toFixed(2)}) — {stripLead(side.best.label)} was slightly better
          </span>
        )}
        {!side.tier && side.played && side.best && side.played.choice !== side.best.choice && (
          <span style={{ color: '#778' }}>
            engine: {stripLead(side.best.label)} ({signed(side.best.ev)})
          </span>
        )}
      </div>
    </div>
  );
}

/** Turn 0: the team-preview lead decision, graded like any other turn. */
export function EvalLeadAnalysis({ leads, playerNames }: { leads: LeadAnalysis; playerNames: [string, string] }) {
  return (
    <div className="ps-eval-analysis">
      <div className="ps-eval-analysis-row">
        <span style={{ fontWeight: 'bold', fontSize: 11, color: '#cde' }}>Team preview</span>
        <span style={{ color: '#778' }}>the lead decision before turn 1</span>
      </div>
      <LeadRow name={playerNames[0]} side={leads.p1} />
      <LeadRow name={playerNames[1]} side={leads.p2} />
    </div>
  );
}
