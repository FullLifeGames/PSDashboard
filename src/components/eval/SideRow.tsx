import {
  diffChoices, formatLine, hiddenSlots, playedSetupMove, standsIn, type EvalResult, type SideAnalysis, type RankedChoice, winDeltaText, winPctText,
} from '@fulllifegames/eval-engine';
import { gradedTier } from './game-review';
import { rowLineTail } from '../../lib/row-line';
import { ExplorableLabel, KoSuffix, MiniBar } from './analysis-bits';
import {
  comparisonTarget, ENGINE_EQUIVALENT_EPSILON, engineChoice, evTitle, inaccuracyView, playedTextFor, readsReply, readsWorstLabel, regretView, RISK_DISPLAY_GAP,
} from './turn-copy';

type Explore = ((choice: RankedChoice) => void) | undefined;

interface RowProps {
  name: string;
  side: SideAnalysis;
  names?: readonly string[];
  onExplore?: (choice: RankedChoice) => void;
  lostGround?: boolean;
  opponentReads?: boolean;
  rowLines?: { result: EvalResult | null | undefined; side: 'p1' | 'p2' };
}

function PlayedCell({ name, side, names }: Pick<RowProps, 'name' | 'side' | 'names'>) {
  const { acted, playedText, noChoice } = playedTextFor(side, names);
  const playedGamble = !standsIn(side) && side.played !== null && side.played.ev - side.played.worstCase >= RISK_DISPLAY_GAP;
  return (
    <>
      <span style={{ color: '#aab' }} title={side.played ? evTitle(name) : undefined}>{acted ? 'played ' : ''}{playedText}</span>
      {playedGamble && side.played && (
        <span
          style={{ color: '#778' }}
          title={`If the opponent had picked the most punishing reply, ${name} would have fallen to this win probability: a worst case, not the expected outcome.`}
        >
          · risked {winPctText(side.played.worstCase, side.faintedFraction)}{side.played.punishedBy ? ` vs ${side.played.punishedBy}` : ''}
        </span>
      )}
      {noChoice && (
        <span
          style={{ color: '#778' }}
          title="The engine priced the turn with the best stand-in for this slot; the chance above is that row's, not a choice the log shows."
        >
          · {noChoice}
        </span>
      )}
      {side.playedPartial && hiddenSlots(side) > 0 && (
        <span
          style={{ color: '#778' }}
          title="One slot's choice was never visible (flinched or asleep); graded in the player's favor against the best combo the observed action allows."
        >
          · partner unseen
        </span>
      )}
    </>
  );
}

function EngineCell({ name, side, regretful, onExplore, opponentReads, rowLines }: RowProps & { regretful: boolean }) {
  const engine = engineChoice(side);
  if (!side.best || !engine) return null;
  const best = side.best;
  const explore = onExplore && (() => onExplore(best));
  const reply = readsReply(opponentReads, rowLines, best)?.reply.label;
    // A stand-in for a choice the log does not show earns no tick.
  if (!side.played || standsIn(side)) {
    return (
      <span style={{ color: '#778' }} title={evTitle(name)}>
        engine: <ExplorableLabel label={engine.label} color="#778" onClick={explore} opponentReads={opponentReads} reply={reply} />
        {' '}({winPctText(engine.value, side.faintedFraction)})
      </span>
    );
  }
  if (regretful) return null;
  if (side.played.choice === best.choice) {
    return <ExplorableLabel label="✓ the engine's move" color="#8c8" onClick={explore} opponentReads={opponentReads} reply={reply} />;
  }
  return (
    <span style={{ color: '#778' }} title={evTitle(name)}>
      engine: <ExplorableLabel label={engine.label} color="#778" onClick={explore} opponentReads={opponentReads} reply={reply} />
      {' '}({winPctText(engine.value, side.faintedFraction)})
      {best.ev - side.played.ev < ENGINE_EQUIVALENT_EPSILON && (
        <span title="The win-probability gap is inside noise: the engine considers both picks equally good."> · equivalent</span>
      )}
    </span>
  );
}

