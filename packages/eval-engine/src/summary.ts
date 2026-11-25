import { BREADTH_MIN_OPTIONS, CHANCE_THRESHOLD, type SideAnalysis, type TurnAnalysis } from './analysis.ts';
import { winDeltaText, winPercent } from './winprob.ts';
import { forcedWinSpeaks } from './turn-analysis/forced-speech.ts';
import { splitCombinedLabel } from './turn-analysis/played-match.ts';
import { chanceRolled } from './turn-analysis/luck.ts';
import { lostGround, shownAttribution, walkedInto } from './turn-analysis/risk.ts';
import { caveatWords, choiceSentence, delayClause, forcedQualifier, percentBelowSure, phrase, phraseReplies, rollText } from './prose/phrases.ts';
import { sideClause } from './prose/clauses.ts';
import { rideAlongOf } from './prose/ride-along.ts';
import { QUIET_TURN, hintShown, quietSentences, quietVoiceOf, type QuietVoice } from './prose/quiet.ts';
import type { NamedJudgement } from './prose/ride-along.ts';

// Pure template composition: deterministic, sim-free, main-bundle safe.

export { formatRead } from './prose/phrases.ts';

type PlayerNames = [string, string];
type Decided = { key: 'p1' | 'p2'; species: string; announce: boolean } | null;

function decidedSide(analysis: TurnAnalysis): Decided {
  return analysis.p1.decided
    ? { key: 'p1' as const, ...analysis.p1.decided }
    : analysis.p2.decided
      ? { key: 'p2' as const, ...analysis.p2.decided }
      : null;
}

function estimateSentence(analysis: TurnAnalysis, playerNames: PlayerNames): string {
  const before = winPercent(analysis.scoreBefore, analysis.faintedFraction);
  if (analysis.scoreAfter === null) {
    return `The estimate stands at ${before}% for ${playerNames[0]}.`;
  }
  const after = winPercent(analysis.scoreAfter, analysis.faintedFractionAfter);
  return before === after
    ? `The estimate held at ${before}% for ${playerNames[0]}.`
    : `The estimate moved from ${before}% to ${after}% for ${playerNames[0]}.`;
}

function forcedWinSentence(side: SideAnalysis, player: string, ownBar: number): string | null {
  const forced = side.forcedWin;
  if (!forced || !forcedWinSpeaks(forced, ownBar)) return null;
  // `turns` is the deepest proven line in own moves, so the win comes within it.
  const head = `${player} wins within ${forced.turns} turn${forced.turns === 1 ? '' : 's'} against every reply`;
  if (forced.open && forced.mass < 1) {
    const verb = forced.open.kind === 'hit' ? 'lands' : 'knocks out';
    return `${head} if the ${percentBelowSure(forced.open.odds)}% ${forced.open.label} ${verb}${caveatWords(forced.caveat)}${delayClause(forced)}.${choiceSentence(forced)}`;
  }
  return `${head}${forcedQualifier(forced)}${delayClause(forced)}.${choiceSentence(forced)}`;
}

// Announce-gated: the game report speaks each stage once, the per-turn card on every turn.
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
    // A click that cannot fail is no roll; 99.5% can fail.
    sentences.push(`${nearDecided.species} is one ${rollText(nearDecided.odds)} ` +
      `from clearing the rest; removing ${nearDecided.removes} leaves no answer behind.`);
  }
  return sentences;
}

function decisionSentences(analysis: TurnAnalysis, playerNames: PlayerNames): string[] {
  const sentences: string[] = [];
  const p1Clause = sideClause(playerNames[0], analysis.p1, analysis.p2, !lostGround(analysis, 'p1'), playerNames[1]);
  const p2Clause = sideClause(playerNames[1], analysis.p2, analysis.p1, !lostGround(analysis, 'p2'), playerNames[0]);
  if (p1Clause) sentences.push(p1Clause);
  if (p2Clause) sentences.push(p2Clause);
  if (analysis.chanceDelta !== null && Math.abs(analysis.chanceDelta) >= CHANCE_THRESHOLD) {
    sentences.push(chanceRolled(analysis) === false
      ? `On top of that, the estimate moved ${winDeltaText(analysis.chanceDelta)} with no roll behind it.`
      : `On top of that, luck contributed ${winDeltaText(analysis.chanceDelta)}.`);
  }
  return sentences;
}

