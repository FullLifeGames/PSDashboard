import type { EvalMatrix, EvalResult, GameReport, RankedChoice } from '@fulllifegames/eval-engine';
import type { EvalGraphState } from '../../src/hooks/useEvaluation';
import type { FormatKind } from './sim-state';

export function rankedChoice(choice: string, label: string, ev: number, overrides: Partial<RankedChoice> = {}): RankedChoice {
  return { choice, label, worstCase: ev - 0.2, expected: ev, ev, punishedBy: null, ...overrides };
}

const SINGLES = {
  p1: [
    rankedChoice('move earthquake', 'Earthquake', 0.35, { koOdds: { accuracy: 1, killFraction: 0.43 } }),
    rankedChoice('move swordsdance', 'Swords Dance', 0.2),
    rankedChoice('switch heatran', '→ Heatran', -0.05, { punishedBy: 'Leech Seed' }),
  ],
  p2: [
    rankedChoice('move leechseed', 'Leech Seed', -0.3),
    rankedChoice('move bodypress', 'Body Press', -0.4),
    rankedChoice('switch rotomwash', '→ Rotom-Wash', -0.45),
  ],
};
const DOUBLES = {
  p1: [
    rankedChoice('move fakeout 1, move spore 2', 'Fake Out → Rillaboom + Spore → Tornadus', 0.3),
    rankedChoice('move flareblitz 1, move ragepowder', 'Flare Blitz → Rillaboom + Rage Powder', 0.1),
  ],
  p2: [
    rankedChoice('move tailwind, move grassyglide 1', 'Tailwind + Grassy Glide → Incineroar', -0.25),
    rankedChoice('move taunt 2, move woodhammer 1', 'Taunt → Amoonguss + Wood Hammer → Incineroar', -0.35),
  ],
};

function matrixOf(p1: RankedChoice[], p2: RankedChoice[]): EvalMatrix {
  return {
    p1Labels: p1.map(c => c.label),
    p2Labels: p2.map(c => c.label),
    p1Choices: p1.map(c => c.choice),
    p2Choices: p2.map(c => c.choice),
    values: p1.map((row, i) => p2.map((_, j) => row.ev - 0.1 * j + 0.05 * i)),
    mixes: { p1: p1.map((_, i) => (i === 0 ? 1 : 0)), p2: p2.map((_, i) => (i === 0 ? 1 : 0)) },
  };
}

/** A finished depth-1 search: both sides ranked, the joint matrix, the top p1 move carrying kill odds. */
export function evalResult(kind: FormatKind = 'singles', overrides: Partial<EvalResult> = {}): EvalResult {
  const sides = structuredClone(kind === 'singles' ? SINGLES : DOUBLES);
  return {
    score: sides.p1[0].ev,
    interval: 0.1,
    depthCompleted: 1,
    perSide: sides,
    matrix: matrixOf(sides.p1, sides.p2),
    ...overrides,
  };
}

/** A whole-game sweep over ten turns: scores per turn, results on every turn, no verification yet. */
export function evalGraph(kind: FormatKind = 'singles', overrides: Partial<EvalGraphState> = {}): EvalGraphState {
  const turns = 10;
  const scores = Array.from({ length: turns }, (_, i) => Math.round(Math.sin(i / 2) * 50) / 100);
  return {
    scores,
    results: scores.map(score => evalResult(kind, { score })),
    settings: scores.map(() => ({ depth: 1 as const, samples: 1 as const, mode: 'matrix' as const })),
    faintedFractions: scores.map((_, i) => i / turns),
    played: scores.map(() => null),
    playedOutcome: scores.map(() => null),
    verified: scores.map(() => null),
    sensitivity: scores.map(() => null),
    evalErrors: scores.map(() => null),
    lead: null,
    notice: null,
    running: false,
    progress: null,
    ...overrides,
  };
}

/** A tracked report with a winner, a turning point, and totals; the lists start empty. */
export function gameReport(overrides: Partial<GameReport> = {}): GameReport {
  return {
    winner: 'p1',
    turningPoint: 7,
    keyMoments: [],
    misplays: [],
    reads: [],
    tracked: true,
    accuracy: { p1: 0.92, p2: 0.81 },
    decisionTotals: { p1: -0.12, p2: -0.31 },
    chanceTotal: 0.08,
    resolutionTotal: 0.15,
    summary: 'Alice converted the turn-7 swing into a clean endgame.',
    ...overrides,
  };
}
