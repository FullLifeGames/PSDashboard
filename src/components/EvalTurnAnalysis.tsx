import { useState } from 'react';
import {
  type TurnAnalysis, type LeadAnalysis, type EvalResult, type LeadSideAnalysis, type RankedChoice, type ReadRecommendation,
  chanceRolled, formatRead, lostGround, summarizeTurn, winDeltaText, winPctText,
} from '@fulllifegames/eval-engine';
import { attributionBadge, isPairLead, leadTier } from './eval-badges';
import { EngineRow } from './eval/analysis-bits';
import { CardToggle } from './eval/CardToggle';
import { LinesSection } from './eval/LinesSection';
import { MatrixDialogButton } from './eval/MatrixDialog';
import { WinPathsEntry } from './eval/WinPathsEntry';
import type { LinesHost } from '../lib/line-view';
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
  onExplore?: (side: 'p1' | 'p2', choice: RankedChoice, reply?: RankedChoice | null, from?: EvalResult | null) => void;
  /** Round 89 (#104): the turn's own result (its `lines`) and what the Lines section needs of the host; without them the section is absent. */
  result?: EvalResult | null;
  linesHost?: LinesHost;
  doubles?: boolean;
  /** Round 89 (#105): the turn is a game's open tip: nobody has played it, so there is no played choice to grade, only the engine's lines. */
  open?: boolean;
  /** Round 89 (B7a): the panel's handler of a matrix cell, which the card's matrix dialog calls (absent: the dialog reads only). */
  onPickPair?: (p1: { choice: string; label: string }, p2: { choice: string; label: string }) => void;
  /** Round 89 (#153, HM-2): the Setup setting "Opponent reads my move" is on: the engine-move buttons say so in their titles. */
  opponentReads?: boolean;
}

function ReadRows({ reads, playerNames, faintedFraction }: Pick<EvalTurnAnalysisProps, 'reads' | 'playerNames'> & { faintedFraction?: number }) {
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
            <span>{formatRead(read, faintedFraction)}</span>
          </div>
        );
      })}
    </>
  );
}

/**
 * The estimate change split in two: what the chosen pair was expected to move and the rest. Round 67 (T22):
 * the rest is "how it rolled" only with a roll in its direction, else the part no roll explains (Round 79, T286).
 */
function SplitRow({ analysis, name }: { analysis: TurnAnalysis; name: string }) {
  const unrolled = chanceRolled(analysis) === false;
  return (
    <div
      className="ps-eval-analysis-row"
      style={{ color: '#778' }}
      title={unrolled
        ? `${name}'s estimate change split in two: what the chosen pair was expected to move, and the rest of the move, which no roll explains. No roll on this turn went that way.`
        : `${name}'s estimate change split in two: what the chosen pair was expected to move, and what the actual rolls added on top.`}
    >
      {winDeltaText(analysis.decisionDelta ?? 0)} expected from the choices · {winDeltaText(analysis.chanceDelta ?? 0)} {unrolled ? 'not explained by a roll' : 'from how it rolled'}
    </div>
  );
}

/**
 * Round 80 (T294): the turn's summary sits closed under a one-line toggle, so the card opens on the verdict and both
 * sides. Every turn starts closed (the card keys it by turn), and the app remembers nothing. Round 89 (the user's note on X1): the Lines
 * section and the win-path question fold the same way (`CardToggle`).
 */
function TurnSummary({ text }: { text: string }) {
  return <CardToggle label="Explanation" bodyClassName="ps-eval-analysis-summary">{text}</CardToggle>;
}

