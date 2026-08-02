import { CHANCE_THRESHOLD, REGRET_THRESHOLD, type SideAnalysis, type TurnAnalysis } from './analysis';

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

function mistakeClause(name: string, side: SideAnalysis): string | null {
  if ((side.regret ?? 0) < REGRET_THRESHOLD || !side.played || !side.best) return null;
  const line = side.best.line && side.best.line.length > 0
    ? `, then ${side.best.line.map(step => `${step.p1} · ${step.p2}`).join(' → ')}`
    : '';
  return `${name} played ${phrase(side.played.label)} (${signed(side.played.worstCase)}); ` +
    `safer was ${phrase(side.best.label)} (${signed(side.best.worstCase)})${line}.`;
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

  switch (analysis.attribution) {
    case 'p1-decision':
    case 'p2-decision':
    case 'both-decision': {
      const p1Clause = mistakeClause(playerNames[0], analysis.p1);
      const p2Clause = mistakeClause(playerNames[1], analysis.p2);
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