function unpunishedTitle(side: SideAnalysis): string {
  const punisher = side.played?.punishedBy ?? 'the punishing reply';
  const held = side.safeAgainstClick;
  return held
    ? `The floor assumes ${punisher}; the opponent chose ${held.against} instead, and against that the safe line did as well or better.`
    : `The floor assumes ${punisher}; the opponent chose differently, so the read came true.`;
}

function RegretCell({ name, side, setupMove }: Pick<RowProps, 'name' | 'side'> & { setupMove: string | null }) {
  if (side.regret === null) return null;
  const view = regretView(name, side, side.regret);
  if (setupMove) {
    return (
      <span
        style={{ color: '#b6a46a' }}
        title={`${setupMove} is a setup move: its payoff lies past the search horizon, so the regret may be overstated.`}
      >
        {view.text} regret · setup caveat
      </span>
    );
  }
  if (side.riskUnpunished) {
    return (
      <span
        style={{ color: '#b6a46a' }}
        title={unpunishedTitle(side)}
      >
        {view.text} regret · risk unpunished
      </span>
    );
  }
  const blunder = side.tier === 'blunder';
  return <span style={{ color: blunder ? '#ff7a7a' : '#f3a6a6' }} title={view.title}>{blunder ? 'blunder' : 'mistake'} · {view.text}</span>;
}

function sackTitle(sacrifice: NonNullable<SideAnalysis['sacrifice']>): string {
  if (sacrifice.hazard) {
    return 'Switched into the entry hazards and fell before acting, so the next Pokémon came in on a free switch: a sacrifice, not graded as a misplay.';
  }
  if (sacrifice.stayed) {
    return sacrifice.verified
      ? 'The body was left in to take the hit the line priced in, and the next turns paid it back: a sacrifice, not graded as a misplay.'
      : "The body was left in to take the hit the line priced in, and the line's payoff lands within the payoff window: a sacrifice, not graded as a misplay.";
  }
  return sacrifice.healthy
    ? 'A healthy body was fed while the engine stayed decisively ahead on both sides of the sack: simplification, not graded as a misplay.'
    : 'A nearly-dead Pokémon was fed on purpose: a low-cost sack, not graded as a misplay.';
}

function ReadPaidOffCell({ side }: Pick<RowProps, 'side'>) {
  return (
    <span
      style={{ color: '#8c8' }}
      title={`The safe line guaranteed ${side.safe ? winPctText(side.safe.worstCase, side.faintedFraction) : '?'}; the actual pair came out ${winDeltaText(side.riskPayoff ?? 0)} better: the read won value.`}
    >
      read paid off · {winDeltaText(side.riskPayoff ?? 0)}
    </span>
  );
}

function InaccuracyCell({ side }: Pick<RowProps, 'side'>) {
  const view = inaccuracyView(side);
  return <span style={{ color: '#b6a46a' }} title={view.title}>· inaccuracy ({view.text})</span>;
}

function VerdictCell({ name, side, regretful, setupMove, lostGround }: Pick<RowProps, 'name' | 'side' | 'lostGround'> & { regretful: boolean; setupMove: string | null }) {
  return (
    <>
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
          title={sackTitle(side.sacrifice)}
        >
          · sacked {side.sacrifice.name} ({Math.round(side.sacrifice.hpFraction * 100)}% HP)
          {side.sacrifice.alsoFell && side.sacrifice.alsoFell.length > 0 ? `, also lost ${side.sacrifice.alsoFell.join(' and ')}` : ''}
        </span>
      )}
      {side.riskPaidOff && !side.sacrifice && !lostGround && <ReadPaidOffCell side={side} />}
      {regretful && !side.sacrifice && !side.riskPaidOff && <RegretCell name={name} side={side} setupMove={setupMove} />}
      {gradedTier(side, lostGround) === 'inaccuracy' && side.best && <InaccuracyCell side={side} />}
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
    </>
  );
}

