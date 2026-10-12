import { describe, expect, test } from 'vitest';
import type { SideAnalysis, TurnAnalysis } from '../src/analysis';
import { sideClause } from '../src/prose/clauses';
import { conditionalNote, phrase, phraseReplies } from '../src/prose/phrases';
import { summarizeTurn } from '../src/summary';
import type { RankedChoice } from '../src/types';

/**
 * Round 69 (T179, decision 21): an opponent reply that is a doubles pair reads in the gerund per slot, like every other
 * label (round 67, T135), in the floor clause, the conditional note and the turn card's hindsight and predictive
 * sentences. 2695803506 t6 said "The floor priced in Weather Ball→Incineroar + → Basculegion"; 2629703929 t4 and t6
 * carried the same raw " + →" in "expects" and "against the ... actually clicked". A singles reply keeps its string.
 */

/** The doubles pairs of the dumps (a move at a slot with a switch beside it) and their singles twins. */
const DOUBLES_REPLY = 'Weather Ball→Incineroar + → Basculegion';
const DOUBLES_REPLY_TWO = 'Fake Out→Incineroar + → Kingambit';
const SINGLES_SWITCH = '→ Heatran';
const SINGLES_MOVE = 'Earthquake';

const ranked = (choice: string, label: string, ev: number, extra: Partial<RankedChoice> = {}): RankedChoice =>
  ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: null, ...extra });

const names: [string, string] = ['Alpha', 'Beta'];

describe('T179 phraseReplies', () => {
  test('a doubles pair of replies reads like phrase(); no raw " + →" is left', () => {
    for (const label of [DOUBLES_REPLY, DOUBLES_REPLY_TWO]) {
      expect(phraseReplies(label)).toBe(phrase(label));
      expect(phraseReplies(label)).not.toContain(' + →');
    }
    expect(phraseReplies(DOUBLES_REPLY)).toBe('playing Weather Ball→Incineroar and switching to Basculegion');
  });

  test('a singles reply (a switch, a move, a pivot, a Tera pair) is returned unchanged', () => {
    for (const label of [SINGLES_SWITCH, SINGLES_MOVE, 'U-turn → Heatran', 'Tera + Earthquake', 'Protect + Tailwind']) {
      expect(phraseReplies(label)).toBe(label);
    }
    // phrase() alone would turn the singles switch into "switching to Heatran".
    expect(phrase(SINGLES_SWITCH)).not.toBe(SINGLES_SWITCH);
  });
});

describe('T179 the floor clause', () => {
  const readSide = (punishedBy: string): SideAnalysis => ({
    playedRaw: null, riskPaidOff: true, riskPayoff: 0.08,
    played: ranked('move weatherball 1, switch 3', 'Tailwind + Protect', 0.4, { punishedBy, worstCase: 0.1 }),
    best: ranked('move tailwind, move protect', 'Tailwind + Protect', 0.4),
    safe: ranked('move protect, move protect', 'Protect + Protect', 0.3, { worstCase: 0.3 }),
    regret: 0,
  });
  const opponent = (label: string): SideAnalysis => ({
    playedRaw: null, played: ranked('x', label, 0), best: null, safe: null, regret: 0,
  });

  test('doubles (2695803506 t6): the priced reply and the reply that came read per slot', () => {
    const clause = sideClause('Alpha', readSide(DOUBLES_REPLY), opponent(DOUBLES_REPLY_TWO))!;
    expect(clause).toContain(`The floor priced in ${phrase(DOUBLES_REPLY)}; ${phrase(DOUBLES_REPLY_TWO)} came instead.`);
    expect(clause).not.toContain(' + →');
  });

  test('singles: the same clause keeps its strings', () => {
    expect(sideClause('Alpha', readSide(SINGLES_MOVE), opponent(SINGLES_SWITCH))!)
      .toContain('The floor priced in Earthquake; switching to Heatran came instead.');
    expect(sideClause('Alpha', readSide(SINGLES_MOVE), opponent('Iron Head'))!)
      .toContain('The floor priced in Earthquake; Iron Head came instead.');
  });
});