// On a decided board a chance swing toward the decided side is the game resolving, not luck; against it, genuine luck.
// A swing without a roll in its direction is an estimate that moved with no roll behind it.
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
  const walked = walkedSentence(analysis, playerNames);
  return walked ? [sentence, walked] : [sentence];
}

function walkedSentence(analysis: TurnAnalysis, playerNames: PlayerNames): string | null {
  return hindsightSentence(analysis, playerNames, side => walkedInto(analysis[side], analysis[side === 'p1' ? 'p2' : 'p1']));
}

// The side whose missed read cost more; a read on a thin cell (a guess) is not quoted.
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
  // A doubles pair of clicks reads per slot; "the <pair> actually clicked" would not parse.
  const clicked = phraseReplies(missed.read.against);
  const lead = missed.read.likeliest !== undefined
    ? `${clicked} was the likeliest click on the opponent model ` +
      `(${Math.round(missed.read.likeliest * 100)}%), and against it`
    : splitCombinedLabel(missed.read.against).length > 1 ? `against what was actually clicked (${clicked}),` : `against the ${clicked} actually clicked,`;
  return `The read was there for ${missed.name}: ${lead} ${phrase(missed.read.response)} ` +
    `was worth ${winDeltaText(missed.read.gain)} more.`;
}

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

function shiftSentences(analysis: TurnAnalysis, playerNames: PlayerNames): string[] {
  const sentences: string[] = [];
  const unrolled = chanceRolled(analysis) === false;
  const decomposition = analysis.decisionDelta !== null && analysis.chanceDelta !== null
    ? ` (${winDeltaText(analysis.decisionDelta)} expected, ${winDeltaText(analysis.chanceDelta)} ` +
      `${unrolled ? 'with no roll behind it' : 'from the rolls'})`
    : '';
  const open = (analysis.p1.viableCount ?? 0) >= BREADTH_MIN_OPTIONS &&
    (analysis.p2.viableCount ?? 0) >= BREADTH_MIN_OPTIONS;
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

function attributionSentences(analysis: TurnAnalysis, playerNames: PlayerNames, decided: Decided, othersSpeak: boolean, judged: readonly NamedJudgement[]): string[] {
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
      return quietSentences(analysis, walkedSentence(analysis, playerNames), othersSpeak, playerNames, judged);
  }
}

function cardSpeakers(analysis: TurnAnalysis, playerNames: PlayerNames, decided: Decided) {
  const beside = [...decidedSentences(analysis, playerNames, decided), predictiveSentence(analysis, playerNames) ?? []].flat();
  const { sentences: rideAlong, judged } = rideAlongOf(analysis, playerNames);
  const standing = beside.length > 0 || hintShown(analysis);
  return { beside, rideAlong, judged, standing, othersSpeak: standing || rideAlong.length > 0 };
}

/** How the turn's quiet card speaks: "A quiet turn." alone, "Neither side made a mistake." beside others, or silent. */
export function quietVoice(analysis: TurnAnalysis, playerNames: PlayerNames): QuietVoice {
  const { standing, othersSpeak, judged } = cardSpeakers(analysis, playerNames, decidedSide(analysis));
  if (analysis.playedTracking === false) return standing ? 'silent' : 'alone';
  return quietVoiceOf(analysis, othersSpeak || walkedSentence(analysis, playerNames) !== null, judged);
}

/** The turn's card text: the estimate line, then decided, attribution, and ride-along sentences. */
export function summarizeTurn(
  analysis: TurnAnalysis,
  playerNames: [string, string],
): string {
  const decided = decidedSide(analysis);
  const { beside, rideAlong, judged, standing, othersSpeak } = cardSpeakers(analysis, playerNames, decided);
  const sentences: string[] = [estimateSentence(analysis, playerNames), ...beside];

  if (analysis.playedTracking === false) {
    // Played actions were never parsed (doubles): no blame, so the card cannot say that no one made a mistake.
    if (analysis.attribution === 'shift') sentences.push("The advantage moved; compare the engine's preferred lines for both sides below.");
    else if (!standing) sentences.push(QUIET_TURN);
    return sentences.join(' ');
  }

  sentences.push(...attributionSentences(analysis, playerNames, decided, othersSpeak, judged), ...rideAlong);
  return sentences.join(' ');
}
