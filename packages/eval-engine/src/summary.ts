import { BREADTH_MIN_OPTIONS, CHANCE_THRESHOLD, type SideAnalysis, type TurnAnalysis } from './analysis.ts';
import { winDeltaText, winPercent } from './winprob.ts';
import { SPOKEN_MASS } from './types.ts';
import { phrase, playedBest } from './prose/phrases.ts';
import {
  forcedClause, inaccuracyClause, sackClause, sensitivityClause, sideClause, streakClause, unansweredClause,
} from './prose/clauses.ts';

/**
 * Annotator-style natural-language rendering of a turn analysis. Pure
 * template composition over the analysis data — deterministic, sim-free,
 * main-bundle safe. Values render as WIN PROBABILITIES for the named player
 * ("52%" absolutes, "+8%" point deltas) — raw wp-units never said whose
 * position they helped. The phrase helpers and the per-side clauses live
 * in prose/.
 */

export { formatRead } from './prose/phrases.ts';

type PlayerNames = [string, string];
type Decided = { key: 'p1' | 'p2'; species: string; announce: boolean } | null;

/** The decided sweep's owner (p1 first, as before), or null on an undecided board. */
function decidedSide(analysis: TurnAnalysis): Decided {
  return analysis.p1.decided
    ? { key: 'p1' as const, ...analysis.p1.decided }
    : analysis.p2.decided
      ? { key: 'p2' as const, ...analysis.p2.decided }
      : null;
}

/** The estimate line: held, moved, or (without an after-score) standing. */
function estimateSentence(analysis: TurnAnalysis, playerNames: PlayerNames): string {
  // Scores are wp-units — winPercent is the calibrated display mapping.
  const before = winPercent(analysis.scoreBefore);
  if (analysis.scoreAfter === null) {
    return `The estimate stands at ${before}% for ${playerNames[0]}.`;
  }
  const after = winPercent(analysis.scoreAfter);
  return before === after
    ? `The estimate held at ${before}% for ${playerNames[0]}.`
    : `The estimate moved from ${before}% to ${after}% for ${playerNames[0]}.`;
}

/** Round 35: the forced-win sentence, spoken at or above SPOKEN_MASS; the four forms of the spec. */
function forcedWinSentence(side: SideAnalysis, player: string): string | null {
  const forced = side.forcedWin;
  if (!forced?.announce || forced.mass < SPOKEN_MASS) return null;
  const tail = forced.caveat === 'barring-crit' ? ', barring a crit' : forced.caveat === 'sampled-rolls' ? ' on the sampled rolls' : '';
  const head = `${player} wins in ${forced.turns} against every reply`;
  if (forced.mass >= 1) return `${head}${tail}.`;
  if (forced.open) {
    const verb = forced.open.kind === 'hit' ? 'lands' : 'knocks out';
    return `${head} if the ${Math.round(forced.open.odds * 100)}% ${forced.open.label} ${verb}${tail}.`;
  }
  return `${head} in ${Math.round(forced.mass * 100)}% of the rolls${tail}.`;
}

/**
 * Round 15: the decided sweep speaks right after the estimate — the board
 * state that explains where the number is headed. Announce-gated: the
 * game report speaks each stage once, the per-turn card on every turn.
 */
function decidedSentences(analysis: TurnAnalysis, playerNames: PlayerNames, decided: Decided): string[] {
  const sentences: string[] = [];
  const forced = [forcedWinSentence(analysis.p1, playerNames[0]), forcedWinSentence(analysis.p2, playerNames[1])]
    .filter((sentence): sentence is string => sentence !== null);
  sentences.push(...forced);
  if (decided?.announce) {
    const opponent = decided.key === 'p1' ? playerNames[1] : playerNames[0];
    sentences.push(`From here ${decided.species} clears everything ${opponent} has left — ` +
      'the game is practically decided.');
  }
  const nearDecided = analysis.p1.nearDecided ?? analysis.p2.nearDecided;
  if (nearDecided?.announce) {
    sentences.push(`${nearDecided.species} is one ${Math.round(nearDecided.odds * 100)}% roll ` +
      `from clearing the rest — removing ${nearDecided.removes} leaves no answer behind.`);
  }
  return sentences;
}

/** A decision or read turn: each side's clause, then the luck rider. */
function decisionSentences(analysis: TurnAnalysis, playerNames: PlayerNames): string[] {
  const sentences: string[] = [];
  const p1Clause = sideClause(playerNames[0], analysis.p1, analysis.p2);
  const p2Clause = sideClause(playerNames[1], analysis.p2, analysis.p1);
  if (p1Clause) sentences.push(p1Clause);
  if (p2Clause) sentences.push(p2Clause);
  if (analysis.chanceDelta !== null && Math.abs(analysis.chanceDelta) >= CHANCE_THRESHOLD) {
    sentences.push(`On top of that, luck contributed ${winDeltaText(analysis.chanceDelta)}.`);
  }
  return sentences;
}

/**
 * Round 15: on a decided board a chance swing TOWARD the decided side is
 * the game resolving, not luck — the same booking the game report has made
 * since round 12, now visible on the turn itself. Chance against the
 * decided side stays genuine luck.
 */
function chanceSentence(analysis: TurnAnalysis, playerNames: PlayerNames, decided: Decided): string {
  const delta = analysis.chanceDelta ?? analysis.swing ?? 0;
  const toward = decided !== null && (decided.key === 'p1' ? delta > 0 : delta < 0);
  return toward
    ? 'Both sides picked reasonable options — the swing is the decided game resolving ' +
      `toward ${decided.key === 'p1' ? playerNames[0] : playerNames[1]} (${winDeltaText(delta)}).`
    : 'Both sides picked reasonable options — the swing came from how the turn rolled ' +
      `(${winDeltaText(delta)}).`;
}

