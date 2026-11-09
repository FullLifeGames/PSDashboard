import type { SideId } from '@fulllifegames/replay-core';
import { cellKey } from '../rank.ts';
import { TIER_THRESHOLDS, demoteTier, tierOf, type VerdictTier } from '../turn-analysis/types.ts';
import { SUPPORT_MIX } from '../verify-select.ts';
import type { CellBlendClass, EvalCellValue } from '../types.ts';

/**
 * Round 89 (T322, #59), block 2: the strand screen. A grade can hang on one die of one cell that the verify round
 * priced shallow (the Iron Head flinch at 30 %, one ply plus the step or the light search). A strand of chance `w` and
 * value `q` (the side's view) in the opponent's column `j` of mix `y_j` can raise the played row P by at most
 * `y_j w (1 - q)` and lower the best row B by at most `y_j w (1 + q)`. It is worth a search of its own when that bound
 * exceeds the drop that softens the grade by one tier: `d = r - TIER_THRESHOLDS[tier(r)]`, strictly, because r' at the
 * threshold stays in the tier. The pick pairs each strand with the opposite row's heaviest candidate in its column
 * (the optimizer's curse: a row searched deeper beside a row left shallow reads better by construction) and keeps the
 * number of sub-searches under the cap. Pure and sim-free; nothing here searches, scores or changes a matrix.
 */

/** Sub-searches per turn the strand round may spend (the budget of the pre-build probe, A4p: nothing in 63 turns reached 4). */
export const STRAND_CAP_SINGLES = 6;
export const STRAND_CAP_DOUBLES = 4;
export const strandCap = (kind: 'singles' | 'doubles'): number => kind === 'doubles' ? STRAND_CAP_DOUBLES : STRAND_CAP_SINGLES;

export type StrandRole = 'P' | 'B';

/** One open class of a verified cell that could tip the grade (values in the side's own view). */
export interface StrandCandidate {
  role: StrandRole;
  /** The cell in the matrix: p1 option `i`, p2 option `j`. */
  i: number;
  j: number;
  /** The side's opponent column: the matrix column for p1, the matrix row for p2. */
  column: number;
  classKey: string;
  /** The class's analytic weight in its cell. */
  w: number;
  /** The opponent's mix on the column. */
  y: number;
  /** The class value now (its deepened value, else its leaf mean), side's view. */
  q: number;
  /** How much the strand can move the regret towards zero. */
  bound: number;
}

export interface StrandScreenInput {
  side: SideId;
  /** The grid in p1's view: values[p1 option][p2 option]. An answered side passes its own answered grid. */
  values: readonly (readonly number[])[];
  /** The opponent's mix over its options (the side's own re-solved mix for an answered side). */
  oppMix: readonly number[];
  /** The side's played option (index into its own options). */
  played: number;
  /** Whether the side's own score before the turn is at DECIDED_SCORE or beyond. */
  decided: boolean;
  /** Verified cells by `cellKey(i, j)`. */
  verified: ReadonlyMap<number, Pick<EvalCellValue, 'blend'>>;
  /** Whether the trees' pool already carries the class's own depth (`classPoolTrust`). */
  trusted: (i: number, j: number, classKey: string) => boolean;
}

export interface ScreenedSide {
  side: SideId;
  P: number;
  B: number;
  evP: number;
  evB: number;
  /** The best ev among the rows other than P and B; minus infinity without a third row. */
  second: number;
  r: number;
  /** The graded tier (after the decided leniency); undefined: nothing to soften. */
  tier: VerdictTier | undefined;
  /** The drop that softens the grade: r minus the threshold of r's own band. */
  d: number;
  /** The strands whose bound exceeds d, heaviest first. */
  strands: StrandCandidate[];
  /** Every open shallow untrusted class in the cells of P and B at support columns, heaviest first (the pairing reads these). */
  candidates: StrandCandidate[];
}

const NONE: Omit<ScreenedSide, 'side' | 'P' | 'B'> = {
  evP: 0, evB: 0, second: Number.NEGATIVE_INFINITY, r: 0, tier: undefined, d: 0, strands: [], candidates: [],
};

const byBound = (a: StrandCandidate, b: StrandCandidate): number =>
  b.bound - a.bound || a.column - b.column || (a.role === b.role ? 0 : a.role === 'B' ? -1 : 1) || (a.classKey < b.classKey ? -1 : a.classKey > b.classKey ? 1 : 0);

/**
 * A class is a candidate when the verify round priced it shallow (`light` or `shift`), no tree carries its depth and it
 * is still open. A class the round priced `full` (a full depth-1 sub-search, or a light one that cut nothing), an ended
 * class and an unmarked one stand at their depth already.
 */
function candidateClasses(blend: { classes: CellBlendClass[] } | undefined): CellBlendClass[] {
  return (blend?.classes ?? []).filter(cls => !cls.ended && cls.count > 0 && cls.weight > 0 && (cls.priced === 'light' || cls.priced === 'shift'));
}

/** The side's rows: their ev against `oppMix`, in the side's own view. */
function rowsOf(input: StrandScreenInput): { ev: number; worst: number }[] {
  const { side, values, oppMix } = input;
  const own = side === 'p1' ? values.length : (values[0]?.length ?? 0);
  const sign = side === 'p1' ? 1 : -1;
  return Array.from({ length: own }, (_, a) => {
    let ev = 0;
    let worst = Number.POSITIVE_INFINITY;
    for (let c = 0; c < oppMix.length; c++) {
      const v = sign * (side === 'p1' ? values[a][c] : values[c][a]);
      ev += v * oppMix[c];
      if (v < worst) worst = v;
    }
    return { ev, worst };
  });
}

