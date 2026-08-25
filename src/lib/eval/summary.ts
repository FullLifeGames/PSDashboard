import { BREADTH_MIN_OPTIONS, CHANCE_THRESHOLD, diffChoices, playedSetupMove, type SideAnalysis, type TurnAnalysis } from './analysis';
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

/**
 * What the clause RECOMMENDS: the true best, unless it is mechanically null
 * against the opposing active and a co-optimal alternative exists — then the
 * alternative's label/EV display in its place (the grading upstream stays
 * priced against the true argmax; the swap lives within the rank-tie
 * epsilon). `swapped` tells callers to drop best-specific extras (the PV
 * line) that would misattach to the substitute.
 */
const displayBest = (side: SideAnalysis): { label: string; ev: number; swapped: boolean } =>
  side.bestNull?.alternative
    ? { ...side.bestNull.alternative, swapped: true }
    : { label: side.best!.label, ev: side.best!.ev, swapped: false };

/** The null recommendation kept its place (no alternative): name the caveat. */
const nullNote = (side: SideAnalysis): string =>
  side.bestNull && !side.bestNull.alternative && side.best
    ? ` (A caveat: ${side.best.label} does nothing here — ${side.bestNull.reason}; it only pays against the rest of the team.)`
    : '';

/**
 * The three analytic odds shapes (round 6 expectation grounding): "a 90%
 * roll into a ~43% kill range" / "kills ~43% of the time" / "an 80% roll
 * to connect". Exported for the report's seeds sentence.
 */
export function koPhrase(odds: { accuracy: number; killFraction: number }): string {
  const acc = Math.round(odds.accuracy * 100);
  const kill = Math.round(odds.killFraction * 100);
  const art = (n: number) => (n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89) ? 'an' : 'a');
  if (odds.accuracy < 1 && odds.killFraction < 1) return `${art(acc)} ${acc}% roll into a ~${kill}% kill range`;
  if (odds.killFraction < 1) return `kills ~${kill}% of the time`;
  return `${art(acc)} ${acc}% roll to connect`;
}

/**
 * One parenthetical naming the true odds behind the clause's claims — the
 * played move's and/or the recommendation's. The "kills ~43% of the time"
 * shape already reads as a verb phrase; the roll shapes take a copula.
 */
const oddsNote = (side: SideAnalysis): string => {
  const shown = displayBest(side);
  const shownOdds = side.bestNull?.alternative ? side.bestNull.alternative.koOdds : side.best?.koOdds;
  const parts: string[] = [];
  if (side.played?.koOdds && side.played.choice !== side.best?.choice) {
    const odds = side.played.koOdds;
    parts.push(`${phrase(side.played.label)} ${odds.killFraction < 1 && odds.accuracy === 1 ? koPhrase(odds) : `was ${koPhrase(odds)}`}`);
  }
  if (shownOdds) {
    parts.push(`${phrase(shown.label)} ${shownOdds.killFraction < 1 && shownOdds.accuracy === 1 ? koPhrase(shownOdds) : `is ${koPhrase(shownOdds)}`}`);
  }
  return parts.length > 0 ? ` (True odds: ${parts.join('; ')}.)` : '';
};

/**
 * The engine's own equilibrium leans a different choice than the rendered
 * recommendation: say so, and name the opponent replies that split them —
 * the recommendation becomes conditional instead of absolute (653785 t19).
 */
function conditionalNote(side: SideAnalysis): string {
  const conditional = side.conditional;
  if (!conditional || !side.best) return '';
  const segments = [
    conditional.bestWhen
      ? `${phrase(displayBest(side).label)} is the pick only if you expect ${conditional.bestWhen}`
      : null,
    conditional.mixWhen ? `${phrase(conditional.mixLabel)} covers ${conditional.mixWhen}` : null,
  ].filter((segment): segment is string => segment !== null);
  return ` The engine's own equilibrium leans ${phrase(conditional.mixLabel)} ` +
    `(${Math.round(conditional.mixWeight * 100)}%)${segments.length > 0 ? ` — ${segments.join('; ')}` : ''}.`;
}