/** The read that was on the table (round 13): the side whose missed read cost more. */
function hindsightSentence(analysis: TurnAnalysis, playerNames: PlayerNames): string | null {
  const reads = [
    { name: playerNames[0], read: analysis.p1.hindsightRead },
    { name: playerNames[1], read: analysis.p2.hindsightRead },
  ].filter((entry): entry is { name: string; read: NonNullable<SideAnalysis['hindsightRead']> } =>
    entry.read !== undefined);
  const missed = reads.sort((a, b) => b.read.gain - a.read.gain)[0];
  if (!missed) return null;
  return `The read was there for ${missed.name} — against the ` +
    `${missed.read.against} actually clicked, ${phrase(missed.read.response)} ` +
    `was worth ${winDeltaText(missed.read.gain)} more.`;
}

/**
 * A culprit-free shift: a wide board on both sides is not a drift — the
 * matrix knew the breadth (562428 t10), so the prose names it: the turn
 * was a prediction contest, and the swing is how the picks collided. Then
 * the concrete counterfactual the matrix knows — the best answer to the
 * opponent's ACTUAL click (562428 t10: → Heatran into the Horn Leech).
 */
function shiftSentences(analysis: TurnAnalysis, playerNames: PlayerNames): string[] {
  const sentences: string[] = [];
  const decomposition = analysis.decisionDelta !== null && analysis.chanceDelta !== null
    ? ` (${winDeltaText(analysis.decisionDelta)} expected, ${winDeltaText(analysis.chanceDelta)} from the rolls)`
    : '';
  const open = (analysis.p1.viableCount ?? 0) >= BREADTH_MIN_OPTIONS &&
    (analysis.p2.viableCount ?? 0) >= BREADTH_MIN_OPTIONS;
  sentences.push(open
    ? `A genuinely open turn rather than a drift — ${analysis.p1.viableCount} of ` +
      `${analysis.p1.choiceCount} options for ${playerNames[0]} and ${analysis.p2.viableCount} of ` +
      `${analysis.p2.choiceCount} for ${playerNames[1]} sat within an inaccuracy of best, so the ` +
      `turn hinged on out-predicting the opponent${decomposition}.`
    : decomposition
      ? `No single mistake stands out — the choices and the rolls pushed the same way${decomposition}.`
      : 'No single mistake stands out — the swing built up without a clear culprit.');
  const hindsight = hindsightSentence(analysis, playerNames);
  if (hindsight) sentences.push(hindsight);
  return sentences;
}

/** The attribution's own sentences: decisions and reads, chance, shift, unclear, or quiet. */
function attributionSentences(analysis: TurnAnalysis, playerNames: PlayerNames, decided: Decided): string[] {
  switch (analysis.attribution) {
    case 'p1-decision':
    case 'p2-decision':
    case 'both-decision':
    case 'p1-read':
    case 'p2-read':
    case 'both-read':
      return decisionSentences(analysis, playerNames);
    case 'chance':
      return [chanceSentence(analysis, playerNames, decided)];
    case 'shift':
      return shiftSentences(analysis, playerNames);
    case 'unclear':
      return ['The score swung, but a choice never surfaced (a Pokémon slept, flinched, or was fully paralyzed) — no blame assigned.'];
    default:
      return [playedBest(analysis.p1) && playedBest(analysis.p2)
        ? "A quiet turn — both sides played the engine's preferred line."
        : 'A quiet turn.'];
  }
}

/**
 * The notes that ride along on any attribution, p1 before p2 per kind:
 * sacks and inaccuracies (the decision clauses only speak at mistake level
 * and up; a sack replaces the inaccuracy note its demoted tier would
 * otherwise produce), forced equilibrium expectations (turn context, not
 * a verdict), entry-is-profit context (round 13), streak cumulation
 * (multi-turn expectation, never a verdict), and sensitivity hinges (the
 * softened tier may have silenced the decision clause entirely, but the
 * hinge itself is the finding).
 */
function rideAlongSentences(analysis: TurnAnalysis, playerNames: PlayerNames): string[] {
  const sentences: string[] = [];
  const kinds: ((name: string, side: SideAnalysis) => string | null)[] = [
    (name, side) => sackClause(name, side) ?? inaccuracyClause(name, side),
    forcedClause,
    (_name, side) => unansweredClause(side),
    streakClause,
    sensitivityClause,
  ];
  for (const clause of kinds) {
    const p1Note = clause(playerNames[0], analysis.p1);
    const p2Note = clause(playerNames[1], analysis.p2);
    if (p1Note) sentences.push(p1Note);
    if (p2Note) sentences.push(p2Note);
  }
  return sentences;
}

export function summarizeTurn(
  analysis: TurnAnalysis,
  playerNames: [string, string],
): string {
  const sentences: string[] = [estimateSentence(analysis, playerNames)];
  const decided = decidedSide(analysis);
  sentences.push(...decidedSentences(analysis, playerNames, decided));

  if (analysis.playedTracking === false) {
    // Played actions were never parsed (doubles) — describe the movement
    // and point at the engine lines; blame is off the table.
    sentences.push(analysis.attribution === 'shift'
      ? "The advantage moved — compare the engine's preferred lines for both sides below."
      : 'A quiet turn.');
    return sentences.join(' ');
  }

  sentences.push(...attributionSentences(analysis, playerNames, decided));
  sentences.push(...rideAlongSentences(analysis, playerNames));
  return sentences.join(' ');
}
