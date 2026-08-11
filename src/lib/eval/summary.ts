import { CHANCE_THRESHOLD, diffChoices, playedSetupMove, type SideAnalysis, type TurnAnalysis } from './analysis';
import { winDeltaText, winPctText, winPercent } from './winprob';

/**
 * Annotator-style natural-language rendering of a turn analysis. Pure
 * template composition over the analysis data — deterministic, sim-free,
 * main-bundle safe. Values render as WIN PROBABILITIES for the named player
 * ("52%" absolutes, "+8%" point deltas) — raw wp-units never said whose
 * position they helped.
 */

/** Choice labels read as prose: "→ Dragapult" becomes "switching to Dragapult". */
export const labelPhrase = (label: string) => (label.startsWith('→ ') ? `switching to ${label.slice(2)}` : label);

const phrase = labelPhrase;

const playedBest = (side: SideAnalysis) =>
  side.played !== null && side.best !== null && side.played.choice === side.best.choice;

/** A flagged risk that won value over the safe guarantee — praised, not blamed. */
function readClause(name: string, side: SideAnalysis, opponent: SideAnalysis): string | null {
  if (!side.riskPaidOff || !side.played || !side.safe) return null;
  const came = opponent.played ? `; ${phrase(opponent.played.label)} came instead` : '';
  const priced = side.played.punishedBy ? ` The floor priced in ${side.played.punishedBy}${came}.` : '';
  const horizon = side.riskPayoffTurn
    ? side.riskPayoffTurn === 1 ? ' one turn later' : ` ${side.riskPayoffTurn} turns later`
    : '';
  return `${name} played ${phrase(side.played.label)} — a read that paid off${horizon}, ` +
    `${winDeltaText(side.riskPayoff ?? 0)} over the safe ${phrase(side.safe.label)} (${winPctText(side.safe.worstCase)} guaranteed).${priced}`;
}

function sideClause(name: string, side: SideAnalysis, opponent: SideAnalysis): string | null {
  const clause = readClause(name, side, opponent) ?? mistakeClause(name, side, opponent);
  if (!clause) return null;
  // A charitable partial grade must say so — one slot's choice was never
  // visible (flinch/sleep), so the combo shown is the best consistent one.
  return side.playedPartial
    ? `${clause} (Partner's action hidden — graded on the visible slot.)`
    : clause;
}

function mistakeClause(name: string, side: SideAnalysis, opponent: SideAnalysis): string | null {
  if (side.sacrifice) return null; // the sack note carries the turn instead
  if ((side.tier !== 'mistake' && side.tier !== 'blunder') || !side.played || !side.best) return null;
  const lineOf = (choice: { line?: { p1: string; p2: string }[] }) =>
    choice.line && choice.line.length > 0
      ? `, then ${choice.line.map(step => `${step.p1} · ${step.p2}`).join(' → ')}`
      : '';
  const difference = diffChoices(side.played, side.best);
  const why = difference ? ` The difference: ${difference}.` : '';
  const setup = playedSetupMove(side);
  const caveat = setup
    ? ` (${setup} is a setup move — its payoff lies past the search horizon, so the regret may be overstated.)`
    : '';
  if (side.riskUnpunished && side.safe) {
    // An unpunished read gets neutral framing: the engine's line is "safe",
    // not "better" — maximin's guarantee always merely holds the current
    // assessment, and holding is no achievement. When the opponent model's
    // own best response matches the play, credit the read explicitly.
    const came = side.played.punishedBy && opponent.played
      ? `its floor risked ${side.played.punishedBy} (down to ${winPctText(side.played.worstCase)}); ${phrase(opponent.played.label)} came instead`
      : `its floor sat at ${winPctText(side.played.worstCase)}`;
    const framing = side.riskWasRead
      ? `a read against the opponent's tendencies: ${came}`
      : `a read: ${came}`;
    return `${name} played ${phrase(side.played.label)} — ${framing}. ` +
      `The engine's safe line was ${phrase(side.safe.label)} (${winPctText(side.safe.worstCase)} guaranteed)${lineOf(side.safe)}.${why}${caveat}`;
  }
  // The punished misplay reads in EV terms: what the choice was worth against
  // balanced play, vs what the engine's line was worth. A blunder earns the
  // word; a mistake keeps the softer framing.
  if (side.tier === 'blunder') {
    return `${name} played ${phrase(side.played.label)} (${winPctText(side.played.ev)}) — ` +
      `a blunder; clearly better was ${phrase(side.best.label)} (${winPctText(side.best.ev)})${lineOf(side.best)}.${why}${caveat}`;
  }
  return `${name} played ${phrase(side.played.label)} (${winPctText(side.played.ev)}); ` +
    `safer was ${phrase(side.best.label)} (${winPctText(side.best.ev)})${lineOf(side.best)}.${why}${caveat}`;
}

/**
 * One-line rendering of an exploitative read recommendation (the Read row):
 * the payoff SPREAD stays visible — a read is a priced gamble, not a mean.
 */
export function formatRead(read: {
  choice: { label: string };
  net: number;
  breakdown: { label: string; prob: number; value: number }[];
}): string {
  const target = read.choice.label.startsWith('→ ')
    ? `switch ${read.choice.label.slice(2)}`
    : read.choice.label;
  const parts = read.breakdown
    .map(entry => `${winPctText(entry.value)} if ${entry.label} (${Math.round(entry.prob * 100)}% likely)`)
    .join(', ');
  return `Read: ${target}${parts ? ` — ${parts}` : ''} — net ${winPctText(read.net)}.`;
}