/** A flagged risk that won value over the safe guarantee — praised, not blamed. */
function readClause(name: string, side: SideAnalysis, opponent: SideAnalysis): string | null {
  if (!side.riskPaidOff || !side.played || !side.safe) return null;
  const came = opponent.played ? `; ${phrase(opponent.played.label)} came instead` : '';
  const priced = side.played.punishedBy ? ` The floor priced in ${side.played.punishedBy}${came}.` : '';
  const horizon = side.riskPayoffTurn
    ? side.riskPayoffTurn === 1 ? ' one turn later' : ` ${side.riskPayoffTurn} turns later`
    : '';
  const click = side.played.koOdds ? ` The click was ${koPhrase(side.played.koOdds)}.` : '';
  return `${name} played ${phrase(side.played.label)} — a read that paid off${horizon}, ` +
    `${winDeltaText(side.riskPayoff ?? 0)} over the safe ${phrase(side.safe.label)} (${winPctText(side.safe.worstCase)} guaranteed).${priced}${click}`;
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
      `The engine's safe line was ${phrase(side.safe.label)} (${winPctText(side.safe.worstCase)} guaranteed)${lineOf(side.safe)}.${why}${caveat}${oddsNote(side)}`;
  }
  // The punished misplay reads in EV terms: what the choice was worth against
  // balanced play, vs what the engine's line was worth. A blunder earns the
  // word; a mistake keeps the softer framing. A null-swapped recommendation
  // drops the PV line and the why clause — both belong to the true best.
  const shown = displayBest(side);
  const line = shown.swapped ? '' : lineOf(side.best);
  const reasons = `${shown.swapped ? '' : why}${caveat}${nullNote(side)}${conditionalNote(side)}${oddsNote(side)}`;
  if (side.tier === 'blunder') {
    return `${name} played ${phrase(side.played.label)} (${winPctText(side.played.ev)}) — ` +
      `a blunder; clearly better was ${phrase(shown.label)} (${winPctText(shown.ev)})${line}.${reasons}`;
  }
  return `${name} played ${phrase(side.played.label)} (${winPctText(side.played.ev)}); ` +
    `safer was ${phrase(shown.label)} (${winPctText(shown.ev)})${line}.${reasons}`;
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
  const shown = displayBest(side);
  return `${name}'s ${phrase(side.played.label)} was an inaccuracy — ` +
    `${phrase(shown.label)} was slightly better (${winPctText(shown.ev)} vs ${winPctText(side.played.ev)}).` +
    `${oddsNote(side)}${nullNote(side)}${conditionalNote(side)}`;
}

/**
 * A near-pure equilibrium SWITCH is an expectation worth prose: the side is
 * effectively forced to give something up, and the reader should hear that
 * as a sentence, not read it off a matrix header percentage.
 */
function forcedClause(name: string, side: SideAnalysis): string | null {
  if (!side.forcedMix) return null;
  // The conditional already told this story — one equilibrium mention is enough.
  if (side.conditional?.mixLabel === side.forcedMix.label) return null;
  const base = `The equilibrium all but commits ${name} to ${phrase(side.forcedMix.label)} ` +
    `here (${Math.round(side.forcedMix.weight * 100)}%)`;
  if (!side.played) return `${base}.`;
  return side.played.label === side.forcedMix.label
    ? `${base} — which is what happened.`
    : `${base} — ${phrase(side.played.label)} came instead.`;
}

/**
 * A deliberate low-cost sack: neutral framing, no blame vocabulary — the
 * engine cannot see the intent (Trick absorption, momentum), only the cost.
 */
function sackClause(name: string, side: SideAnalysis): string | null {
  if (!side.sacrifice) return null;
  const pct = Math.round(side.sacrifice.hpFraction * 100);
  if (side.sacrifice.stayed) {
    if (side.sacrifice.verified) {
      return `${name} fed ${side.sacrifice.name} (${pct}% HP) — the line's priced floor is what happened, ` +
        `and the windowed payoff repaid the sack's full regret with a real edge on top; ` +
        `verified as a win-condition sacrifice, not graded as a misplay.`;
    }
    return `${name} fed ${side.sacrifice.name} (${pct}% HP) — the line's priced floor is what happened, ` +
      `and the line's payoff lands within the payoff window; graded as a sacrifice, not a misplay.`;
  }
  return side.sacrifice.healthy
    ? `${name} sacked a healthy ${side.sacrifice.name} (${pct}% HP) while decisively ahead — simplification, not graded as a misplay.`
    : `${name} sacked ${side.sacrifice.name} (${pct}% HP) — a low-cost trade, not graded as a misplay.`;
}