/** A game's tip: the position is open, so the card names it as such and shows each side's engine line (round 89, H4h). */
function OpenTurnAnalysis({ analysis, playerNames, reads, onExplore, result, onPickPair, opponentReads }: Omit<EvalTurnAnalysisProps, 'open'>) {
  const exploreFor = (side: 'p1' | 'p2') =>
    onExplore && ((choice: RankedChoice) => onExplore(side, choice, side === 'p1' ? analysis.p2.best : analysis.p1.best, result));
  return (
    <div className="ps-eval-analysis">
      <div className="ps-eval-analysis-row">
        <span style={{ fontWeight: 'bold', fontSize: 11, color: '#cde' }}>Turn {analysis.turn}</span>
        <span style={{ color: '#aab' }}>open position: nothing played yet</span>
        <MatrixDialogButton result={result} analysis={analysis} playerNames={playerNames} onPickPair={onPickPair} />
      </div>
      <EngineRow name={playerNames[0]} side={analysis.p1} onExplore={exploreFor('p1')} opponentReads={opponentReads} />
      <EngineRow name={playerNames[1]} side={analysis.p2} onExplore={exploreFor('p2')} opponentReads={opponentReads} />
      <ReadRows reads={reads} playerNames={playerNames} faintedFraction={analysis.faintedFraction} />
    </div>
  );
}

/** Chess-style explanation of one analyzed turn: played vs best, and why the score moved. */
export function EvalTurnAnalysis({ analysis, playerNames, reads, onExplore, result, linesHost, doubles, open = false, onPickPair, opponentReads }: EvalTurnAnalysisProps) {
  // The turn whose Lines section is open. It follows the turn prop (every turn starts closed) and survives a result that goes away
  // and comes back under the card; reconciled during render, never in an effect.
  const [lines, setLines] = useState({ turn: analysis.turn, open: false });
  if (lines.turn !== analysis.turn) setLines({ turn: analysis.turn, open: false });
  if (open) return <OpenTurnAnalysis analysis={analysis} playerNames={playerNames} reads={reads} onExplore={onExplore} result={result} onPickPair={onPickPair} opponentReads={opponentReads} />;
  const badge = attributionBadge(analysis, playerNames);
  const exploreFor = (side: 'p1' | 'p2') =>
    onExplore && ((choice: RankedChoice) =>
      onExplore(side, choice, side === 'p1' ? analysis.p2.best : analysis.p1.best, result));
  return (
    <div className="ps-eval-analysis">
      <div className="ps-eval-analysis-row">
        <span style={{ fontWeight: 'bold', fontSize: 11, color: '#cde' }}>Turn {analysis.turn}</span>
        {analysis.swing !== null && (
          <span style={{ color: '#aab' }} title={`How much the graph estimate moved for ${playerNames[0]} across this turn, in win-probability points.`}>swing {winDeltaText(analysis.swing)}</span>
        )}
        <span style={{ color: badge.color }}>{badge.text}</span>
        <MatrixDialogButton key={analysis.turn} result={result} analysis={analysis} playerNames={playerNames} onPickPair={onPickPair} />
      </div>
      <TurnSummary key={analysis.turn} text={summarizeTurn(analysis, playerNames)} />
      {analysis.decisionDelta !== null && analysis.chanceDelta !== null && <SplitRow analysis={analysis} name={playerNames[0]} />}
      {analysis.playedTracking === false ? (
        <>
          <EngineRow name={playerNames[0]} side={analysis.p1} onExplore={exploreFor('p1')} opponentReads={opponentReads} />
          <EngineRow name={playerNames[1]} side={analysis.p2} onExplore={exploreFor('p2')} opponentReads={opponentReads} />
        </>
      ) : (
        <>
          <SideRow name={playerNames[0]} side={analysis.p1} onExplore={exploreFor('p1')} lostGround={lostGround(analysis, 'p1')} opponentReads={opponentReads} />
          <SideRow name={playerNames[1]} side={analysis.p2} onExplore={exploreFor('p2')} lostGround={lostGround(analysis, 'p2')} opponentReads={opponentReads} />
        </>
      )}
      <ReadRows reads={reads} playerNames={playerNames} faintedFraction={analysis.faintedFraction} />
      {linesHost && result && (
        <div className="ps-eval-lines">
          <CardToggle label="Lines" lazy open={lines.turn === analysis.turn && lines.open} onToggle={next => setLines({ turn: analysis.turn, open: next })}>
            <LinesSection turn={analysis.turn} result={result} playerNames={playerNames} doubles={!!doubles} host={linesHost} analysis={analysis} />
          </CardToggle>
        </div>
      )}
      {linesHost && <WinPathsEntry turn={analysis.turn} host={linesHost} playerNames={playerNames} doubles={!!doubles} />}
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
