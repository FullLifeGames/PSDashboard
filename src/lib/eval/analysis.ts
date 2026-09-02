import type { EvalMatrix, RankedChoice } from './types';
import { nullMoveReason } from './null-moves';
import { detectStreakOdds } from './streaks';
import { TIE_EPSILON } from './rank';
import {
  CHANCE_THRESHOLD, CONDITIONAL_MIX_MIN, DECIDED_SCORE, FEED_FLOOR_EPSILON, FORCED_MIX_THRESHOLD, HEALTHY_SACK_FLOOR,
  PAYOFF_WINDOW, REGRET_THRESHOLD, RISK_PAYOFF_EPSILON, RISK_PAYOFF_MARGIN, TIER_THRESHOLDS, decidedSeenKey,
  unansweredSeenKey, type AnalyzeTurnParams, type SideAnalysis, type TurnAnalysis, type TurnAttribution, type VerdictTier,
} from './turn-analysis/types';
import { matchPlayedChoice, matchPlayedSlots, phantomStayIn } from './turn-analysis/played-match';

/**
 * Turns a sweep's cached per-turn data into a chess-style turn explanation:
 * what was played vs what the engine preferred (regret per side), and how
 * the score swing splits into a decision part and a chance part. Pure — no
 * @pkmn/sim imports, main-bundle safe.
 */

export {
  BREADTH_MIN_OPTIONS, CHANCE_THRESHOLD, CONDITIONAL_MIX_MIN, DECIDED_SCORE, FEED_FLOOR_EPSILON, FORCED_MIX_THRESHOLD,
  HEALTHY_SACK_FLOOR, PAYOFF_WINDOW, REGRET_THRESHOLD, RISK_PAYOFF_EPSILON, RISK_PAYOFF_MARGIN, TIER_THRESHOLDS,
  decidedSeenKey, unansweredSeenKey,
} from './turn-analysis/types';
export type {
  AnalyzeTurnParams, SensitivityProbe, SideAnalysis, TurnAnalysis, TurnAttribution, TurnSensitivity, TurnVerification,
  VerdictTier, VerifiedOutcomes,
} from './turn-analysis/types';
export {
  diffChoices, findConsistentOptions, findPlayedOption, matchPlayedChoice, matchPlayedSide, matchPlayedSlots,
  phantomStayIn, playedSetupMove, splitCombinedLabel,
} from './turn-analysis/played-match';

