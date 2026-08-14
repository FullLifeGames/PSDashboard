import { test, expect } from '@playwright/test';
import type { TurnAnalysis, TurnAttribution, VerdictTier } from '../src/lib/eval/analysis';
import type { GameReport } from '../src/lib/eval/report';
import { FEEDBACK_CORPUS, FEEDBACK_REPLAYS, type FeedbackItem, type ReportClaim } from '../e2e-feedback/corpus';
import { evaluateItem, validateCorpus } from '../e2e-feedback/claims';
import { renderReport } from '../e2e-feedback/report';

/**
 * The claim evaluator is the drift harness's comparison brain — pinned here
 * with synthetic analyses so the browser run stays on-demand while the
 * logic is gated. Statuses: truth → ok | drift | pending (unpinned);
 * gap → gap-open (engine still says what baseline observed) | gap-moved |
 * pending (no baseline yet). WARN-ONLY by design: statuses are report
 * content, the evaluator itself never throws.
 */

const side = (over: Record<string, unknown> = {}) => ({
  playedRaw: null, played: { choice: 'move x', label: 'Close Combat', ev: 0.5, worstCase: 0.1 },
  best: { choice: 'move x', label: 'Close Combat', ev: 0.5, worstCase: 0.1 },
  safe: null, regret: 0, choiceCount: 4, ...over,
});
const analysis = (turn: number, attribution: TurnAttribution, over: Record<string, unknown> = {}): TurnAnalysis => ({
  turn, scoreBefore: 0, scoreAfter: 0.2, swing: 0.2, playedOutcome: 0.2,
  decisionDelta: 0.2, chanceDelta: 0, attribution, p1: side(), p2: side(), ...over,
} as unknown as TurnAnalysis);
const report = (over: Partial<GameReport> = {}): GameReport => ({
  winner: 'p1', turningPoint: 5, keyMoments: [analysis(12, 'p1-read')],
  misplays: [{ turn: 3, side: 'p2', regret: 0.3, played: 'Tackle', better: 'Protect' }],
  reads: [{ turn: 12, side: 'p1', played: 'Close Combat', payoff: 0.2 }],
  tracked: true, accuracy: { p1: 90, p2: 80 }, decisionTotals: { p1: 0.1, p2: 0.4 },
  chanceTotal: 0, summary: '', ...over,
});
const truthAt = (turn: number, expectClaim?: FeedbackItem['expect']): FeedbackItem => ({
  replay: 'smogtours-gen8ou-562428', turn, kind: 'truth', source: 'expert-2026-08', essence: 'x',
  ...(expectClaim ? { expect: expectClaim } : {}),
});
const gapAt = (turn: number, observed?: FeedbackItem['observed']): FeedbackItem => ({
  replay: 'smogtours-gen8ou-562428', turn, kind: 'gap', source: 'expert-2026-08', essence: 'x', desired: 'y',
  ...(observed ? { observed } : {}),
});
const analysesWith = (a: TurnAnalysis): (TurnAnalysis | null)[] => {
  const list: (TurnAnalysis | null)[] = new Array(20).fill(null);
  list[a.turn - 1] = a;
  return list;
};

test.describe('claim evaluator', () => {
  test('an unpinned truth item is pending, never ok', () => {
    const result = evaluateItem(truthAt(12), analysesWith(analysis(12, 'p1-read')), report());
    expect(result.status).toBe('pending');
  });

  test('a fully matching turn claim is ok', () => {
    const item = truthAt(12, {
      side: 'p1', attribution: ['p1-read'], riskPaidOff: true, tier: 'none',
      playedLabelIncludes: 'Close Combat', keyMoment: true,
    });
    const a = analysis(12, 'p1-read', { p1: side({ riskPaidOff: true }) });
    const result = evaluateItem(item, analysesWith(a), report());
    expect(result.status).toBe('ok');
    expect(result.details).toEqual([]);
  });

  test('each mismatching field alone drifts, naming the field', () => {
    const a = analysis(12, 'shift', { p1: side({ tier: 'mistake' as VerdictTier }) });
    const analyses = analysesWith(a);
    const cases: [FeedbackItem['expect'], string][] = [
      [{ attribution: ['p1-read'] }, 'attribution'],
      [{ side: 'p1', riskPaidOff: true }, 'riskPaidOff'],
      [{ side: 'p1', tier: 'none' }, 'tier'],
      [{ side: 'p1', playedLabelIncludes: 'Mandibuzz' }, 'played'],
      [{ keyMoment: false }, 'keyMoment'],
    ];
    for (const [expectClaim, needle] of cases) {
      const result = evaluateItem(truthAt(12, expectClaim), analyses, report());
      expect(result.status).toBe('drift');
      expect(result.details.join(' ')).toContain(needle);
    }
  });

  test('a truth turn with no analysis drifts as a coverage hole', () => {
    const result = evaluateItem(truthAt(12, { attribution: ['p1-read'] }), new Array(20).fill(null), report());
    expect(result.status).toBe('drift');
    expect(result.details.join(' ')).toContain('no analysis');
  });

  test('a matching report claim is ok; membership and turning-point changes drift', () => {
    const claim: ReportClaim = {
      keyMoments: [{ turn: 12, attribution: 'p1-read' }],
      misplays: [{ turn: 3, side: 'p2' }],
      reads: [{ turn: 12, side: 'p1' }],
      turningPoint: 5,
    };
    const whole: FeedbackItem = { replay: 'smogtours-gen6ou-655336', kind: 'truth', source: 'expert-2026-08', essence: 'x', expect: claim };
    expect(evaluateItem(whole, [], report()).status).toBe('ok');
    expect(evaluateItem(whole, [], report({ keyMoments: [] })).status).toBe('drift');
    expect(evaluateItem(whole, [], report({ turningPoint: 9 })).status).toBe('drift');
    expect(evaluateItem(whole, [], null).status).toBe('drift');
  });

  test('gaps: pending without baseline, gap-open on match, gap-moved on change', () => {
    const analyses = analysesWith(analysis(10, 'shift'));
    expect(evaluateItem(gapAt(10), analyses, report()).status).toBe('pending');
    expect(evaluateItem(gapAt(10, { attribution: ['shift'] }), analyses, report()).status).toBe('gap-open');
    const moved = evaluateItem(gapAt(10, { attribution: ['p1-read'] }), analyses, report());
    expect(moved.status).toBe('gap-moved');
    expect(moved.details.length).toBeGreaterThan(0);
  });
});

