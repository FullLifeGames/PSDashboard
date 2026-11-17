import { BREADTH_MIN_OPTIONS, CHANCE_THRESHOLD, type SideAnalysis, type TurnAnalysis } from './analysis.ts';
import { winDeltaText, winPercent } from './winprob.ts';
import { forcedWinSpeaks } from './turn-analysis/forced-speech.ts';
import { splitCombinedLabel } from './turn-analysis/played-match.ts';
import { chanceRolled } from './turn-analysis/luck.ts';
import { lostGround, shownAttribution, walkedInto } from './turn-analysis/risk.ts';
import { caveatWords, choiceSentence, delayClause, forcedQualifier, percentBelowSure, phrase, phraseReplies, rollText } from './prose/phrases.ts';
import { sideClause } from './prose/clauses.ts';
import { rideAlongSentences } from './prose/ride-along.ts';
import { QUIET_TURN, hintShown, quietSentences, quietVoiceOf, type QuietVoice } from './prose/quiet.ts';

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
  const before = winPercent(analysis.scoreBefore, analysis.faintedFraction);
  if (analysis.scoreAfter === null) {
    return `The estimate stands at ${before}% for ${playerNames[0]}.`;
  }
  const after = winPercent(analysis.scoreAfter, analysis.faintedFractionAfter);
  return before === after
    ? `The estimate held at ${before}% for ${playerNames[0]}.`
    : `The estimate moved from ${before}% to ${after}% for ${playerNames[0]}.`;
}

/**
 * Round 35: the forced-win sentence, spoken at or above SPOKEN_MASS; the four forms of the spec. Round 63
 * (T19): also under it when the open event holds the own bar down (forcedWinSpeaks), so the card names why.
 */
function forcedWinSentence(side: SideAnalysis, player: string, ownBar: number): string | null {
  const forced = side.forcedWin;
  if (!forced || !forcedWinSpeaks(forced, ownBar)) return null;
  // Round 64 (T123): `turns` is the deepest proven line in own moves, so the win comes within it.
  const head = `${player} wins within ${forced.turns} turn${forced.turns === 1 ? '' : 's'} against every reply`;
  if (forced.open && forced.mass < 1) {
    const verb = forced.open.kind === 'hit' ? 'lands' : 'knocks out';
    return `${head} if the ${percentBelowSure(forced.open.odds)}% ${forced.open.label} ${verb}${caveatWords(forced.caveat)}${delayClause(forced)}.${choiceSentence(forced)}`;
  }
  return `${head}${forcedQualifier(forced)}${delayClause(forced)}.${choiceSentence(forced)}`;
}

/**
 * Round 15: the decided sweep speaks right after the estimate — the board
 * state that explains where the number is headed. Announce-gated: the
 * game report speaks each stage once, the per-turn card on every turn.
 */
function decidedSentences(analysis: TurnAnalysis, playerNames: PlayerNames, decided: Decided): string[] {
  const sentences: string[] = [];
  const forced = [
    forcedWinSentence(analysis.p1, playerNames[0], analysis.scoreBefore),
    forcedWinSentence(analysis.p2, playerNames[1], -analysis.scoreBefore),
  ].filter((sentence): sentence is string => sentence !== null);
  sentences.push(...forced);
  if (decided?.announce) {
    const opponent = decided.key === 'p1' ? playerNames[1] : playerNames[0];
    sentences.push(`From here ${decided.species} clears everything ${opponent} has left: ` +
      'the game is practically decided.');
  }
  const nearDecided = analysis.p1.nearDecided ?? analysis.p2.nearDecided;
  if (nearDecided?.announce) {
    // Round 63 (T18): a click that cannot fail is no roll; round 64 (T123): 99.5% can fail.
    sentences.push(`${nearDecided.species} is one ${rollText(nearDecided.odds)} ` +
      `from clearing the rest; removing ${nearDecided.removes} leaves no answer behind.`);
  }
  return sentences;
}

/** A decision or read turn: each side's clause (round 67, T59: no praise for a side that lost ground), then the luck rider. */
function decisionSentences(analysis: TurnAnalysis, playerNames: PlayerNames): string[] {
  const sentences: string[] = [];
  const p1Clause = sideClause(playerNames[0], analysis.p1, analysis.p2, !lostGround(analysis, 'p1'));
  const p2Clause = sideClause(playerNames[1], analysis.p2, analysis.p1, !lostGround(analysis, 'p2'));
  if (p1Clause) sentences.push(p1Clause);
  if (p2Clause) sentences.push(p2Clause);
  if (analysis.chanceDelta !== null && Math.abs(analysis.chanceDelta) >= CHANCE_THRESHOLD) {
    // Round 67 (T22): luck only with a roll in the residual's direction; the rest is an estimate that moved with no roll behind it (Round 79, T286).
    sentences.push(chanceRolled(analysis) === false
      ? `On top of that, the estimate moved ${winDeltaText(analysis.chanceDelta)} with no roll behind it.`
      : `On top of that, luck contributed ${winDeltaText(analysis.chanceDelta)}.`);
  }
  return sentences;
}

