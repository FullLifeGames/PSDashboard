import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { TurnAttribution, VerdictTier } from '../src/lib/eval/analysis';

/**
 * Ground truth distilled from the expert feedback round of 2026-08.
 * FeedbackEval.xlsx stays local and untracked; only English essence lives
 * here — never verbatim quotes. Truth items are asserted by the drift run;
 * gap items are tracked (open/moved), never asserted. Every pin, promotion,
 * and "engine was right" conclusion lands only after the user's explicit
 * approval, in a reviewed commit — the corpus history is the audit trail.
 */

/** Claim against one turn's TurnAnalysis. Only present fields are checked. */
export interface TurnClaim {
  side?: 'p1' | 'p2';
  /** Acceptable attributions — drift when the actual one is outside the set. */
  attribution?: TurnAttribution[];
  riskPaidOff?: boolean;
  /** Expected verdict band on `side` ('none' = no tier at all). */
  tier?: VerdictTier | 'none';
  /** Substring of the matched played label — a sanity anchor. */
  playedLabelIncludes?: string;
  /** Whether the turn must appear among the report's key moments. */
  keyMoment?: boolean;
  /**
   * Narrative pins (round 5 ⑥): every fragment must appear in the turn's
   * rendered summary (`summarizeTurn` with the replay's player names). Keep
   * fragments short and structural ("open turn", "cannot be burned") — the
   * summary wording may be refined without moving verdicts.
   */
  summaryIncludes?: string[];
}

/** Frozen GameReport subset for a whole-game truth item. */
export interface ReportClaim {
  keyMoments: { turn: number; attribution: TurnAttribution }[];
  misplays: { turn: number; side: 'p1' | 'p2' }[];
  reads: { turn: number; side: 'p1' | 'p2' }[];
  turningPoint: number | null;
}

export interface FeedbackItem {
  replay: string;
  /** 1-based played turn; absent = whole-game item (ReportClaim territory). */
  turn?: number;
  kind: 'truth' | 'gap';
  source: 'expert-2026-08';
  essence: string;
  /** truth only — pinned from the user-approved baseline. */
  expect?: TurnClaim | ReportClaim;
  /** gap only — what the engine said at baseline (the gap-open reference). */
  observed?: TurnClaim;
  /** gap only — the direction a fix must move. */
  desired?: string;
}

/** Flipped true in the commit that lands the approved baseline pins. */
export const BASELINE_PINNED = true;

/** The user-approved 655336 report freeze (baseline ef342fa, 2026-08-14). */
const GOLDEN_655336 = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'golden', 'smogtours-gen6ou-655336.report.json'),
  'utf-8',
)) as ReportClaim;

export const FEEDBACK_REPLAYS = [
  'smogtours-gen8ou-573756',
  'smogtours-gen8ou-562428',
  'smogtours-gen6ou-648453',
  'smogtours-gen6ou-649664',
  'smogtours-gen6ou-653785',
  'smogtours-gen6ou-655336',
] as const;