/** Sub-verdict note: a light imprecision worth naming, not blaming. */
function inaccuracyClause(name: string, side: SideAnalysis): string | null {
  if (side.tier !== 'inaccuracy' || !side.played || !side.best) return null;
  return `${name}'s ${phrase(side.played.label)} was an inaccuracy — ` +
    `${phrase(side.best.label)} was slightly better (${winPctText(side.best.ev)} vs ${winPctText(side.played.ev)}).`;
}

/**
 * A deliberate low-cost sack: neutral framing, no blame vocabulary — the
 * engine cannot see the intent (Trick absorption, momentum), only the cost.
 */
function sackClause(name: string, side: SideAnalysis): string | null {
  if (!side.sacrifice) return null;
  const pct = Math.round(side.sacrifice.hpFraction * 100);
  return side.sacrifice.healthy
    ? `${name} sacked a healthy ${side.sacrifice.name} (${pct}% HP) while decisively ahead — simplification, not graded as a misplay.`
    : `${name} sacked ${side.sacrifice.name} (${pct}% HP) — a low-cost trade, not graded as a misplay.`;
}

/**
 * The verdict hinges on a guessed item: name the split so the reader knows
 * the grade depends on hidden information, not on the engine's confidence.
 */
function sensitivityClause(name: string, side: SideAnalysis): string | null {
  if (!side.sensitivity) return null;
  const alternatives = side.sensitivity.alternatives
    .map(alternative => `${alternative.item}: ${alternative.tier === 'none' ? 'fine' : alternative.tier}`)
    .join(' · ');
  return `${name}'s verdict hinges on ${side.sensitivity.species}'s item (${alternatives}).`;
}

export function summarizeTurn(
  analysis: TurnAnalysis,
  playerNames: [string, string],
): string {
  // Scores are wp-units — winPercent is the calibrated display mapping.
  const pct = (score: number) => winPercent(score);
  const sentences: string[] = [];
  const before = pct(analysis.scoreBefore);
  if (analysis.scoreAfter === null) {
    sentences.push(`The estimate stands at ${before}% for ${playerNames[0]}.`);
  } else {
    const after = pct(analysis.scoreAfter);
    sentences.push(before === after
      ? `The estimate held at ${before}% for ${playerNames[0]}.`
      : `The estimate moved from ${before}% to ${after}% for ${playerNames[0]}.`);
  }

  if (analysis.playedTracking === false) {
    // Played actions were never parsed (doubles) — describe the movement
    // and point at the engine lines; blame is off the table.
    sentences.push(analysis.attribution === 'shift'
      ? "The advantage moved — compare the engine's preferred lines for both sides below."
      : 'A quiet turn.');
    return sentences.join(' ');
  }

  switch (analysis.attribution) {
    case 'p1-decision':
    case 'p2-decision':
    case 'both-decision':
    case 'p1-read':
    case 'p2-read':
    case 'both-read': {
      const p1Clause = sideClause(playerNames[0], analysis.p1, analysis.p2);
      const p2Clause = sideClause(playerNames[1], analysis.p2, analysis.p1);
      if (p1Clause) sentences.push(p1Clause);
      if (p2Clause) sentences.push(p2Clause);
      if (analysis.chanceDelta !== null && Math.abs(analysis.chanceDelta) >= CHANCE_THRESHOLD) {
        sentences.push(`On top of that, luck contributed ${winDeltaText(analysis.chanceDelta)}.`);
      }
      break;
    }
    case 'chance':
      sentences.push('Both sides picked reasonable options — the swing came from how the turn rolled ' +
        `(${winDeltaText(analysis.chanceDelta ?? analysis.swing ?? 0)}).`);
      break;
    case 'shift':
      sentences.push(analysis.decisionDelta !== null && analysis.chanceDelta !== null
        ? 'No single mistake stands out — the choices and the rolls pushed the same way ' +
          `(${winDeltaText(analysis.decisionDelta)} expected, ${winDeltaText(analysis.chanceDelta)} from the rolls).`
        : 'No single mistake stands out — the swing built up without a clear culprit.');
      break;
    case 'unclear':
      sentences.push('The score swung, but a choice never surfaced (a Pokémon slept, flinched, or was fully paralyzed) — no blame assigned.');
      break;
    default:
      sentences.push(playedBest(analysis.p1) && playedBest(analysis.p2)
        ? "A quiet turn — both sides played the engine's preferred line."
        : 'A quiet turn.');
  }

  // Sacks and inaccuracies ride along on any attribution — the decision
  // clauses above only speak at mistake level and up. A sack replaces the
  // inaccuracy note its demoted tier would otherwise produce.
  const p1Note = sackClause(playerNames[0], analysis.p1) ?? inaccuracyClause(playerNames[0], analysis.p1);
  const p2Note = sackClause(playerNames[1], analysis.p2) ?? inaccuracyClause(playerNames[1], analysis.p2);
  if (p1Note) sentences.push(p1Note);
  if (p2Note) sentences.push(p2Note);

  // Sensitivity hinges also ride along: the softened tier may have silenced
  // the decision clause entirely, but the hinge itself is the finding.
  const p1Hinge = sensitivityClause(playerNames[0], analysis.p1);
  const p2Hinge = sensitivityClause(playerNames[1], analysis.p2);
  if (p1Hinge) sentences.push(p1Hinge);
  if (p2Hinge) sentences.push(p2Hinge);

  return sentences.join(' ');
}