describe('T179 the conditional note', () => {
  const sideWith = (bestWhen: string, mixWhen: string): SideAnalysis => ({
    playedRaw: null, played: null, safe: null, regret: 0,
    best: ranked('move tailwind, move protect', 'Tailwind + Protect', 0.4),
    conditional: { mixLabel: 'Protect + Tailwind', mixWeight: 0.6, bestWhen, mixWhen },
  });

  test('doubles: bestWhen and mixWhen read per slot', () => {
    const note = conditionalNote(sideWith(DOUBLES_REPLY, DOUBLES_REPLY_TWO));
    expect(note).toContain(`is the pick only if you expect ${phrase(DOUBLES_REPLY)}`);
    expect(note).toContain(`covers ${phrase(DOUBLES_REPLY_TWO)}`);
    expect(note).not.toContain(' + →');
  });

  test('singles: a switch reply keeps its raw form, as the pins have it', () => {
    const note = conditionalNote(sideWith(SINGLES_SWITCH, SINGLES_MOVE));
    expect(note).toContain('is the pick only if you expect → Heatran');
    expect(note).toContain('covers Earthquake');
  });
});

describe('T179 the card\'s hindsight and predictive sentences', () => {
  const quiet: SideAnalysis = { playedRaw: null, played: null, best: null, safe: null, regret: 0 };
  const card = (over: Partial<SideAnalysis>): TurnAnalysis => ({
    turn: 6, scoreBefore: 0, scoreAfter: 0.02, swing: 0.02, playedOutcome: 0, decisionDelta: 0, chanceDelta: 0.02,
    attribution: 'shift', p1: { ...quiet, ...over }, p2: quiet, playedTracking: true,
  });

  test('doubles (2629703929 t4 and t6 shapes): the clicked pair and the expected pair read per slot', () => {
    const hindsight = summarizeTurn(card({
      hindsightRead: { response: 'Protect + → Rillaboom', against: DOUBLES_REPLY, gain: 0.3 },
    }), names);
    expect(hindsight).toContain(`against what was actually clicked (${phrase(DOUBLES_REPLY)}), ${phrase('Protect + → Rillaboom')} was worth`);
    expect(hindsight).not.toContain(' + →');
    const likeliest = summarizeTurn(card({
      hindsightRead: { response: 'Protect', against: DOUBLES_REPLY, gain: 0.3, likeliest: 0.6 },
    }), names);
    expect(likeliest).toContain(`${phrase(DOUBLES_REPLY)} was the likeliest click on the opponent model (60%)`);
    const predictive = summarizeTurn(card({
      predictiveRead: { expect: DOUBLES_REPLY, confidence: 0.7, response: 'Protect', gain: 0.25, over: 'Tailwind + Protect' },
    }), names);
    expect(predictive).toContain(`If Alpha expects ${phrase(DOUBLES_REPLY)} (70% on the opponent model)`);
    expect(predictive).not.toContain(' + →');
  });

  test('singles: the same sentences keep their strings', () => {
    expect(summarizeTurn(card({ hindsightRead: { response: '→ Heatran', against: 'Iron Head', gain: 0.3 } }), names))
      .toContain('against the Iron Head actually clicked, switching to Heatran was worth');
    expect(summarizeTurn(card({ hindsightRead: { response: 'Recover', against: SINGLES_SWITCH, gain: 0.3, likeliest: 0.6 } }), names))
      .toContain('→ Heatran was the likeliest click on the opponent model (60%)');
    expect(summarizeTurn(card({
      predictiveRead: { expect: SINGLES_SWITCH, confidence: 0.7, response: 'Recover', gain: 0.25, over: 'Iron Head' },
    }), names)).toContain('If Alpha expects → Heatran (70% on the opponent model)');
  });
});