export const FEEDBACK_CORPUS: FeedbackItem[] = [
  // ---- truth (pins approved by the user at Gate 1, 2026-08-14) ----
  {
    replay: 'smogtours-gen8ou-573756', turn: 75, kind: 'truth', source: 'expert-2026-08',
    essence: "SoulWind's double switch into Kyurem — the game-breaking play that briefly brought him back — is recognized as a paid-off read. (The expert referenced it as t76; the analysis banks the read on t75, confirmed by the user.)",
    expect: { side: 'p1', riskPaidOff: true, playedLabelIncludes: 'Kyurem' },
  },
  {
    replay: 'smogtours-gen8ou-562428', turn: 12, kind: 'truth', source: 'expert-2026-08',
    essence: "LordEnz's Close Combat over the safe Mandibuzz line is graded as a read that paid off; the expert explicitly praised that framing.",
    expect: { side: 'p1', attribution: ['p1-read'], riskPaidOff: true, playedLabelIncludes: 'Close Combat', keyMoment: true },
  },
  {
    replay: 'smogtours-gen6ou-648453', turn: 20, kind: 'truth', source: 'expert-2026-08',
    essence: "BKC's good play is correctly recognized — Knock Off graded as a paid-off read.",
    expect: { side: 'p2', attribution: ['p2-read'], riskPaidOff: true, playedLabelIncludes: 'Knock Off' },
  },
  {
    replay: 'smogtours-gen6ou-655336', kind: 'truth', source: 'expert-2026-08',
    essence: 'The end-of-analysis highlights match the game — essentially all good plays and misplays are recognized. Frozen as a golden report subset. (KNOWN DRIFT since 2026-08-15: newly evaluated turns add misplay t23/t24 + read t24 — user-rejected engine artifacts. ④ round 3 landed stranded pricing and the feed pathway and SOFTENED the curve — post-DD t24 0.289 → 0.376, toward the expert — but the verdict artifacts persist: stranded pricing does not fire in these positions and the sweep weight was not adoptable (fit-implied sign NEGATIVE, −111.5 ± 64.0 — collinear with the boosts feature; the no-boosts variant fits +97.8 ± 67.2). Golden stays until the boosts↔sweep disentanglement agenda item lands.)',
    expect: GOLDEN_655336,
  },
  // ---- gaps (observed baselines recorded at Gate 1, commit ef342fa) ----
  {
    replay: 'smogtours-gen8ou-573756', turn: 68, kind: 'gap', source: 'expert-2026-08',
    essence: "p2's Weavile sacrifice into Corviknight is called a misplay, but it is what enables the Garchomp sweep — the game-winning play. Win-condition horizon: a sac whose payoff arrives many turns later reads as a blunder. (Re-pinned 2026-08-15 round 3, user-approved: the ④ feed pathway landed — a stay-and-die feed whose outcome was priced certain (ev ≈ floor) and whose windowed payoff clears the safe guarantee grades as a sacrifice; t68 drops mistake → inaccuracy (one-band demotion by design) with the feed named in the summary. Toward the expert.)",
    observed: { side: 'p2', tier: 'inaccuracy', attribution: ['quiet'] },
    desired: 'The sacrifice stops being graded mistake/blunder once the engine can see or verify the win-condition payoff behind it.',
  },
  {
    replay: 'smogtours-gen8ou-562428', turn: 10, kind: 'gap', source: 'expert-2026-08',
    essence: 'The no-blunder shift verdict looks right but is shallow-wrong: both sides had four or more live options and the turn was a read — a Heatran switch would have flipped the advantage. The engine never represented the real decision space. (Re-pinned 2026-08-16 round 5, user-approved: the breadth narrative landed — the summary now reads "A genuinely open turn rather than a drift — 9 of 9 options … and 11 of 13 … sat within an inaccuracy of best, so the turn hinged on out-predicting the opponent", pinned via summaryIncludes. Toward the expert; the remaining desired half is an actual read RECOMMENDATION (opponent-model territory, e.g. the Heatran switch), not just naming the breadth.)',
    observed: { attribution: ['shift'], summaryIncludes: ['open turn'] },
    desired: "The analysis represents the turn's real decision breadth (read framing) instead of a no-blunder drift.",
  },
  {
    replay: 'smogtours-gen6ou-648453', turn: 13, kind: 'gap', source: 'expert-2026-08',
    essence: 'Misplay verdict against BKC with unusable reasoning; if the play works, the opponent must sacrifice into Lopunny. Missing principle: an opposing mon with NO remaining switch-ins makes any successful switch into it profitable (even via U-turn). (Re-pinned 2026-08-15: the mistake verdict evaporated once the silently lost neighbor turns 14-16 evaluate — toward the expert; the no-switch-ins principle stays open.)',
    observed: { side: 'p2', tier: 'none', attribution: ['quiet'] },
    desired: 'The engine recognizes the no-switch-ins-left state and the reasoning names it.',
  },
  {
    replay: 'smogtours-gen6ou-649664', turn: 23, kind: 'gap', source: 'expert-2026-08',
    essence: 'Graded as a risk, but Keldeo was visibly choice-locked — Hydro Pump was the only winning play, not a gamble. The reasoning assumed Scald kills; the odds are ~43%, worse than landing two Hydro Pumps. (Re-pinned 2026-08-15 round 4, user-approved: the hax-aligned seeds sample the t23 root differently and the false mistake verdict dissolves — mistake/p1-decision → none/p1-read, toward the expert. The structural weakness stays: binary events still price at sampled frequencies, not true probabilities — the Erwartungs-Grundierung agenda item.)',
    observed: { side: 'p1', tier: 'none', attribution: ['p1-read'] },
    desired: 'Observed choice locks constrain the option set (a locked side is forced), and kill-odds claims are arithmetically grounded.',
  },
  {
    replay: 'smogtours-gen6ou-653785', turn: 19, kind: 'gap', source: 'expert-2026-08',
    essence: 'Will-O-Wisp is proposed over the Weavile switch against Charizard-X — Fire types cannot be burned, the suggestion is mechanically useless (the expert: the first gross error). (Re-pinned 2026-08-15: the blunder verdict evaporated once turns 20-23 evaluate and Lopunny lines price — toward the expert, who contested the blunder; the conditional-recommendation narrative stays open. The attached Return branching bug is FIXED — a370c61. Re-pinned again 2026-08-15 round 2, user-approved: tier none → inaccuracy after Tornadus-T\'s typeless Hidden Power resolves to its evidence-proven HP Ice — the t15/t24 super markers refute the old IV-default Dark, so turns 20-23 price with corrected rolls; the endgame also loses 2 reconstructed turns to a seeded sim CRIT the real game did not have (hax alignment — seed search / scripted PRNG — is future-iteration agenda). Re-pinned 2026-08-15 round 3, user-approved: inaccuracy → none — stranded-bench pricing (④ B1) reprices the position and the regret falls below the inaccuracy band; the engine\'s recommendation is now Hex, not the null Will-O-Wisp, so the mechanically-null complaint softens too. Round 5 2026-08-16, user-approved note: the GENERAL null-move guard landed — a mechanically null recommendation now swaps to a co-optimal alternative or carries its enabling-condition caveat, engine-wide (fires on 573756 Toxic→Toxapex and 562428 Toxic/Earthquake→Corviknight); the Will-O-Wisp half of the desired is delivered.)',
    observed: { side: 'p1', tier: 'none', attribution: ['quiet'] },
    desired: 'Mechanically null moves never surface as recommendations (or carry their enabling condition), and the Return/Frustration id family branches correctly.',
  },
];