/**
 * Round 15: on a decided board a chance swing TOWARD the decided side is
 * the game resolving, not luck — the same booking the game report has made
 * since round 12, now visible on the turn itself. Chance against the
 * decided side stays genuine luck. Round 67 (T22): a swing without a roll
 * in its direction is an estimate that moved with no roll behind it (649664 t12:
 * the only roll went the other way), so the card says so. Round 70 (gate of
 * 13.10. 20:26, 1a): the sentence of a side that walked into its punisher
 * follows, the hindsight read it missed.
 */
function chanceSentences(analysis: TurnAnalysis, playerNames: PlayerNames, decided: Decided): string[] {
  const delta = analysis.chanceDelta ?? analysis.swing ?? 0;
  const toward = decided !== null && (decided.key === 'p1' ? delta > 0 : delta < 0);
  if (toward) {
    return ['Both sides picked reasonable options; the swing is the decided game resolving ' +
      `toward ${decided.key === 'p1' ? playerNames[0] : playerNames[1]} (${winDeltaText(delta)}).`];
  }
  const sentence = chanceRolled(analysis) === false
    ? `Both sides picked reasonable options; the estimate moved ${winDeltaText(delta)} with no roll behind it.`
    : 'Both sides picked reasonable options; the swing came from how the turn rolled ' +
      `(${winDeltaText(delta)}).`;
  // Round 70 (gate of 13.10. 20:26, 1a): a side that walked into its punisher gets the read it missed after the luck sentence.
  const walked = walkedSentence(analysis, playerNames);
  return walked ? [sentence, walked] : [sentence];
}

/** The hindsight read of a side that walked into its played line's punisher (or a click that ties it), if its cell is solid. */
function walkedSentence(analysis: TurnAnalysis, playerNames: PlayerNames): string | null {
  return hindsightSentence(analysis, playerNames, side => walkedInto(analysis[side], analysis[side === 'p1' ? 'p2' : 'p1']));
}

/**
 * The read that was on the table (round 13): the side whose missed read cost more. Round 69 (T64): a read on a cell
 * that is a guess (a thin cell, 912045 t8) is not quoted.
 */
function hindsightSentence(
  analysis: TurnAnalysis, playerNames: PlayerNames, only: (side: 'p1' | 'p2') => boolean = () => true,
): string | null {
  const reads = [
    { side: 'p1' as const, name: playerNames[0], read: analysis.p1.hindsightRead },
    { side: 'p2' as const, name: playerNames[1], read: analysis.p2.hindsightRead },
  ].filter((entry): entry is { side: 'p1' | 'p2'; name: string; read: NonNullable<SideAnalysis['hindsightRead']> } =>
    entry.read !== undefined && !entry.read.thin && only(entry.side));
  const missed = reads.sort((a, b) => b.read.gain - a.read.gain)[0];
  if (!missed) return null;
  // Round 47: a click the opponent model favoured was findable before it came.
  // Round 69 (T179): a doubles pair of clicks reads per slot; "the <pair> actually clicked" would not parse.
  const clicked = phraseReplies(missed.read.against);
  const lead = missed.read.likeliest !== undefined
    ? `${clicked} was the likeliest click on the opponent model ` +
      `(${Math.round(missed.read.likeliest * 100)}%), and against it`
    : splitCombinedLabel(missed.read.against).length > 1 ? `against what was actually clicked (${clicked}),` : `against the ${clicked} actually clicked,`;
  return `The read was there for ${missed.name}: ${lead} ${phrase(missed.read.response)} ` +
    `was worth ${winDeltaText(missed.read.gain)} more.`;
}

/**
 * Round 47: the read before the click — the opponent model is sure of its
 * favourite, and an own row beats the displayed recommendation against it
 * by a mistake-sized gain. One sentence per turn: the side with more to gain.
 */