function ComparisonRows({ name, side, played, best, difference, onExplore, opponentReads, rowLines }: Pick<RowProps, 'name' | 'side' | 'opponentReads' | 'rowLines'> & {
  played: RankedChoice;
  best: RankedChoice;
  difference: string | null;
  onExplore: Explore;
}) {
  const { asSafe, target, swapped, value } = comparisonTarget(side, best);
  const tail = rowLines ? rowLineTail(rowLines.result, rowLines.side, target) : target.line;
  const reads = readsReply(opponentReads, rowLines, target);
  const worstVs = readsWorstLabel(reads, target);
  return (
    <>
      <div className="ps-eval-analysis-row" style={{ color: '#aab' }} title={evTitle(name)}>
        <MiniBar value={played.ev} />
        <span style={{ whiteSpace: 'nowrap' }}>{winPctText(played.ev, side.faintedFraction)} played</span>
        {played.punishedBy && <span style={{ color: '#778' }}>· worst vs {played.punishedBy}</span>}
        <KoSuffix odds={played.koOdds} />
      </div>
      <div className="ps-eval-analysis-row" style={{ color: '#aab' }} title={evTitle(name)}>
        <MiniBar value={value} />
        <span style={{ whiteSpace: 'nowrap' }}>
          {winPctText(value, side.faintedFraction)} {asSafe ? 'safe:' : 'better:'}
        </span>
        {swapped ? (
          <span>{swapped.label}</span>
        ) : (
          <ExplorableLabel
            label={target.label}
            onClick={onExplore && (() => onExplore(target))}
            opponentReads={opponentReads}
            reply={reads?.reply.label}
          />
        )}
        {!swapped && worstVs && <span style={{ color: '#778' }} title={worstVs.title}>· worst vs {worstVs.label}</span>}
        {!swapped && tail && tail.length > 0 && (
          <span className="ps-eval-line">then {formatLine(tail)}</span>
        )}
        <KoSuffix odds={swapped ? swapped.koOdds : target.koOdds} />
      </div>
      {difference && (
        <div className="ps-eval-analysis-row">
          <span style={{ color: '#778' }}>difference:</span>
          <span style={{ color: '#cde' }}>{difference}</span>
        </div>
      )}
    </>
  );
}

function HindsightRow({ line }: { line: string }) {
  return (
    <div className="ps-eval-analysis-row">
      <span
        style={{ color: '#cde' }}
        title="Worked out on the matrix cell of the opponent's actual reply, shown when it lies clear of the regret and rests on enough search."
      >
        {line}
      </span>
    </div>
  );
}

export function SideRow({ name, side, names, onExplore, lostGround, opponentReads, rowLines }: RowProps) {
  const regretful = side.tier === 'mistake' || side.tier === 'blunder';
  const setupMove = playedSetupMove(side);
  const difference = regretful && side.played && side.best && !side.noChoiceSlots?.length ? diffChoices(side.played, side.best) : null;

  return (
    <div className="ps-eval-analysis-side">
      <div className="ps-eval-analysis-row">
        <span style={{ color: '#cde', fontWeight: 'bold' }}>{name}</span>
        <PlayedCell name={name} side={side} names={names} />
        <EngineCell name={name} side={side} regretful={regretful} onExplore={onExplore} opponentReads={opponentReads} rowLines={rowLines} />
        <VerdictCell name={name} side={side} regretful={regretful} setupMove={setupMove} lostGround={lostGround} />
      </div>
      {regretful && side.played && side.best && (
        <ComparisonRows name={name} side={side} played={side.played} best={side.best} difference={difference} onExplore={onExplore} opponentReads={opponentReads} rowLines={rowLines} />
      )}
      {side.hindsightRead?.shown && side.hindsightRead.line && <HindsightRow line={side.hindsightRead.line} />}
    </div>
  );
}
