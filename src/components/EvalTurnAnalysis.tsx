import type { TurnAnalysis } from '../lib/eval/analysis';
import type { LeadAnalysis, LeadSideAnalysis } from '../lib/eval/leads';
import type { RankedChoice, ReadRecommendation } from '../lib/eval/types';
import { formatRead, summarizeTurn } from '../lib/eval/summary';
import { winDeltaText, winPctText } from '../lib/eval/winprob';
import { attributionBadge } from './eval-badges';
import { EngineRow } from './eval/analysis-bits';
import { SideRow } from './eval/SideRow';
import { evTitle } from './eval/turn-copy';

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
            <span style={{ fontWeight: 'bold' }}>{playerNames[side === 'p1' ? 0 : 1]}</span>
            <span>{formatRead(read)}</span>
          </div>
        );
      })}
    </>
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
      <ReadRows reads={reads} playerNames={playerNames} />
    </div>
  );
}

const stripLead = (label: string) => label.replace(/^Lead /, '');

/** The lead verdict chips: agreement, the graded miss, the inaccuracy, or the engine's differing pick. */
function LeadVerdict({ name, side }: { name: string; side: LeadSideAnalysis }) {
  const bad = side.tier === 'mistake' || side.tier === 'blunder';
  return (
    <>
      {side.played && side.best && side.played.choice === side.best.choice && (
        <span style={{ color: '#8c8' }}>✓ the engine's leads</span>
      )}
      {bad && side.best && (
        <span style={{ color: side.tier === 'blunder' ? '#ff7a7a' : '#f3a6a6' }}>
          {side.tier} · {winDeltaText(-(side.regret ?? 0))} · better: {stripLead(side.best.label)} ({winPctText(side.best.ev)})
        </span>
      )}
      {side.tier === 'inaccuracy' && side.best && (
        <span style={{ color: '#b6a46a' }}>
          · inaccuracy ({winDeltaText(-(side.regret ?? 0))}): {stripLead(side.best.label)} was a touch better
        </span>
      )}
      {!side.tier && side.played && side.best && side.played.choice !== side.best.choice && (
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