function predictiveSentence(analysis: TurnAnalysis, playerNames: PlayerNames): string | null {
  const reads = [
    { name: playerNames[0], read: analysis.p1.predictiveRead },
    { name: playerNames[1], read: analysis.p2.predictiveRead },
  ].filter((entry): entry is { name: string; read: NonNullable<SideAnalysis['predictiveRead']> } =>
    entry.read !== undefined);
  const top = reads.sort((a, b) => b.read.gain - a.read.gain)[0];
  if (!top) return null;
  return `If ${top.name} expects ${phraseReplies(top.read.expect)} (${Math.round(top.read.confidence * 100)}% on the opponent model), ` +
    `${phrase(top.read.response)} is the move: ${winDeltaText(top.read.gain)} over ${phrase(top.read.over)} against it.`;
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
  // Round 67 (T22): the chance part says no roll is behind it when no roll went its way.
  const unrolled = chanceRolled(analysis) === false;
  const decomposition = analysis.decisionDelta !== null && analysis.chanceDelta !== null
    ? ` (${winDeltaText(analysis.decisionDelta)} expected, ${winDeltaText(analysis.chanceDelta)} ` +
      `${unrolled ? 'with no roll behind it' : 'from the rolls'})`
    : '';
  const open = (analysis.p1.viableCount ?? 0) >= BREADTH_MIN_OPTIONS &&
    (analysis.p2.viableCount ?? 0) >= BREADTH_MIN_OPTIONS;
  // Round 70 (gate of 13.10. 20:26, 2a): a shift can now hold parts that pull against each other (a decision part larger than the residual).
  const parts = analysis.decisionDelta !== null && analysis.chanceDelta !== null && analysis.decisionDelta * analysis.chanceDelta < 0
    ? 'pulled in opposite directions'
    : 'pushed the same way';
  sentences.push(open
    ? `A genuinely open turn rather than a drift: ${analysis.p1.viableCount} of ` +
      `${analysis.p1.choiceCount} options for ${playerNames[0]} and ${analysis.p2.viableCount} of ` +
      `${analysis.p2.choiceCount} for ${playerNames[1]} sat within an inaccuracy of best, so the ` +
      `turn hinged on out-predicting the opponent${decomposition}.`
    : decomposition
      ? `No single mistake stands out; the choices and ${unrolled ? 'the part no roll explains' : 'the rolls'} ${parts}${decomposition}.`
      : 'No single mistake stands out; the swing built up without a clear culprit.');
  const hindsight = hindsightSentence(analysis, playerNames);
  if (hindsight) sentences.push(hindsight);
  return sentences;
}

/**
 * The attribution's own sentences: decisions and reads, chance, shift, unclear, or quiet. Round 67 (T59): as
 * shown, so a read whose side lost ground tells the turn's movement instead (the attribution field stays).
 */
function attributionSentences(analysis: TurnAnalysis, playerNames: PlayerNames, decided: Decided, othersSpeak: boolean): string[] {
  switch (shownAttribution(analysis)) {
    case 'p1-decision':
    case 'p2-decision':
    case 'both-decision':
    case 'p1-read':
    case 'p2-read':
    case 'both-read':
      return decisionSentences(analysis, playerNames);
    case 'chance':
      return chanceSentences(analysis, playerNames, decided);
    case 'shift':
      return shiftSentences(analysis, playerNames);
    case 'unclear':
      return ['The score swung, but a choice never surfaced (a Pokémon slept, flinched, or was fully paralyzed), so no blame is assigned.'];
    default:
      // Round 76 (T233): a quiet card keeps the read a chance card shows (round 70, 1a) where the cell is solid.
      return quietSentences(analysis, walkedSentence(analysis, playerNames), othersSpeak);
  }
}

/** The sentences that stand beside the quiet sentence: decided, predictive and ride-along, and whether a side row shows a hint. */
function cardSpeakers(analysis: TurnAnalysis, playerNames: PlayerNames, decided: Decided) {
  const beside = [...decidedSentences(analysis, playerNames, decided), predictiveSentence(analysis, playerNames) ?? []].flat();
  const rideAlong = rideAlongSentences(analysis, playerNames);
  const standing = beside.length > 0 || hintShown(analysis);
  return { beside, rideAlong, standing, othersSpeak: standing || rideAlong.length > 0 };
}

/**
 * Round 89 (B8a): how the turn's quiet card speaks: "A quiet turn." alone, "Neither side made a mistake." beside another sentence
 * or a shown hint, or no sentence where a side carries a mistake tier. The badge reads it too.
 */
export function quietVoice(analysis: TurnAnalysis, playerNames: PlayerNames): QuietVoice {
  const { standing, othersSpeak } = cardSpeakers(analysis, playerNames, decidedSide(analysis));
  // Without played actions the card cannot claim that no one made a mistake, and it shows no ride-along notes.
  if (analysis.playedTracking === false) return standing ? 'silent' : 'alone';
  return quietVoiceOf(analysis, othersSpeak || walkedSentence(analysis, playerNames) !== null);
}

export function summarizeTurn(
  analysis: TurnAnalysis,
  playerNames: [string, string],
): string {
  const decided = decidedSide(analysis);
  const { beside, rideAlong, standing, othersSpeak } = cardSpeakers(analysis, playerNames, decided);
  const sentences: string[] = [estimateSentence(analysis, playerNames), ...beside];

  if (analysis.playedTracking === false) {
    // Played actions were never parsed (doubles): describe the movement and point at the engine lines; blame is off the table,
    // so the card cannot say that no one made a mistake (round 89, B8a).
    if (analysis.attribution === 'shift') sentences.push("The advantage moved; compare the engine's preferred lines for both sides below.");
    else if (!standing) sentences.push(QUIET_TURN);
    return sentences.join(' ');
  }

  sentences.push(...attributionSentences(analysis, playerNames, decided, othersSpeak), ...rideAlong);
  return sentences.join(' ');
}
