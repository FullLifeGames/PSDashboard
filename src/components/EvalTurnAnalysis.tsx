import {
  type TurnAnalysis, type LeadAnalysis, type LeadSideAnalysis, type RankedChoice, type ReadRecommendation,
  chanceRolled, formatRead, lostGround, summarizeTurn, winDeltaText, winPctText,
} from '@fulllifegames/eval-engine';
import { attributionBadge, isPairLead, leadTier } from './eval-badges';
import { EngineRow } from './eval/analysis-bits';
import { SideRow } from './eval/SideRow';
import { evTitle } from './eval/turn-copy';
import { sideIndex } from '@fulllifegames/replay-core';

export { MiniBar } from './eval/analysis-bits';

interface EvalTurnAnalysisProps {
  analysis: TurnAnalysis;
  playerNames: [string, string];
  /** Exploitative Read recommendations (advisory — never part of the grade). */
  reads?: { p1?: ReadRecommendation | null; p2?: ReadRecommendation | null } | null;
  /** Click on an engine line: play it out in a branch at this turn, the other side answering with `reply`. */
  onExplore?: (side: 'p1' | 'p2', choice: RankedChoice, reply?: RankedChoice | null) => void;
}

function ReadRows({ reads, playerNames }: Pick<EvalTurnAnalysisProps, 'reads' | 'playerNames'>) {
  return (
    <>
      {(['p1', 'p2'] as const).map(side => {
        const read = reads?.[side];
        if (!read) return null;
        return (
          <div
            key={`read-${side}`}
            className="ps-eval-analysis-row"
            style={{ color: '#7da7d9' }}
            title={'Exploitative line: the best response to the opponent\'s observed play, ' +
              'refutable by their perfect reply, priced by its spread. Advisory only; the grades above stay equilibrium-based.'}
          >
            <span style={{ fontWeight: 'bold' }}>{playerNames[sideIndex(side)]}</span>
            <span>{formatRead(read)}</span>
          </div>
        );
      })}
    </>
  );
}

/**
 * The estimate change split in two: what the chosen pair was expected to move and the rest. Round 67 (T22):
 * the rest is "how it rolled" only with a roll in its direction, else the engine's re-read of the position.
 */
function SplitRow({ analysis, name }: { analysis: TurnAnalysis; name: string }) {
  const reRead = chanceRolled(analysis) === false;
  return (
    <div
      className="ps-eval-analysis-row"
      style={{ color: '#778' }}
      title={reRead
        ? `${name}'s estimate change split in two: what the chosen pair was expected to move, and how the engine re-read the position after the turn. No roll on this turn went that way.`
        : `${name}'s estimate change split in two: what the chosen pair was expected to move, and what the actual rolls added on top.`}
    >
      {winDeltaText(analysis.decisionDelta ?? 0)} expected from the choices · {winDeltaText(analysis.chanceDelta ?? 0)} {reRead ? "from the engine's re-read" : 'from how it rolled'}
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
      {analysis.decisionDelta !== null && analysis.chanceDelta !== null && <SplitRow analysis={analysis} name={playerNames[0]} />}
      {analysis.playedTracking === false ? (
        <>
          <EngineRow name={playerNames[0]} side={analysis.p1} onExplore={exploreFor('p1')} />
          <EngineRow name={playerNames[1]} side={analysis.p2} onExplore={exploreFor('p2')} />
        </>
      ) : (
        <>
          <SideRow name={playerNames[0]} side={analysis.p1} onExplore={exploreFor('p1')} lostGround={lostGround(analysis, 'p1')} />
          <SideRow name={playerNames[1]} side={analysis.p2} onExplore={exploreFor('p2')} lostGround={lostGround(analysis, 'p2')} />
        </>
      )}
      <ReadRows reads={reads} playerNames={playerNames} />
    </div>
  );
}

const stripLead = (label: string) => label.replace(/^Lead /, '');

/** The graded lead miss or inaccuracy (singles; a doubles lead carries no verdict, leadTier). */
function LeadGrade({ side }: { side: LeadSideAnalysis }) {
  const tier = leadTier(side);
  const bad = tier === 'mistake' || tier === 'blunder';
  return (
    <>
      {bad && side.best && (
        <span style={{ color: tier === 'blunder' ? '#ff7a7a' : '#f3a6a6' }}>
          {tier} · {winDeltaText(-(side.regret ?? 0))} · better: {stripLead(side.best.label)} ({winPctText(side.best.ev)})
        </span>
      )}
      {tier === 'inaccuracy' && side.best && (
        <span style={{ color: '#b6a46a' }}>
          · inaccuracy ({winDeltaText(-(side.regret ?? 0))}): {stripLead(side.best.label)} was a touch better
        </span>
      )}
    </>
  );
}

/**
 * The lead verdict chips: agreement, the graded miss, the inaccuracy, or the engine's differing pick.
 * Round 64 (T123): a doubles pair gets no tick either, only the engine's pick as a neutral line (T116).
 */
function LeadVerdict({ name, side }: { name: string; side: LeadSideAnalysis }) {
  const agrees = !!side.played && !!side.best && side.played.choice === side.best.choice;
  const pair = isPairLead(side);
  return (
    <>
      {agrees && !pair && (
        <span style={{ color: '#8c8' }}>✓ the engine's leads</span>
      )}
      <LeadGrade side={side} />
      {!leadTier(side) && side.played && side.best && (!agrees || pair) && (
        <span style={{ color: '#778' }} title={evTitle(name)}>
          engine: {stripLead(side.best.label)} ({winPctText(side.best.ev)})
        </span>
      )}
    </>
  );
}

function LeadRow({ name, side }: { name: string; side: LeadSideAnalysis }) {
  return (
    <div className="ps-eval-analysis-side">
      <div className="ps-eval-analysis-row">
        <span style={{ color: '#cde', fontWeight: 'bold' }}>{name}</span>
        <span style={{ color: '#aab' }} title={side.played ? evTitle(name) : undefined}>
          led {side.played
            ? `${stripLead(side.played.label)} (${winPctText(side.played.ev)})`
            : 'leads not matched'}
        </span>
        <LeadVerdict name={name} side={side} />
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