/** The side's best row (ev, then the floor, then the lower index), its regret and the second row. */
function ranking(rows: readonly { ev: number; worst: number }[], played: number): Pick<ScreenedSide, 'B' | 'evP' | 'evB' | 'second' | 'r'> {
  let best = 0;
  for (let a = 1; a < rows.length; a++) {
    if (rows[a].ev > rows[best].ev || (rows[a].ev === rows[best].ev && rows[a].worst > rows[best].worst)) best = a;
  }
  const second = rows.reduce((most, row, a) => a === played || a === best ? most : Math.max(most, row.ev), Number.NEGATIVE_INFINITY);
  return { B: best, evP: rows[played].ev, evB: rows[best].ev, second, r: rows[best].ev - rows[played].ev };
}

/** The open shallow untrusted classes in the cells of P and B at the support columns, heaviest bound first. */
function collectCandidates(input: StrandScreenInput, best: number): StrandCandidate[] {
  const { side, played } = input;
  const sign = side === 'p1' ? 1 : -1;
  const candidates: StrandCandidate[] = [];
  for (let column = 0; column < input.oppMix.length; column++) {
    const y = input.oppMix[column];
    if (!(y >= SUPPORT_MIX)) continue;
    for (const [role, own] of [['P', played], ['B', best]] as const) {
      const [i, j] = side === 'p1' ? [own, column] : [column, own];
      for (const cls of candidateClasses(input.verified.get(cellKey(i, j))?.blend)) {
        if (input.trusted(i, j, cls.key)) continue;
        const q = sign * (cls.deepened ?? cls.leafSum / cls.count);
        const bound = role === 'P' ? y * cls.weight * (1 - q) : y * cls.weight * (1 + q);
        candidates.push({ role, i, j, column, classKey: cls.key, w: cls.weight, y, q, bound });
      }
    }
  }
  return candidates.sort(byBound);
}

/** Round 89 (T322, #59): the strands of one side that could soften its grade. */
export function screenStrands(input: StrandScreenInput): ScreenedSide {
  const { side, played } = input;
  const rows = rowsOf(input);
  if (!Number.isInteger(played) || played < 0 || played >= rows.length) return { side, P: played, B: played, ...NONE };
  const ranked = ranking(rows, played);
  const raw = tierOf(ranked.r);
  const tier = ranked.B === played || !raw ? undefined : input.decided ? demoteTier(raw) : raw;
  const base = { side, P: played, ...ranked, tier, d: raw ? ranked.r - TIER_THRESHOLDS[raw] : 0 };
  if (!tier) return { ...base, strands: [], candidates: [] };
  const candidates = collectCandidates(input, ranked.B);
  return { ...base, strands: candidates.filter(strand => strand.bound > base.d), candidates };
}

/** One sub-search of the round: the cell and class, and the sides and roles that read its value. */
export interface StrandSearch {
  i: number;
  j: number;
  classKey: string;
  /** The largest bound among the readers. */
  bound: number;
  uses: { side: SideId; role: StrandRole; paired: boolean }[];
}

const searchKey = (i: number, j: number, classKey: string): string => `${i}:${j}:${classKey}`;

/**
 * Round 89 (T322, #59): which strands get a sub-search. The screened strands go heaviest bound first. A strand pairs
 * with the heaviest candidate of the other row in its column (passing the screen or not); without one it goes alone,
 * like against like (the other row's cell stands at one depth there, ruling D2). A search that two sides share counts
 * once. A strand whose pair no longer fits under `cap` is skipped and the next tried.
 */
export function pickStrands(screened: readonly ScreenedSide[], cap: number): StrandSearch[] {
  const leaders = screened.flatMap(side => side.strands.map(strand => ({ side, strand })));
  leaders.sort((a, b) => byBound(a.strand, b.strand) || (a.side.side < b.side.side ? -1 : a.side.side > b.side.side ? 1 : 0));
  const picked = new Map<string, StrandSearch>();
  const add = (side: ScreenedSide, strand: StrandCandidate, paired: boolean): void => {
    const key = searchKey(strand.i, strand.j, strand.classKey);
    const search = picked.get(key) ?? { i: strand.i, j: strand.j, classKey: strand.classKey, bound: 0, uses: [] };
    search.bound = Math.max(search.bound, strand.bound);
    if (!search.uses.some(use => use.side === side.side && use.role === strand.role)) search.uses.push({ side: side.side, role: strand.role, paired });
    picked.set(key, search);
  };
  for (const { side, strand } of leaders) {
    const partner = side.candidates.find(other => other.role !== strand.role && other.column === strand.column);
    const group = partner ? [strand, partner] : [strand];
    const fresh = group.filter(member => !picked.has(searchKey(member.i, member.j, member.classKey))).length;
    if (picked.size + fresh > cap) continue;
    for (const member of group) add(side, member, group.length === 2);
  }
  return [...picked.values()];
}

/**
 * Round 89 (T322, #59): the regret after the searches, `y` held fixed. Each searched strand moves its row by
 * `y w (searched - before)`; a B row that falls below the second row stops there. The values are in the side's view.
 */
export function strandRegret(
  side: Pick<ScreenedSide, 'evP' | 'evB' | 'second'>, searched: readonly { strand: StrandCandidate; value: number }[],
): { evP: number; evB: number; regret: number } {
  let evP = side.evP;
  let evB = side.evB;
  for (const { strand, value } of searched) {
    const move = strand.y * strand.w * (value - strand.q);
    if (strand.role === 'P') evP += move;
    else evB += move;
  }
  return { evP, evB, regret: Math.max(evB, side.second) - evP };
}
