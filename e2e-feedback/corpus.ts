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
export const BASELINE_PINNED = false;

export const FEEDBACK_REPLAYS = [
  'smogtours-gen8ou-573756',
  'smogtours-gen8ou-562428',
  'smogtours-gen6ou-648453',
  'smogtours-gen6ou-649664',
  'smogtours-gen6ou-653785',
  'smogtours-gen6ou-655336',
] as const;

export const FEEDBACK_CORPUS: FeedbackItem[] = [
  // ---- truth ----
  {
    replay: 'smogtours-gen8ou-573756', turn: 76, kind: 'truth', source: 'expert-2026-08',
    essence: "SoulWind's game-breaking play is recognized — the analysis credits the strong play that briefly brought him back into the game.",
  },
  {
    replay: 'smogtours-gen8ou-562428', turn: 12, kind: 'truth', source: 'expert-2026-08',
    essence: "LordEnz's Close Combat over the safe Mandibuzz line is graded as a read that paid off; the expert explicitly praised that framing.",
  },
  {
    replay: 'smogtours-gen6ou-648453', turn: 20, kind: 'truth', source: 'expert-2026-08',
    essence: "BKC's good play is correctly recognized.",
  },
  {
    replay: 'smogtours-gen6ou-655336', kind: 'truth', source: 'expert-2026-08',
    essence: 'The end-of-analysis highlights match the game — essentially all good plays and misplays are recognized. Frozen as a golden report subset.',
  },
  // ---- gaps ----
  {
    replay: 'smogtours-gen8ou-573756', turn: 68, kind: 'gap', source: 'expert-2026-08',
    essence: "p2's Weavile sacrifice into Corviknight is called a misplay, but it is what enables the Garchomp sweep — the game-winning play. Win-condition horizon: a sac whose payoff arrives many turns later reads as a blunder.",
    desired: 'The sacrifice stops being graded mistake/blunder once the engine can see or verify the win-condition payoff behind it.',
  },
  {
    replay: 'smogtours-gen8ou-562428', turn: 10, kind: 'gap', source: 'expert-2026-08',
    essence: 'The no-blunder shift verdict looks right but is shallow-wrong: both sides had four or more live options and the turn was a read — a Heatran switch would have flipped the advantage. The engine never represented the real decision space.',
    desired: "The analysis represents the turn's real decision breadth (read framing) instead of a no-blunder drift.",
  },
  {
    replay: 'smogtours-gen6ou-648453', turn: 13, kind: 'gap', source: 'expert-2026-08',
    essence: 'Misplay verdict against BKC with unusable reasoning; if the play works, the opponent must sacrifice into Lopunny. Missing principle: an opposing mon with NO remaining switch-ins makes any successful switch into it profitable (even via U-turn).',
    desired: 'The engine recognizes the no-switch-ins-left state and the reasoning names it.',
  },
  {
    replay: 'smogtours-gen6ou-649664', turn: 23, kind: 'gap', source: 'expert-2026-08',
    essence: 'Graded as a risk, but Keldeo was visibly choice-locked — Hydro Pump was the only winning play, not a gamble. The reasoning assumed Scald kills; the odds are ~43%, worse than landing two Hydro Pumps.',
    desired: 'Observed choice locks constrain the option set (a locked side is forced), and kill-odds claims are arithmetically grounded.',
  },
  {
    replay: 'smogtours-gen6ou-653785', turn: 19, kind: 'gap', source: 'expert-2026-08',
    essence: 'Will-O-Wisp is proposed over the Weavile switch against Charizard-X — Fire types cannot be burned, the suggestion is mechanically useless (the expert: the first gross error). Attached: branching this turn fails on the old-gen Return move id (registered bug, ledger 2026-08-14, commit ce00d4c).',
    desired: 'Mechanically null moves never surface as recommendations (or carry their enabling condition), and the Return/Frustration id family branches correctly.',
  },
];