/** Multi-turn expectation: the narrative half of round 6 — never a grade. */
function streakClause(name: string, side: SideAnalysis): string | null {
  if (!side.streakOdds) return null;
  const streak = side.streakOdds;
  const n = streak.n;
  const nth = `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
  const pct = Math.round(streak.cumulative * 100);
  if (streak.event === 'crit') {
    return `${name}'s ${nth} straight attack into the boosted ${streak.defenderSpecies} — cumulative crit odds ` +
      `reach ~${pct}% across the streak, and a crit ignores those boosts.`;
  }
  return `${name}'s ${nth} ${streak.moveLabel} into ${streak.defenderSpecies} — ${streak.event} fishing compounds to ~${pct}% across the streak.`;
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

  // Round 15: the decided sweep speaks right after the estimate — the board
  // state that explains where the number is headed. Announce-gated: the
  // game report speaks each stage once, the per-turn card on every turn.
  const decided = analysis.p1.decided
    ? { key: 'p1' as const, ...analysis.p1.decided }
    : analysis.p2.decided
      ? { key: 'p2' as const, ...analysis.p2.decided }
      : null;
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
    case 'chance': {
      // Round 15: on a decided board a chance swing TOWARD the decided side
      // is the game resolving, not luck — the same booking the game report
      // has made since round 12, now visible on the turn itself. Chance
      // against the decided side stays genuine luck.
      const delta = analysis.chanceDelta ?? analysis.swing ?? 0;
      const toward = decided !== null && (decided.key === 'p1' ? delta > 0 : delta < 0);
      sentences.push(toward
        ? 'Both sides picked reasonable options — the swing is the decided game resolving ' +
          `toward ${decided.key === 'p1' ? playerNames[0] : playerNames[1]} (${winDeltaText(delta)}).`
        : 'Both sides picked reasonable options — the swing came from how the turn rolled ' +
          `(${winDeltaText(delta)}).`);
      break;
    }
    case 'shift': {
      const decomposition = analysis.decisionDelta !== null && analysis.chanceDelta !== null
        ? ` (${winDeltaText(analysis.decisionDelta)} expected, ${winDeltaText(analysis.chanceDelta)} from the rolls)`
        : '';
      // A wide board on both sides is not a drift — the matrix knew the
      // breadth (562428 t10), so the prose names it: the turn was a
      // prediction contest, and the swing is how the picks collided.
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
      // Round 13: the concrete counterfactual the matrix knows — the best
      // answer to the opponent's ACTUAL click. One sentence, the side whose
      // missed read cost more (562428 t10: → Heatran into the Horn Leech).
      const reads = [
        { name: playerNames[0], read: analysis.p1.hindsightRead },
        { name: playerNames[1], read: analysis.p2.hindsightRead },
      ].filter((entry): entry is { name: string; read: NonNullable<SideAnalysis['hindsightRead']> } =>
        entry.read !== undefined);
      const missed = reads.sort((a, b) => b.read.gain - a.read.gain)[0];
      if (missed) {
        sentences.push(`The read was there for ${missed.name} — against the ` +
          `${missed.read.against} actually clicked, ${labelPhrase(missed.read.response)} ` +
          `was worth ${winDeltaText(missed.read.gain)} more.`);
      }
      break;
    }
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

  // Forced equilibrium expectations ride along on any attribution — a
  // near-forced sack is turn context, not a verdict.
  const p1Forced = forcedClause(playerNames[0], analysis.p1);
  const p2Forced = forcedClause(playerNames[1], analysis.p2);
  if (p1Forced) sentences.push(p1Forced);
  if (p2Forced) sentences.push(p2Forced);

  // Entry-is-profit context rides along the same way (round 13): bringing
  // in a mon the opponent has no live race answer to is board logic worth
  // naming, not a verdict (648453 t13: the Lopunny switch). The round-14
  // switch-in stage names the one standing mon still holding the pair —
  // the expert's literal "no remaining switch-ins" state.
  const unansweredClause = (side: SideAnalysis): string | null => {
    if (!side.unanswered) return null;
    if (side.unanswered.heldBy) {
      return `${side.unanswered.species} has no switch-in left on the other side — only the standing ` +
        `${side.unanswered.heldBy} holds it, and from the bench the opponent can only sacrifice into it.`;
    }
    return `${side.unanswered.species} has no live answer on the other side — any turn that ` +
      'brings it in cleanly turns profit, and the opponent can only sacrifice into it.';
  };
  const p1Unanswered = unansweredClause(analysis.p1);
  const p2Unanswered = unansweredClause(analysis.p2);
  if (p1Unanswered) sentences.push(p1Unanswered);
  if (p2Unanswered) sentences.push(p2Unanswered);

  // Streak cumulation rides along the same way: multi-turn expectation is
  // narrative context, never a verdict.
  const p1Streak = streakClause(playerNames[0], analysis.p1);
  const p2Streak = streakClause(playerNames[1], analysis.p2);
  if (p1Streak) sentences.push(p1Streak);
  if (p2Streak) sentences.push(p2Streak);

  // Sensitivity hinges also ride along: the softened tier may have silenced
  // the decision clause entirely, but the hinge itself is the finding.
  const p1Hinge = sensitivityClause(playerNames[0], analysis.p1);
  const p2Hinge = sensitivityClause(playerNames[1], analysis.p2);
  if (p1Hinge) sentences.push(p1Hinge);
  if (p2Hinge) sentences.push(p2Hinge);

  return sentences.join(' ');
}
