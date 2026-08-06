import { CHANCE_THRESHOLD, REGRET_THRESHOLD, diffChoices, playedSetupMove, type SideAnalysis, type TurnAnalysis } from './analysis';

/**
 * Annotator-style natural-language rendering of a turn analysis. Pure
 * template composition over the analysis data — deterministic, sim-free,
 * main-bundle safe.
 */

/** Advantage as the p1 percentage, mirroring the eval bar. */
const pct = (score: number) => Math.round(50 + 50 * score);

/** Signed value with a typographic minus (matches the panel's tone). */
export const signedValue = (value: number) =>
  value < 0 ? `−${Math.abs(value).toFixed(2)}` : `+${value.toFixed(2)}`;

/** Choice labels read as prose: "→ Dragapult" becomes "switching to Dragapult". */
export const labelPhrase = (label: string) => (label.startsWith('→ ') ? `switching to ${label.slice(2)}` : label);

const signed = signedValue;
const phrase = labelPhrase;

const playedBest = (side: SideAnalysis) =>
  side.played !== null && side.best !== null && side.played.choice === side.best.choice;

/** A flagged risk that won value over the safe guarantee — praised, not blamed. */
function readClause(name: string, side: SideAnalysis, opponent: SideAnalysis): string | null {
  if (!side.riskPaidOff || !side.played || !side.safe) return null;
  const came = opponent.played ? `; ${phrase(opponent.played.label)} came instead` : '';
  const priced = side.played.punishedBy ? ` The floor priced in ${side.played.punishedBy}${came}.` : '';
  return `${name} played ${phrase(side.played.label)} — a read that paid off, ` +
    `${signed(side.riskPayoff ?? 0)} over the safe ${phrase(side.safe.label)} (${signed(side.safe.worstCase)}).${priced}`;
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
  if ((side.regret ?? 0) < REGRET_THRESHOLD || !side.played || !side.best) return null;
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
    // assessment, and holding is no achievement.
    const came = side.played.punishedBy && opponent.played
      ? `its floor risked ${side.played.punishedBy} (${signed(side.played.worstCase)}); ${phrase(opponent.played.label)} came instead`
      : `its floor sat at ${signed(side.played.worstCase)}`;
    return `${name} played ${phrase(side.played.label)} — a read: ${came}. ` +
      `The engine's safe line was ${phrase(side.safe.label)} (${signed(side.safe.worstCase)})${lineOf(side.safe)}.${why}${caveat}`;
  }
  // The punished misplay reads in EV terms: what the choice was worth against
  // balanced play, vs what the engine's line was worth.
  return `${name} played ${phrase(side.played.label)} (${signed(side.played.ev)}); ` +
    `safer was ${phrase(side.best.label)} (${signed(side.best.ev)})${lineOf(side.best)}.${why}${caveat}`;
}

export function summarizeTurn(analysis: TurnAnalysis, playerNames: [string, string]): string {
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
        sentences.push(`On top of that, luck contributed ${signed(analysis.chanceDelta)}.`);
      }
      break;
    }
    case 'chance':
      sentences.push('Both sides picked reasonable options — the swing came from how the turn rolled ' +
        `(${signed(analysis.chanceDelta ?? analysis.swing ?? 0)}).`);
      break;
    case 'shift':
      sentences.push(analysis.decisionDelta !== null && analysis.chanceDelta !== null
        ? 'No single mistake stands out — the choices and the rolls pushed the same way ' +
          `(${signed(analysis.decisionDelta)} expected, ${signed(analysis.chanceDelta)} from the rolls).`
        : 'No single mistake stands out — the swing built up without a clear culprit.');
      break;
    case 'unclear':
      sentences.push('The score swung, but a choice never surfaced (a Pokémon fainted or was fully prevented) — no blame assigned.');
      break;
    default:
      sentences.push(playedBest(analysis.p1) && playedBest(analysis.p2)
        ? "A quiet turn — both sides played the engine's preferred line."
        : 'A quiet turn.');
  }

  return sentences.join(' ');
}