test.describe('corpus validation', () => {
  const turns = Object.fromEntries(FEEDBACK_REPLAYS.map(id => [id, 100]));

  test('the shipped corpus is well-formed against generous turn counts', () => {
    expect(validateCorpus(FEEDBACK_CORPUS, turns, false)).toEqual([]);
    // BASELINE_PINNED is on: the default validation additionally enforces
    // that every truth item carries its approved pin.
    expect(validateCorpus(FEEDBACK_CORPUS, turns)).toEqual([]);
  });

  test('violations are named: unknown replay, bad turn, cross-kind fields, unpinned truth after baseline', () => {
    const bad: FeedbackItem[] = [
      { replay: 'gen9ou-nope', turn: 1, kind: 'truth', source: 'expert-2026-08', essence: 'x' },
      { replay: FEEDBACK_REPLAYS[0], turn: 0, kind: 'truth', source: 'expert-2026-08', essence: 'x' },
      { replay: FEEDBACK_REPLAYS[0], turn: 999, kind: 'truth', source: 'expert-2026-08', essence: 'x' },
      { replay: FEEDBACK_REPLAYS[0], turn: 2, kind: 'gap', source: 'expert-2026-08', essence: 'x', expect: { keyMoment: true } },
      { replay: FEEDBACK_REPLAYS[0], turn: 3, kind: 'truth', source: 'expert-2026-08', essence: 'x', desired: 'y' },
    ];
    const errors = validateCorpus(bad, turns, false);
    expect(errors.length).toBe(5);
    expect(validateCorpus([{ replay: FEEDBACK_REPLAYS[0], turn: 4, kind: 'truth', source: 'expert-2026-08', essence: 'x' }], turns, true).length).toBe(1);
  });
});

test.describe('drift report rendering', () => {
  test('markdown carries every item; json is stable (no volatile fields in results)', () => {
    const results = [
      evaluateItem(truthAt(12, { attribution: ['p1-read'] }), analysesWith(analysis(12, 'p1-read')), report()),
      evaluateItem(gapAt(10, { attribution: ['shift'] }), analysesWith(analysis(10, 'shift')), report()),
    ];
    const meta = { commit: 'abc1234', date: '2026-08-14', settingsLine: 'd2s3 auto', wallTimes: { x: 60 }, noticeByReplay: {} };
    const { markdown, json } = renderReport(results, meta);
    expect(markdown).toContain('OK');
    expect(markdown).toContain('GAP open');
    expect(markdown).toContain('smogtours-gen8ou-562428');
    const parsed = JSON.parse(json) as { meta: unknown; results: unknown[] };
    expect(parsed.results.length).toBe(2);
    expect(JSON.stringify(parsed.results)).not.toContain('wallTimes');
  });

  test('a runner-constructed error entry renders as ERROR, never silence', () => {
    // The evaluator never emits 'error' — the runner builds these when a
    // replay cannot be graded at all (the 653785 wedged-sweep baseline).
    const errorResult = { item: truthAt(12), status: 'error' as const, details: ['sweep wedged at 10/26 — no progress for 360s'] };
    const meta = { commit: 'abc1234', date: '2026-08-14', settingsLine: 'd2s3 auto', wallTimes: {}, noticeByReplay: {} };
    const { markdown } = renderReport([errorResult], meta);
    expect(markdown).toContain('ERROR');
    expect(markdown).toContain('sweep wedged');
  });
});
