import { diffChoices, playedSetupMove, type SideAnalysis } from '../../lib/eval/analysis';
import type { RankedChoice } from '../../lib/eval/types';
import { winDeltaText, winPctText } from '../../lib/eval/winprob';
import { ExplorableLabel, KoSuffix, MiniBar } from './analysis-bits';
import { comparisonTarget, ENGINE_EQUIVALENT_EPSILON, evTitle, playedTextFor, RISK_DISPLAY_GAP } from './turn-copy';

type Explore = ((choice: RankedChoice) => void) | undefined;

interface RowProps {
  name: string;
  side: SideAnalysis;
  onExplore?: (choice: RankedChoice) => void;
}

function PlayedCell({ name, side }: Pick<RowProps, 'name' | 'side'>) {
  const { acted, playedText } = playedTextFor(side);
  const playedGamble = side.played !== null && side.played.ev - side.played.worstCase >= RISK_DISPLAY_GAP;
  return (
    <>
      <span style={{ color: '#aab' }} title={side.played ? evTitle(name) : undefined}>{acted ? 'played ' : ''}{playedText}</span>
      {playedGamble && side.played && (
        <span
          style={{ color: '#778' }}
          title={`If the opponent had picked the most punishing reply, ${name} would have fallen to this win probability: a worst case, not the expected outcome.`}
        >
          · risked {winPctText(side.played.worstCase)}{side.played.punishedBy ? ` vs ${side.played.punishedBy}` : ''}
        </span>
      )}
      {side.playedPartial && (
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

/** The engine's line next to the played one: agreement, a better line, or the line when nothing was played. */
function EngineCell({ name, side, regretful, onExplore }: RowProps & { regretful: boolean }) {
  if (!side.best) return null;
  const best = side.best;
  const explore = onExplore && (() => onExplore(best));
  if (!side.played) {
    return (
      <span style={{ color: '#778' }} title={evTitle(name)}>
        engine: <ExplorableLabel label={best.label} color="#778" onClick={explore} />
        {' '}({winPctText(best.ev)})
      </span>
    );
  }
  if (regretful) return null;
  if (side.played.choice === best.choice) {
    return <ExplorableLabel label="✓ the engine's move" color="#8c8" onClick={explore} />;
  }
  return (
    <span style={{ color: '#778' }} title={evTitle(name)}>
      engine: <ExplorableLabel label={best.label} color="#778" onClick={explore} />
      {' '}({winPctText(best.ev)})
      {best.ev - side.played.ev < ENGINE_EQUIVALENT_EPSILON && (
        <span title="The win-probability gap is inside noise: the engine considers both picks equally good."> · equivalent</span>
      )}
    </span>
  );
}

/** The graded regret chip: setup caveat, unpunished risk, blunder, or mistake. */
function RegretCell({ name, side, setupMove }: Pick<RowProps, 'name' | 'side'> & { setupMove: string | null }) {
  if (side.regret === null) return null;
  if (setupMove) {
    return (
      <span
        style={{ color: '#b6a46a' }}
        title={`${setupMove} is a setup move: its payoff lies past the search horizon, so the regret may be overstated.`}
      >
        {winDeltaText(-side.regret)} regret · setup caveat
      </span>
    );
  }
  if (side.riskUnpunished) {
    return (
      <span
        style={{ color: '#b6a46a' }}
        title={`The floor assumes ${side.played?.punishedBy ?? 'the punishing reply'}; the opponent chose differently, so the read came true.`}
      >
        {winDeltaText(-side.regret)} regret · risk unpunished
      </span>
    );
  }
  if (side.tier === 'blunder') {
    return <span style={{ color: '#ff7a7a' }} title={`${name} gave up this much win probability vs the engine's best.`}>blunder · {winDeltaText(-side.regret)}</span>;
  }
  return <span style={{ color: '#f3a6a6' }} title={`${name} gave up this much win probability vs the engine's best.`}>mistake · {winDeltaText(-side.regret)}</span>;
}

/** The read that beat the safe line's guarantee. */
function ReadPaidOffCell({ side }: Pick<RowProps, 'side'>) {
  return (
    <span
      style={{ color: '#8c8' }}
      title={`The safe line guaranteed ${side.safe ? winPctText(side.safe.worstCase) : '?'}; the actual pair came out ${winDeltaText(side.riskPayoff ?? 0)} better: the read won value.`}
    >
      read paid off · {winDeltaText(side.riskPayoff ?? 0)}
    </span>
  );
}

function VerdictCell({ name, side, regretful, setupMove }: Pick<RowProps, 'name' | 'side'> & { regretful: boolean; setupMove: string | null }) {
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
          title={side.sacrifice.healthy
            ? 'A healthy body was fed while the engine stayed decisively ahead on both sides of the sack: simplification, not graded as a misplay.'
            : 'A nearly-dead Pokémon was fed on purpose: a low-cost sack, not graded as a misplay.'}
        >
          · sacked {side.sacrifice.name} ({Math.round(side.sacrifice.hpFraction * 100)}% HP)
        </span>
      )}
      {side.riskPaidOff && !side.sacrifice && <ReadPaidOffCell side={side} />}
      {regretful && !side.sacrifice && !side.riskPaidOff && <RegretCell name={name} side={side} setupMove={setupMove} />}
      {side.tier === 'inaccuracy' && side.best && (
        <span
          style={{ color: '#b6a46a' }}
          title={`${side.best.label} was a touch better: a minor imprecision, not a mistake.`}
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
    </>
  );
}

/** The played line against its reference (safe line or ev-best) with the difference, for regretful rows. */
function ComparisonRows({ name, side, played, best, difference, onExplore }: Pick<RowProps, 'name' | 'side'> & {
  played: RankedChoice;
  best: RankedChoice;
  difference: string | null;
  onExplore: Explore;
}) {
  const { asSafe, target, swapped, value } = comparisonTarget(side, best);
  return (
    <>
      <div className="ps-eval-analysis-row" style={{ color: '#aab' }} title={evTitle(name)}>
        <MiniBar value={played.ev} />
        <span style={{ whiteSpace: 'nowrap' }}>{winPctText(played.ev)} played</span>
        {played.punishedBy && <span style={{ color: '#778' }}>· worst vs {played.punishedBy}</span>}
        <KoSuffix odds={played.koOdds} />
      </div>
      <div className="ps-eval-analysis-row" style={{ color: '#aab' }} title={evTitle(name)}>
        <MiniBar value={value} />
        <span style={{ whiteSpace: 'nowrap' }}>
          {winPctText(value)} {asSafe ? 'safe:' : 'better:'}
        </span>
        {swapped ? (
          <span>{swapped.label}</span>
        ) : (
          <ExplorableLabel
            label={target.label}
            onClick={onExplore && (() => onExplore(target))}
          />
        )}
        {!swapped && target.punishedBy && <span style={{ color: '#778' }}>· worst vs {target.punishedBy}</span>}
        {!swapped && target.line && target.line.length > 0 && (
          <span className="ps-eval-line">then {target.line.map(step => `${step.p1} · ${step.p2}`).join(' → ')}</span>
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

/** One tracked side of an analyzed turn: what it played, the engine's line, the verdict, and the comparison. */
export function SideRow({ name, side, onExplore }: RowProps) {
  const regretful = side.tier === 'mistake' || side.tier === 'blunder';
  const setupMove = playedSetupMove(side);
  const difference = regretful && side.played && side.best ? diffChoices(side.played, side.best) : null;

  return (
    <div className="ps-eval-analysis-side">
      <div className="ps-eval-analysis-row">
        <span style={{ color: '#cde', fontWeight: 'bold' }}>{name}</span>
        <PlayedCell name={name} side={side} />
        <EngineCell name={name} side={side} regretful={regretful} onExplore={onExplore} />
        <VerdictCell name={name} side={side} regretful={regretful} setupMove={setupMove} />
      </div>
      {regretful && side.played && side.best && (
        <ComparisonRows name={name} side={side} played={side.played} best={side.best} difference={difference} onExplore={onExplore} />
      )}
    </div>
  );
}