export function analyzeTurn(params: AnalyzeTurnParams): TurnAnalysis {
  const playedTracking = params.playedTracking !== false;
  const sideAnalysis = (key: 'p1' | 'p2'): SideAnalysis => {
    const playedRaw = params.played?.[key] ?? null;
    const playedSlots = key === 'p1' ? params.played?.p1Slots : params.played?.p2Slots;
    let played: RankedChoice | null = null;
    let playedPartial = false;
    let neverActed = false;
    if (playedSlots) {
      const match = matchPlayedSlots(params.result.perSide[key], playedSlots);
      played = match.played;
      playedPartial = match.partial;
    } else if (params.played) {
      played = matchPlayedChoice(params.result, key, playedRaw);
      if (!played) {
        const phantom = phantomStayIn(params.result, key, params.played);
        if (phantom) {
          played = phantom;
          neverActed = true;
        }
      }
    }
    const options = params.result.perSide[key];
    const best = options[0] ?? null;
    const safe = options.length > 0
      ? options.reduce((a, b) => (b.worstCase > a.worstCase ? b : a))
      : null;
    let regret = played && best ? Math.max(0, best.ev - played.ev) : null;
    // Verification can only ACQUIT: a deep pass that confirms the gap keeps
    // the shallow equilibrium regret (the deep pair values are an
    // exploitative lens, not a fairer grade when they agree).
    let verifiedAtDepth = false;
    const verifiedSide = params.verified?.[key];
    if (verifiedSide && regret !== null && regret >= REGRET_THRESHOLD) {
      const sign = key === 'p1' ? 1 : -1;
      const deepRegret = Math.max(0, sign * (verifiedSide.bestDeep - verifiedSide.playedDeep));
      if (deepRegret < REGRET_THRESHOLD) {
        regret = deepRegret;
        verifiedAtDepth = true;
      }
    }
    const demoteTier = (current: VerdictTier | undefined): VerdictTier | undefined =>
      current === 'blunder' ? 'mistake' : current === 'mistake' ? 'inaccuracy' : undefined;
    const tierOf = (regretValue: number): VerdictTier | undefined =>
      regretValue >= TIER_THRESHOLDS.blunder ? 'blunder'
        : regretValue >= TIER_THRESHOLDS.mistake ? 'mistake'
          : regretValue >= TIER_THRESHOLDS.inaccuracy ? 'inaccuracy' : undefined;
    let tier: VerdictTier | undefined;
    if (regret !== null) {
      tier = tierOf(regret);
      const own = key === 'p1' ? params.scoreBefore : -params.scoreBefore;
      if (tier && Math.abs(own) >= DECIDED_SCORE) tier = demoteTier(tier);
    }
    // A sack of a nearly-dead body is a deliberate low-cost play: demote one
    // band (same shape as the decided-position leniency) and mark it so the
    // risk machinery and the report treat it neutrally. BOUNDED: a
    // blunder-sized regret is a throw whatever the body was worth — the
    // sack leniency never forgives the blunder band.
    // A HEALTHY feed (switched in and fainted, above the low-HP threshold)
    // is only a simplification sack while the engine's own scores call the
    // game decisively won for the sacker BEFORE and AFTER — trading surplus
    // material for certainty (GPL T35 Salazzle). Expectation-based, not
    // results-based: both gates read engine scores. No after-score = no
    // excuse (fails closed on game ends and gap turns).
    const sack = params.sacks?.[key];
    const ownBefore = key === 'p1' ? params.scoreBefore : -params.scoreBefore;
    const ownAfter = params.scoreAfter === null ? null : (key === 'p1' ? params.scoreAfter : -params.scoreAfter);
    // Shape gates: low-HP applies unconditionally; healthy only while
    // decisively ahead on both sides of the sack; a stayed feed only when
    // the realized outcome landed on the played line's priced floor (the
    // player accepted the known worst case and got it — the turn's own
    // rolls contributed nothing positive) AND the windowed payoff over the
    // safe guarantee clears the read margin (573756 t68). Fails closed.
    let sackApplies = false;
    let feedPayoff: number | null = null;
    if (sack) {
      if (sack.stayed) {
        const ownOutcome = params.playedOutcome === null ? null
          : key === 'p1' ? params.playedOutcome : -params.playedOutcome;
        const atFloor = played !== null && ownOutcome !== null &&
          ownOutcome - played.worstCase <= FEED_FLOOR_EPSILON;
        if (atFloor && safe && params.playedOutcome !== null) {
          const chain = [params.playedOutcome, ...(params.futureOutcomes ?? [])]
            .slice(0, PAYOFF_WINDOW + 1);
          let payoff: number | null = null;
          for (const outcome of chain) {
            if (outcome === null || outcome === undefined) continue;
            const own = key === 'p1' ? outcome : -outcome;
            const value = own - safe.worstCase;
            if (payoff === null || value > payoff) payoff = value;
          }
          sackApplies = payoff !== null && payoff >= RISK_PAYOFF_MARGIN;
          if (sackApplies) feedPayoff = payoff;
        }
      } else if (sack.healthy) {
        sackApplies = ownBefore >= HEALTHY_SACK_FLOOR &&
          ownAfter !== null && ownAfter >= HEALTHY_SACK_FLOOR;
      } else {
        sackApplies = true;
      }
    }
    const sacrificed = !!(tier && sackApplies && (regret ?? 0) < TIER_THRESHOLDS.blunder);
    // A stayed feed VERIFIES when its windowed payoff repaid the FULL regret
    // with the read margin on top: the line reached what the engine's best
    // promised, measured from the accepted floor upward — the win-condition
    // payoff is real, and no verdict band sticks (573756 t68 post-race:
    // payoff 0.359 ≥ regret 0.129 + 0.1). The blunder bound above still
    // applies: a blunder-sized feed is never excused, verified or not.
    const feedVerified = sacrificed && feedPayoff !== null && regret !== null &&
      feedPayoff >= regret + RISK_PAYOFF_MARGIN;
    if (sacrificed) tier = feedVerified ? undefined : demoteTier(tier);
    // Item-sensitivity: if the verdict changes band under a usage-plausible
    // alternative item for an opposing mon whose item is only a guess, the
    // verdict HINGES on hidden information — soften to the most charitable
    // probed band (acquit-only) and record the hinge.
    let sensitivity: SideAnalysis['sensitivity'];
    const probes = params.sensitivity?.[key];
    if (tier && probes && probes.length > 0) {
      const rank: Record<VerdictTier | 'none', number> = { none: 0, inaccuracy: 1, mistake: 2, blunder: 3 };
      const probed = probes.map(probe => ({
        probe,
        tier: tierOf(Math.max(0, probe.bestEv - probe.playedEv)) ?? 'none' as const,
      }));
      const charitable = probed.reduce((a, b) => (rank[b.tier] < rank[a.tier] ? b : a));
      if (rank[charitable.tier] < rank[tier]) {
        sensitivity = {
          species: charitable.probe.species,
          alternatives: probed
            .filter(entry => entry.probe.species === charitable.probe.species)
            .map(entry => ({ item: entry.probe.item, tier: entry.tier })),
        };
        tier = charitable.tier === 'none' ? undefined : charitable.tier;
      }
    }
    // ---- Narrative signals (round 5 ⑥): computed here where the full
    // result is in scope, rendered in summary.ts/report.ts. All of them
    // fail closed on missing data and never touch the grading above. ----
    const viableCount = best === null ? undefined :
      options.filter(option => best.ev - option.ev <= TIER_THRESHOLDS.inaccuracy).length;

    const matrix = params.result.matrix;
    const sideChoices = key === 'p1' ? matrix?.p1Choices : matrix?.p2Choices;
    const sideLabels = key === 'p1' ? matrix?.p1Labels : matrix?.p2Labels;
    const oppLabels = key === 'p1' ? matrix?.p2Labels : matrix?.p1Labels;
    const mix = key === 'p1' ? matrix?.mixes.p1 : matrix?.mixes.p2;
    // Own-perspective matrix value of (own index i, opponent index j).
    const ownValue = (grid: EvalMatrix, i: number, j: number): number =>
      key === 'p1' ? grid.values[i][j] : -grid.values[j][i];
    const mixTop = mix && mix.length > 0
      ? mix.reduce((top, weight, index) => (weight > mix[top] ? index : top), 0)
      : -1;

    let conditional: SideAnalysis['conditional'];
    if (tier && matrix && sideChoices && sideLabels && oppLabels && mix && best && mixTop >= 0) {
      const bestIndex = sideChoices.indexOf(best.choice);
      if (bestIndex >= 0 && mixTop !== bestIndex && mix[mixTop] >= CONDITIONAL_MIX_MIN) {
        let bestWhen: string | null = null;
        let mixWhen: string | null = null;
        let bestDiff = 0;
        let mixDiff = 0;
        for (let j = 0; j < oppLabels.length; j++) {
          const diff = ownValue(matrix, bestIndex, j) - ownValue(matrix, mixTop, j);
          if (diff > bestDiff) { bestDiff = diff; bestWhen = oppLabels[j]; }
          if (diff < mixDiff) { mixDiff = diff; mixWhen = oppLabels[j]; }
        }
        conditional = { mixLabel: sideLabels[mixTop], mixWeight: mix[mixTop], bestWhen, mixWhen };
      }
    }

    let forcedMix: SideAnalysis['forcedMix'];
    if (matrix && sideChoices && sideLabels && mix && options.length > 1 && mixTop >= 0 &&
      mix[mixTop] >= FORCED_MIX_THRESHOLD && sideChoices[mixTop]?.startsWith('switch')) {
      forcedMix = { label: sideLabels[mixTop], weight: mix[mixTop] };
    }

    // Round 13: the read that was on the table. Against the opponent's ACTUAL
    // click (a known column, unlike the equilibrium the conditional reasons
    // over) the matrix knows the best own row; when it beats the played line
    // in that column by a mistake-sized gain, the shift narrative names the
    // concrete counterfactual (562428 t10: → Heatran into the Horn Leech).
    let hindsightRead: SideAnalysis['hindsightRead'];
    if (matrix && sideChoices && sideLabels && played) {
      const oppKey = key === 'p1' ? 'p2' as const : 'p1' as const;
      const oppChoices = key === 'p1' ? matrix.p2Choices : matrix.p1Choices;
      const oppPlayed = matchPlayedChoice(params.result, oppKey, params.played?.[oppKey] ?? null);
      const column = oppPlayed && oppChoices ? oppChoices.indexOf(oppPlayed.choice) : -1;
      const row = sideChoices.indexOf(played.choice);
      if (column >= 0 && row >= 0) {
        let bestRow = -1;
        let bestValue = -Infinity;
        for (let i = 0; i < sideChoices.length; i++) {
          const value = ownValue(matrix, i, column);
          if (value > bestValue) { bestValue = value; bestRow = i; }
        }
        const gain = bestValue - ownValue(matrix, row, column);
        if (bestRow >= 0 && bestRow !== row && gain >= TIER_THRESHOLDS.mistake) {
          hindsightRead = { response: sideLabels[bestRow], against: oppPlayed!.label, gain };
        }
      }
    }

    // Round 13: entry-is-profit — the played or recommended line brings in
    // a mon from the root's unanswered profile (no live enemy wins the race
    // pair against it), so a clean entry is value on its own (648453 t13).
    // Round 14: the switch-in stage rides the same match — bench exhausted,
    // a standing active still holding — and carries the holder's species.
    let unanswered: SideAnalysis['unanswered'];
    const ownUnanswered = params.result.unanswered?.[key];
    const ownEntry = key === 'p1' ? params.result.unanswered?.p1Entry : params.result.unanswered?.p2Entry;
    if ((ownUnanswered && ownUnanswered.length > 0) || (ownEntry && ownEntry.length > 0)) {
      const entryTarget = (label: string | undefined): string | null =>
        label?.match(/→ (.+)$/)?.[1] ?? null;
      for (const target of [played?.label, best?.label].map(entryTarget)) {
        if (target === null) continue;
        const signal = ownUnanswered?.includes(target)
          ? { species: target }
          : ownEntry?.find(row => row.species === target);
        if (!signal) continue;
        if (params.unansweredSeen?.has(unansweredSeenKey(key, signal))) continue;
        unanswered = signal;
        break;
      }
    }

    // Round 15: the decided sweep / the near-decided roll — board states,
    // not click context: they attach to the owning side on every turn they
    // hold (display layers book resolution prose from the state) and
    // announce only until the game report has spoken them once.
    let decided: SideAnalysis['decided'];
    const ownDecided = params.result.unanswered?.decided;
    if (ownDecided && ownDecided.side === key) {
      decided = {
        species: ownDecided.species,
        announce: !params.decidedSeen?.has(decidedSeenKey(key, { species: ownDecided.species })),
      };
    }
    let nearDecided: SideAnalysis['nearDecided'];
    const ownNear = params.result.unanswered?.nearDecided;
    if (ownNear && ownNear.side === key) {
      nearDecided = {
        species: ownNear.species, odds: ownNear.odds, removes: ownNear.removes,
        announce: !params.decidedSeen?.has(
          decidedSeenKey(key, { species: ownNear.species, removes: ownNear.removes })),
      };
    }

    let bestNull: SideAnalysis['bestNull'];
    const actives = params.actives;
    const defenderSpecies = actives ? (key === 'p1' ? actives.p2 : actives.p1) : null;
    if (best && actives && defenderSpecies) {
      const attackerSpecies = key === 'p1' ? actives.p1 : actives.p2;
      const nullFor = (choice: string) => nullMoveReason({
        choice, gen: actives.gen, attackerSpecies, defenderSpecies,
      });
      const reason = nullFor(best.choice);
      if (reason) {
        // The swap stays within the established rank-tie scale: a co-optimal
        // option is a fair display substitute, never a regrade.
        const alternative = options.find(option => option !== best &&
          best.ev - option.ev <= TIE_EPSILON && nullFor(option.choice) === null) ?? null;
        bestNull = {
          reason,
          alternative: alternative
            ? { label: alternative.label, ev: alternative.ev, ...(alternative.koOdds ? { koOdds: alternative.koOdds } : {}) }
            : null,
        };
      }
    }

    // Round 6 ②: multi-turn cumulation — a streak ending THIS turn, read
    // from the render-time history (index t−1 = turn t, current included).
    let streakOdds: SideAnalysis['streakOdds'];
    if (params.playedHistory && actives) {
      streakOdds = detectStreakOdds(actives.gen, params.playedHistory[key].slice(0, params.turn)) ?? undefined;
    }

    return {
      playedRaw,
      ...(params.played?.prevented?.[key] ? { prevented: params.played.prevented[key] } : {}),
      ...(playedSlots ? { playedSlots } : {}),
      ...(neverActed ? { neverActed } : {}),
      played,
      best,
      safe,
      regret,
      choiceCount: options.length,
      ...(playedPartial ? { playedPartial } : {}),
      ...(verifiedAtDepth ? { verifiedAtDepth } : {}),
      ...(tier ? { tier } : {}),
      ...(sacrificed && sack ? { sacrifice: feedVerified ? { ...sack, verified: true } : sack } : {}),
      ...(sensitivity ? { sensitivity } : {}),
      ...(viableCount !== undefined ? { viableCount } : {}),
      ...(conditional ? { conditional } : {}),
      ...(bestNull ? { bestNull } : {}),
      ...(forcedMix ? { forcedMix } : {}),
      ...(streakOdds ? { streakOdds } : {}),
      ...(hindsightRead ? { hindsightRead } : {}),
      ...(unanswered ? { unanswered } : {}),
      ...(decided ? { decided } : {}),
      ...(nearDecided ? { nearDecided } : {}),
    };
  };

  const p1 = sideAnalysis('p1');
  const p2 = sideAnalysis('p2');
  // A flagged risk whose punishing reply was never clicked reads differently
  // from a punished misplay. Where the pair's expected value is known, the
  // payoff over the safe guarantee grades the read: clearly ahead = a good
  // play, clearly behind = a plain misplay even unpunished, between = risk.
  // UNTIERED turns enter too, but only as genuine gambles — the play deviated
  // from the engine's pick AND gave up a mistake-sized floor vs the safe line
  // (draft T50: a co-optimal switch whose floor priced in Earth Power). They
  // can only EARN the paid-off credit; with no verdict to soften, the risk
  // labels stay off. Two honesty bounds (GPL T35): no praise from an
  // already-lost position (garbage time makes every move a "gamble" outcome
  // noise can credit), and the credit grades on the IMMEDIATE outcome only —
  // the payoff window softens flagged risks; here it would attribute the
  // opponent's follow-up choices and the rolls to the gamble.
  const markRisk = (key: 'p1' | 'p2', side: SideAnalysis, opponent: SideAnalysis) => {
    // A phantom stay-in has no real floor to price a read against.
    if (side.sacrifice || side.neverActed) return;
    const tiered = side.tier === 'mistake' || side.tier === 'blunder';
    const ownBefore = key === 'p1' ? params.scoreBefore : -params.scoreBefore;
    const gamble = !tiered && side.played !== null && side.best !== null && side.safe !== null
      && side.played.choice !== side.best.choice
      && side.played.choice !== side.safe.choice
      && side.safe.worstCase - side.played.worstCase >= TIER_THRESHOLDS.mistake
      && ownBefore > -DECIDED_SCORE
      && params.playedOutcome !== null;
    if (!tiered && !gamble) return;
    if (!side.played?.punishedBy || !opponent.played) return;
    if (opponent.played.label === side.played.punishedBy) return;
    if (params.playedOutcome !== null && side.safe) {
      // The payoff is the BEST expected outcome within the window vs the safe
      // guarantee — a setup turn's value arrives on the turns after it.
      const chain = tiered
        ? [params.playedOutcome, ...(params.futureOutcomes ?? [])].slice(0, PAYOFF_WINDOW + 1)
        : [params.playedOutcome];
      let payoff: number | null = null;
      let payoffTurn = 0;
      chain.forEach((outcome, index) => {
        if (outcome === null || outcome === undefined) return;
        const own = key === 'p1' ? outcome : -outcome;
        const value = own - side.safe!.worstCase;
        if (payoff === null || value > payoff) {
          payoff = value;
          payoffTurn = index;
        }
      });
      if (payoff !== null) {
        side.riskPayoff = payoff;
        if (payoffTurn > 0) side.riskPayoffTurn = payoffTurn;
        if (payoff <= -RISK_PAYOFF_MARGIN) return;
        if (payoff >= RISK_PAYOFF_MARGIN - RISK_PAYOFF_EPSILON) side.riskPaidOff = true;
      }
    }
    // Gambles stop here: paid-off credit or nothing.
    if (!tiered) return;
    side.riskUnpunished = true;
    // The opponent model agrees: this "risk" was the exploitative best
    // response to how the opponent actually plays — phrase it as a read.
    const read = params.reads?.[key];
    // The machine id is authoritative; the label match only serves cached
    // reads written before choice ids existed.
    if (read && side.played && (read.choice.choiceId !== undefined
      ? read.choice.choiceId === side.played.choice
      : read.choice.label === side.played.label)) {
      side.riskWasRead = true;
    }
  };
  markRisk('p1', p1, p2);
  markRisk('p2', p2, p1);
  const swing = params.scoreAfter !== null ? params.scoreAfter - params.scoreBefore : null;
  const decisionDelta = params.playedOutcome !== null ? params.playedOutcome - params.scoreBefore : null;
  const chanceDelta = params.playedOutcome !== null && params.scoreAfter !== null
    ? params.scoreAfter - params.playedOutcome
    : null;

  // A paid-off read does not count as a decision problem; neither does an
  // inaccuracy or a leniency-softened verdict.
  const badTier = (side: SideAnalysis) => side.tier === 'mistake' || side.tier === 'blunder';
  const p1Bad = badTier(p1) && !p1.riskPaidOff;
  const p2Bad = badTier(p2) && !p2.riskPaidOff;
  let attribution: TurnAttribution;
  if (!playedTracking) {
    // Without played actions only the movement itself can be described.
    attribution = swing !== null && Math.abs(swing) >= CHANCE_THRESHOLD ? 'shift' : 'quiet';
  } else if (p1Bad && p2Bad) attribution = 'both-decision';
  else if (p1Bad) attribution = 'p1-decision';
  else if (p2Bad) attribution = 'p2-decision';
  else if (p1.riskPaidOff && p2.riskPaidOff) attribution = 'both-read';
  else if (p1.riskPaidOff) attribution = 'p1-read';
  else if (p2.riskPaidOff) attribution = 'p2-read';
  else if (chanceDelta !== null && Math.abs(chanceDelta) >= CHANCE_THRESHOLD) attribution = 'chance';
  else if (swing !== null && Math.abs(swing) >= CHANCE_THRESHOLD) {
    // The score clearly moved but nothing crossed a blame threshold: either
    // a side's choice never surfaced (unclear), or pressure and rolls just
    // added up (shift) — never "quiet".
    attribution = p1.played === null || p2.played === null ? 'unclear' : 'shift';
  } else attribution = 'quiet';

  return {
    turn: params.turn,
    scoreBefore: params.scoreBefore,
    scoreAfter: params.scoreAfter,
    swing,
    playedOutcome: params.playedOutcome,
    decisionDelta,
    chanceDelta,
    attribution,
    p1,
    p2,
    playedTracking,
  };
}
