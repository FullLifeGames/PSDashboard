import { diffChoices, playedSetupMove, TIER_THRESHOLDS, type SideAnalysis, type TurnAnalysis } from '../lib/eval/analysis';
import type { LeadAnalysis, LeadSideAnalysis } from '../lib/eval/leads';
import type { RankedChoice, ReadRecommendation } from '../lib/eval/types';
import { formatRead, summarizeTurn } from '../lib/eval/summary';
import { winDeltaText, winPctText } from '../lib/eval/winprob';
import { attributionBadge } from './eval-badges';

interface EvalTurnAnalysisProps {
  analysis: TurnAnalysis;
  playerNames: [string, string];
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

/**
 * Every displayed value is a WIN PROBABILITY for the named player — "52%"
 * absolutes (higher is always better for that player) and "+8%" deltas —
 * because raw wp-units ("+0.05", "−0.39") never said WHOSE position they
 * helped. The played chip shows the row's EV — the SAME quantity as the
 * engine chip and the regret grading. The floor appears only as a labeled
 * risk clause, and only when the row gave up mistake-sized safety (a
 * genuine gamble): showing the floor beside the engine's EV once made a
 * co-optimal switch look ranked very lowly (draft T50).
 */
const RISK_DISPLAY_GAP = TIER_THRESHOLDS.mistake;
/** Tooltip for a side's own EV percentages. */
const evTitle = (name: string) =>
  `${name}'s win probability with this choice against balanced play — higher is always better for ${name}.`;
/** Played-vs-engine EV gaps under this are display noise — the picks are equivalent. */
const ENGINE_EQUIVALENT_EPSILON = 0.01;

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
        <span style={{ color: '#aab' }} title={evTitle(name)}>
          engine: <ExplorableLabel label={best.label} onClick={onExplore && (() => onExplore(best))} /> ({winPctText(best.ev)})
        </span>
        {best.line && best.line.length > 0 && (
          <span className="ps-eval-line">then {best.line.map(step => `${step.p1} · ${step.p2}`).join(' → ')}</span>
        )}
      </div>
    </div>
  );
}

/** `|cant|` reasons → honest copy: the player DID choose; this swallowed it. */
function preventedText(reason: string): string {
  if (reason === 'faint') return 'fainted before its action came out';
  if (reason === 'slp') return 'slept through the turn — the chosen action never surfaced';
  if (reason === 'frz') return 'stayed frozen — the chosen action never surfaced';
  if (reason === 'par') return 'was fully paralyzed — the chosen action never surfaced';
  if (reason === 'flinch') return 'flinched — the chosen action never surfaced';
  if (reason === 'recharge') return 'had to recharge';
  if (reason.startsWith('move: ')) return `was blocked by ${reason.slice('move: '.length)} — the chosen action never surfaced`;
  return `was prevented (${reason}) — the chosen action never surfaced`;
}

function SideRow({ name, side, onExplore }: { name: string; side: SideAnalysis; onExplore?: (choice: RankedChoice) => void }) {
  const playedRawName = side.playedRaw?.kind === 'switch'
    ? `→ ${side.playedRaw.species ?? side.playedRaw.name}`
    : side.playedRaw?.name;
  const slotText = side.playedSlots
    ?.filter((action): action is NonNullable<typeof action> => action !== null)
    .map(action => (action.kind === 'switch' ? `→ ${action.species ?? action.name}` : action.name))
    .join(' + ');
  const acted = Boolean(side.played || slotText || side.playedRaw);
  const playedText = side.played
    ? `${side.played.label} (${winPctText(side.played.ev)})`
    : slotText
      ? `${slotText} — not among the engine's candidates`
      : side.playedRaw
        ? `${playedRawName} — not among the engine's options`
        : side.prevented
          ? preventedText(side.prevented)
          : 'choice never surfaced';
  const playedGamble = side.played !== null && side.played.ev - side.played.worstCase >= RISK_DISPLAY_GAP;
  const regretful = side.tier === 'mistake' || side.tier === 'blunder';
  const setupMove = playedSetupMove(side);
  const difference = regretful && side.played && side.best ? diffChoices(side.played, side.best) : null;

  return (
    <div className="ps-eval-analysis-side">
      <div className="ps-eval-analysis-row">
        <span style={{ color: '#cde', fontWeight: 'bold' }}>{name}</span>
        <span style={{ color: '#aab' }} title={side.played ? evTitle(name) : undefined}>{acted ? 'played ' : ''}{playedText}</span>
        {playedGamble && side.played && (
          <span
            style={{ color: '#778' }}
            title={`If the opponent had picked the most punishing reply, ${name} would have fallen to this win probability — a worst case, not the expected outcome.`}
          >
            · risked {winPctText(side.played.worstCase)}{side.played.punishedBy ? ` vs ${side.played.punishedBy}` : ''}
          </span>
        )}
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
          <span style={{ color: '#778' }} title={evTitle(name)}>
            engine: <ExplorableLabel label={side.best.label} color="#778" onClick={onExplore && (() => onExplore(side.best!))} />
            {' '}({winPctText(side.best.ev)})
            {side.best.ev - side.played.ev < ENGINE_EQUIVALENT_EPSILON && (
              <span title="The win-probability gap is inside noise — the engine considers both picks equally good."> · equivalent</span>
            )}
          </span>
        )}
        {!side.played && side.best && (
          <span style={{ color: '#778' }} title={evTitle(name)}>
            engine: <ExplorableLabel label={side.best.label} color="#778" onClick={onExplore && (() => onExplore(side.best!))} />
            {' '}({winPctText(side.best.ev)})
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
            title={side.sacrifice.healthy
              ? 'A healthy body was fed while the engine stayed decisively ahead on both sides of the sack — simplification, not graded as a misplay.'
              : 'A nearly-dead Pokémon was fed deliberately — a low-cost sack, not graded as a misplay.'}
          >
            · sacked {side.sacrifice.name} ({Math.round(side.sacrifice.hpFraction * 100)}% HP)
          </span>
        )}
        {side.riskPaidOff && !side.sacrifice && (
          <span
            style={{ color: '#8c8' }}
            title={`The safe line guaranteed ${side.safe ? winPctText(side.safe.worstCase) : '?'}; the actual pair came out ${winDeltaText(side.riskPayoff ?? 0)} better — the read won value.`}
          >
            read paid off · {winDeltaText(side.riskPayoff ?? 0)}
          </span>
        )}
        {regretful && !side.sacrifice && side.regret !== null && !side.riskPaidOff && (setupMove ? (
          <span
            style={{ color: '#b6a46a' }}
            title={`${setupMove} is a setup move — its payoff lies past the search horizon, so the regret may be overstated.`}
          >
            {winDeltaText(-side.regret)} regret · setup caveat
          </span>
        ) : side.riskUnpunished ? (
          <span
            style={{ color: '#b6a46a' }}
            title={`The floor assumes ${side.played?.punishedBy ?? 'the punishing reply'} — the opponent chose differently, so the read came true.`}
          >
            {winDeltaText(-side.regret)} regret · risk unpunished
          </span>
        ) : side.tier === 'blunder' ? (
          <span style={{ color: '#ff7a7a' }} title={`${name} gave up this much win probability vs the engine's best.`}>blunder · {winDeltaText(-side.regret)}</span>
        ) : (
          <span style={{ color: '#f3a6a6' }} title={`${name} gave up this much win probability vs the engine's best.`}>mistake · {winDeltaText(-side.regret)}</span>
        ))}
        {side.tier === 'inaccuracy' && side.best && (
          <span
            style={{ color: '#b6a46a' }}
            title={`${side.best.label} was slightly better — a minor imprecision, not a mistake.`}
          >
            · inaccuracy ({winDeltaText(-(side.regret ?? 0))})
          </span>
        )}
        {side.sensitivity && (
          <span
            style={{ color: '#b6a46a' }}
            title={`The verdict depends on a guessed item: ${side.sensitivity.alternatives
              .map(alternative => `${alternative.item}: ${alternative.tier === 'none' ? 'fine' : alternative.tier}`)
              .join(' · ')}`}
          >
            ± hinges on {side.sensitivity.species}
          </span>
        )}
      </div>
      {regretful && side.played && side.best && (
        <>
          <div className="ps-eval-analysis-row" style={{ color: '#aab' }} title={evTitle(name)}>
            <MiniBar value={side.played.ev} />
            <span style={{ whiteSpace: 'nowrap' }}>{winPctText(side.played.ev)} played</span>
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
              <div className="ps-eval-analysis-row" style={{ color: '#aab' }} title={evTitle(name)}>
                <MiniBar value={value} />
                <span style={{ whiteSpace: 'nowrap' }}>
                  {winPctText(value)} {asSafe ? 'safe:' : 'better:'}
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
          <span style={{ color: '#aab' }} title={`How much the graph estimate moved for ${playerNames[0]} across this turn, in win-probability points.`}>swing {winDeltaText(analysis.swing)}</span>
        )}
        <span style={{ color: badge.color }}>{badge.text}</span>
      </div>
      <div className="ps-eval-analysis-summary">{summarizeTurn(analysis, playerNames)}</div>
      {analysis.decisionDelta !== null && analysis.chanceDelta !== null && (
        <div
          className="ps-eval-analysis-row"
          style={{ color: '#778' }}
          title={`${playerNames[0]}'s estimate change split in two: what the chosen pair was expected to move, and what the actual rolls added on top.`}
        >
          {winDeltaText(analysis.decisionDelta)} expected from the choices · {winDeltaText(analysis.chanceDelta)} from how it rolled
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
        <span style={{ color: '#aab' }} title={side.played ? evTitle(name) : undefined}>
          led {side.played
            ? `${stripLead(side.played.label)} (${winPctText(side.played.ev)})`
            : 'leads not matched'}
        </span>
        {side.played && side.best && side.played.choice === side.best.choice && (
          <span style={{ color: '#8c8' }}>✓ the engine's leads</span>
        )}
        {bad && side.best && (
          <span style={{ color: side.tier === 'blunder' ? '#ff7a7a' : '#f3a6a6' }}>
            {side.tier} · {winDeltaText(-(side.regret ?? 0))} — better: {stripLead(side.best.label)} ({winPctText(side.best.ev)})
          </span>
        )}
        {side.tier === 'inaccuracy' && side.best && (
          <span style={{ color: '#b6a46a' }}>
            · inaccuracy ({winDeltaText(-(side.regret ?? 0))}) — {stripLead(side.best.label)} was slightly better
          </span>
        )}
        {!side.tier && side.played && side.best && side.played.choice !== side.best.choice && (
          <span style={{ color: '#778' }} title={evTitle(name)}>
            engine: {stripLead(side.best.label)} ({winPctText(side.best.ev)})
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
