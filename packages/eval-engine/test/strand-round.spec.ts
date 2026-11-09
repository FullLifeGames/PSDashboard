import { describe, expect, test } from 'vitest';
import {
  pickStrands, screenStrands, strandCap, strandRegret, STRAND_CAP_DOUBLES, STRAND_CAP_SINGLES,
  type StrandCandidate, type StrandScreenInput,
} from '../src/search/strand-round';
import { SUPPORT_MIX } from '../src/verify-select';
import { cellKey } from '../src/rank';
import { DECIDED_SCORE, TIER_THRESHOLDS } from '../src/turn-analysis/types';
import type { CellBlendClass, ClassPricing, EvalCellValue } from '../src/types';

/**
 * Round 89 (T322, #59), block 2 stage 1: the strand screen on synthetic matrices. Scene: a side played row P while row
 * B was better by r; a verified cell of P (or B) holds an open class (a 30 % flinch, a 10 % miss) that the verify round
 * priced shallow (one ply plus the step, or the light search). The screen names the strands whose chance could move r
 * across the tier line, and the pick pairs them and keeps the cost under the cap. The rows run on the class keys of
 * every game type: the screen reads keys as opaque strings, the cap differs between singles and doubles.
 */

const cls = (key: string, weight: number, value: number, priced: ClassPricing | undefined, extra: Partial<CellBlendClass> = {}): CellBlendClass => ({
  key, weight, leafSum: value, count: 1, hasFirst: false, ended: false, ...(priced ? { priced } : {}), ...extra,
});

type Verified = Map<number, Pick<EvalCellValue, 'blend'>>;
const cells = (...list: [number, number, CellBlendClass[]][]): Verified =>
  new Map(list.map(([i, j, classes]) => [cellKey(i, j), { blend: { classes, firstLeaf: 0 } }]));

const never = () => false;

/** Three p1 rows (0 best, 1 played, 2 weak) against two columns of mix 0.6 and 0.4: evB 0.42, evP 0.04, r 0.38 (mistake, d 0.18). */
const VALUES = [[0.5, 0.3], [0, 0.1], [-0.5, -0.5]];
const MIX = [0.6, 0.4];

function input(over: Partial<StrandScreenInput> = {}): StrandScreenInput {
  return { side: 'p1', values: VALUES, oppMix: MIX, played: 1, decided: false, verified: new Map(), trusted: never, ...over };
}

const keys = (list: readonly StrandCandidate[]) => list.map(s => `${s.role}${s.i}.${s.j}:${s.classKey}`);

const GAME_TYPES = [
  { name: 'singles', kind: 'singles' as const, flinch: 'hit-nokill+flinch', miss: 'miss', tied: 'p1:hit-nokill|miss' },
  { name: 'Doubles OU', kind: 'doubles' as const, flinch: 'p1b:ironhead>p2a=hit-nokill+flinch', miss: 'p2a:thunderbolt>p1b=miss', tied: 'p1a:protect|p2b:fakeout=hit-nokill|miss' },
  { name: 'VGC', kind: 'doubles' as const, flinch: 'p1a:makeitrain>p2a=hit-nokill+flinch', miss: 'p2b:heatwave>p1b=miss', tied: 'p1a:icywind|p2a:protect=hit-nokill|miss' },
  { name: 'Champions VGC', kind: 'doubles' as const, flinch: 'p1a:flareblitz>p2a=hit-nokill+brn', miss: 'p2a:drainpunch>p1a=miss', tied: 'p1b:fakeout|p2b:snarl=hit-kill|miss' },
];

describe('screenStrands (T322 block 2, stage 1)', () => {
  describe.each(GAME_TYPES)('$name keys', ({ flinch, miss, tied }) => {
    test('s1/s3: the bound y w (1 - q) of P passes against the drop to the next tier line, a smaller one does not', () => {
      // P cell (1, 0): y 0.6, w 0.5, q -0.2 gives 0.36 against d = 0.38 - 0.2 = 0.18.
      const heavy = screenStrands(input({ verified: cells([1, 0, [cls(flinch, 0.5, -0.2, 'light')]]) }));
      expect(heavy.tier).toBe('mistake');
      expect(heavy.r).toBeCloseTo(0.38, 12);
      expect(heavy.d).toBeCloseTo(0.18, 12);
      expect(keys(heavy.strands)).toEqual([`P1.0:${flinch}`]);
      expect(heavy.strands[0].bound).toBeCloseTo(0.6 * 0.5 * 1.2, 12);
      const light = screenStrands(input({ verified: cells([1, 0, [cls(flinch, 0.1, -0.2, 'light')]]) }));
      expect(light.strands).toEqual([]);
      expect(keys(light.candidates)).toEqual([`P1.0:${flinch}`]);
    });

    test('s3: B lowers by at most y w (1 + q); a tied prefix key and a miss key are classes like any other', () => {
      const screened = screenStrands(input({
        verified: cells([0, 0, [cls(miss, 0.3, 0.4, 'shift'), cls(tied, 0.35, -0.5, 'light')]]),
      }));
      const byKey = Object.fromEntries(screened.candidates.map(s => [s.classKey, s]));
      expect(byKey[miss].role).toBe('B');
      expect(byKey[miss].bound).toBeCloseTo(0.6 * 0.3 * 1.4, 12);
      expect(byKey[tied].bound).toBeCloseTo(0.6 * 0.35 * 0.5, 12);
      // 0.252 passes (d 0.18); 0.105 does not.
      expect(keys(screened.strands)).toEqual([`B0.0:${miss}`]);
    });
  });

  test('s1: a bound equal to d is not screened (r\' = the threshold stays in the tier), one step above is', () => {
    const values = [[0.5], [0]];
    const r = 0.5 - 0;
    const d = r - TIER_THRESHOLDS.blunder;
    const at = screenStrands({ side: 'p1', values, oppMix: [1], played: 1, decided: false, trusted: never, verified: cells([1, 0, [cls('miss', d, 0, 'light')]]) });
    expect(at.d).toBe(d);
    expect(at.strands).toEqual([]);
    const above = screenStrands({ side: 'p1', values, oppMix: [1], played: 1, decided: false, trusted: never, verified: cells([1, 0, [cls('miss', d * 1.01, 0, 'light')]]) });
    expect(above.strands).toHaveLength(1);
  });

  test('s2: only support columns (y at SUPPORT_MIX or more), only cells with a blend, only open untrusted shallow classes', () => {
    const values = [[0.5, 0.3, 0.3], [0, 0.1, 0.1]];
    const mix = [1 - SUPPORT_MIX - 0.01, SUPPORT_MIX, 0.01];
    const big = (key: string, priced: ClassPricing | undefined, extra: Partial<CellBlendClass> = {}) => cls(key, 0.9, -0.9, priced, extra);
    const verified = cells(
      [1, 0, [big('light', 'light'), big('shift', 'shift'), big('full', 'full'), big('unmarked', undefined), big('ended', 'light', { ended: true }), big('trusted', 'light')]],
      [1, 1, [big('edge', 'shift')]],
      [1, 2, [big('thin', 'shift')]],
    );
    verified.set(cellKey(0, 0), {});
    const screened = screenStrands({
      side: 'p1', values, oppMix: mix, played: 1, decided: false, verified,
      trusted: (i, j, classKey) => classKey === 'trusted' && i === 1 && j === 0,
    });
    expect(keys(screened.candidates).sort()).toEqual(['P1.0:light', 'P1.0:shift', 'P1.1:edge']);
    const below = screenStrands({
      side: 'p1', values, oppMix: [1 - SUPPORT_MIX + 0.001, SUPPORT_MIX - 0.001, 0], played: 1, decided: false, verified, trusted: never,
    });
    expect(keys(below.candidates)).not.toContain('P1.1:edge');
  });

  test('s2: a cell outside the verified map yields nothing', () => {
    expect(screenStrands(input()).candidates).toEqual([]);
  });

  test('s3: the value q of a class is its deepened value where it has one, else the leaf mean (p1 view)', () => {
    const open = cls('miss', 0.5, 0, 'light', { leafSum: -1.2, count: 2, deepened: -0.2 });
    const flat = cls('hit', 0.5, 0, 'shift', { leafSum: -1.2, count: 2 });
    const screened = screenStrands(input({ verified: cells([1, 0, [open, flat]]) }));
    const q = Object.fromEntries(screened.candidates.map(s => [s.classKey, s.q]));
    expect(q).toEqual({ miss: -0.2, hit: -0.6 });
  });

  test('s3: p2 reads the same grid negated; the matrix cell (p1 option, p2 option) holds the class', () => {
    // p2 played its option 0 (ev -0.4 against p1's mix 0.5/0.5), option 1 reads 0: r 0.4. Its cell for (p2 option a, p1 row j) is (j, a).
    const screened = screenStrands({
      side: 'p2', values: [[0.6, -0.1], [0.2, 0.1]], oppMix: [0.5, 0.5], played: 0, decided: false, trusted: never,
      verified: cells([0, 0, [cls('miss', 0.9, -0.5, 'light')]], [1, 1, [cls('flinch', 0.9, 0.5, 'light')]]),
    });
    expect(screened.P).toBe(0);
    expect(screened.B).toBe(1);
    expect(screened.evP).toBeCloseTo(-0.4, 12);
    expect(screened.evB).toBeCloseTo(0, 12);
    // A class worth -0.5 to p1 is worth +0.5 to p2: P bound y w (1 - q) = 0.5 * 0.9 * 0.5; B (+0.5 to p1) is -0.5 to p2: y w (1 + q) = 0.5 * 0.9 * 0.5.
    const own = screened.candidates.find(s => s.classKey === 'miss')!;
    expect([own.role, own.i, own.j, own.column]).toEqual(['P', 0, 0, 0]);
    expect(own.q).toBeCloseTo(0.5, 12);
    expect(own.bound).toBeCloseTo(0.5 * 0.9 * 0.5, 12);
    const other = screened.candidates.find(s => s.classKey === 'flinch')!;
    expect([other.role, other.i, other.j, other.column]).toEqual(['B', 1, 1, 1]);
    expect(other.q).toBeCloseTo(-0.5, 12);
    expect(other.bound).toBeCloseTo(0.5 * 0.9 * 0.5, 12);
  });

  test('s6: no strands where P is B, where r carries no tier, or where the decided rule leaves no tier', () => {
    const verified = cells([1, 0, [cls('miss', 0.9, -0.9, 'light')]], [0, 0, [cls('hit', 0.9, 0.9, 'light')]]);
    expect(screenStrands(input({ played: 0, verified })).strands).toEqual([]);
    expect(screenStrands(input({ played: 0, verified })).tier).toBeUndefined();
    // r 0.08: below the inaccuracy line.
    const small = screenStrands({ side: 'p1', values: [[0.18], [0.1]], oppMix: [1], played: 1, decided: false, verified, trusted: never });
    expect(small.tier).toBeUndefined();
    expect(small.candidates).toEqual([]);
    // An inaccuracy in a decided position grades none (demoted); a mistake stays an inaccuracy.
    const inaccuracy = screenStrands({ side: 'p1', values: [[0.15], [0]], oppMix: [1], played: 1, decided: true, verified, trusted: never });
    expect(inaccuracy.tier).toBeUndefined();
    expect(inaccuracy.candidates).toEqual([]);
    const mistake = screenStrands({ side: 'p1', values: [[0.25], [0]], oppMix: [1], played: 1, decided: true, verified, trusted: never });
    expect(mistake.tier).toBe('inaccuracy');
    expect(mistake.d).toBeCloseTo(0.25 - TIER_THRESHOLDS.mistake, 12);
    expect(DECIDED_SCORE).toBe(0.7);
  });

  test('s6: an unmatched played option (out of range) screens nothing', () => {
    expect(screenStrands(input({ played: 9 })).strands).toEqual([]);
    expect(screenStrands(input({ played: -1 })).strands).toEqual([]);
  });

  test('s8: an answered side screens on its own grid and mix; a column without a verified cell yields no strand', () => {
    // The answer round added a column 2 (no verified cell) that changes B to row 2.
    const values = [[0.5, 0.3, 0.5], [0, 0.1, 0.1], [0.2, 0.2, 0.9]];
    const mix = [0.4, 0.2, 0.4];
    const screened = screenStrands({
      side: 'p1', values, oppMix: mix, played: 1, decided: false, trusted: never,
      verified: cells([1, 0, [cls('flinch', 0.9, -0.5, 'light')]], [1, 2, [cls('miss', 0.9, -0.5, 'light')]]),
    });
    expect(screened.B).toBe(2);
    expect(screened.evB).toBeCloseTo(0.2 * 0.4 + 0.2 * 0.2 + 0.9 * 0.4, 12);
    expect(screened.evP).toBeCloseTo(0.1 * 0.2 + 0.1 * 0.4, 12);
    // Cells of row B = 2 are not verified: only P strands.
    expect(screened.candidates.every(s => s.role === 'P')).toBe(true);
    expect(keys(screened.strands).sort()).toEqual(['P1.0:flinch', 'P1.2:miss']);
  });
});

describe('pickStrands (T322 block 2, stage 1)', () => {
  const pairScene = () => screenStrands(input({
    verified: cells(
      [1, 0, [cls('p-flinch', 0.5, -0.2, 'light')]],
      [0, 0, [cls('b-miss', 0.05, 0.9, 'light')]],
      [1, 1, [cls('p-late', 0.9, -0.5, 'shift')]],
    ),
  }));

  test('s4: a P strand pairs with the heaviest B candidate of its column, even one below the screen', () => {
    const picked = pickStrands([pairScene()], 6);
    const column0 = picked.filter(s => s.j === 0).map(s => `${s.i}:${s.classKey}`).sort();
    expect(column0).toEqual(['0:b-miss', '1:p-flinch']);
    const partner = picked.find(s => s.classKey === 'b-miss');
    expect(partner?.uses).toEqual([{ side: 'p1', role: 'B', paired: true }]);
  });

  test('s4: a P strand goes alone when B has no candidate in its column (B stands at one depth there)', () => {
    const picked = pickStrands([pairScene()], 6);
    const alone = picked.find(s => s.classKey === 'p-late');
    expect(alone?.uses).toEqual([{ side: 'p1', role: 'P', paired: false }]);
  });

  test('s4: a passing B strand pairs with the heaviest P candidate of its column', () => {
    const screened = screenStrands(input({
      verified: cells([0, 0, [cls('b-miss', 0.9, 0.9, 'light')]], [1, 0, [cls('p-flinch', 0.01, 0, 'shift')]]),
    }));
    expect(keys(screened.strands)).toEqual(['B0.0:b-miss']);
    const picked = pickStrands([screened], 6);
    expect(picked.map(s => s.classKey).sort()).toEqual(['b-miss', 'p-flinch']);
  });

  test('s5: the cap counts searches; a pair that no longer fits is skipped and the next strand tried', () => {
    const screened = screenStrands(input({
      verified: cells(
        [1, 0, [cls('p-a', 0.5, -0.2, 'light')]], [0, 0, [cls('b-a', 0.5, 0.5, 'light')]],
        [1, 1, [cls('p-b', 0.9, -0.5, 'shift')]],
      ),
    }));
    // Bounds: p-a 0.36, b-a 0.6*0.5*1.5=0.45, p-b 0.4*0.9*1.5=0.54. p-b goes first (alone, cost 1), then b-a with p-a (2).
    expect(pickStrands([screened], 3).map(s => s.classKey).sort()).toEqual(['b-a', 'p-a', 'p-b']);
    // Cap 2: p-b (1), then the pair b-a/p-a needs 2 and does not fit.
    expect(pickStrands([screened], 2).map(s => s.classKey)).toEqual(['p-b']);
    expect(pickStrands([screened], 0)).toEqual([]);
  });

  test('s5: heaviest bound first; a pair skipped for the cap lets a lighter lone strand through', () => {
    const screened = screenStrands({
      side: 'p1', values: [[0.5, 0.3, 0.4], [0, 0.1, 0.05]], oppMix: [0.4, 0.3, 0.3], played: 1, decided: false, trusted: never,
      verified: cells(
        [1, 0, [cls('p0', 0.9, -0.5, 'light')]], [0, 0, [cls('b0', 0.9, 0.5, 'light')]],
        [1, 1, [cls('p1', 0.9, -0.5, 'light')]], [0, 1, [cls('b1', 0.1, 0.5, 'light')]],
        [1, 2, [cls('p2', 0.6, -0.5, 'light')]],
      ),
    });
    expect(screened.d).toBeCloseTo(0.165, 12);
    // Column 0 pair (cost 2) first, the column 1 pair needs 2 more and is skipped, the lone column 2 strand fits.
    expect(pickStrands([screened], 3).map(s => s.classKey).sort()).toEqual(['b0', 'p0', 'p2']);
    expect(pickStrands([screened], 4).map(s => s.classKey).sort()).toEqual(['b0', 'b1', 'p0', 'p1']);
  });

  test('s5: the caps by game type are 6 singles and 4 doubles', () => {
    expect(STRAND_CAP_SINGLES).toBe(6);
    expect(STRAND_CAP_DOUBLES).toBe(4);
    expect(strandCap('singles')).toBe(6);
    expect(strandCap('doubles')).toBe(4);
  });

  test.each(GAME_TYPES)('s5: $name never picks more searches than its cap', ({ kind }) => {
    const classes = Array.from({ length: 12 }, (_, n) => cls(`k${n}`, 0.9, -0.9 + n * 0.01, 'shift'));
    const screened = screenStrands(input({ verified: cells([1, 0, classes]) }));
    expect(screened.strands.length).toBe(12);
    expect(pickStrands([screened], strandCap(kind))).toHaveLength(strandCap(kind));
  });

  test('s5: one search serves both sides when both screen the same cell and class', () => {
    // Cell (1, 1) is the played cell of both: p1 played row 1 into column 1, p2 played column 1 against row 1.
    const values = [[0.5, 0.5], [-0.6, 0]];
    const verified = cells([1, 1, [cls('shared', 0.9, -0.5, 'light')]]);
    const p1 = screenStrands({ side: 'p1', values, oppMix: [0, 1], played: 1, decided: false, trusted: never, verified });
    const p2 = screenStrands({ side: 'p2', values, oppMix: [0, 1], played: 1, decided: false, trusted: never, verified });
    expect(keys(p1.strands)).toEqual(['P1.1:shared']);
    expect(keys(p2.strands)).toEqual(['P1.1:shared']);
    const picked = pickStrands([p1, p2], 6);
    expect(picked).toHaveLength(1);
    expect(picked[0].uses.map(use => use.side).sort()).toEqual(['p1', 'p2']);
  });
});

describe('strandRegret (T322 block 2, stage 1)', () => {
  const screened = () => screenStrands(input({
    verified: cells([1, 0, [cls('p-flinch', 0.5, -0.2, 'light')]], [0, 0, [cls('b-miss', 0.5, 0.5, 'light')]]),
  }));

  test('s7: the searched values move evP and evB by y w (searched - before) with y held fixed', () => {
    const s = screened();
    const p = s.candidates.find(c => c.role === 'P')!;
    const b = s.candidates.find(c => c.role === 'B')!;
    const after = strandRegret(s, [{ strand: p, value: 0.6 }, { strand: b, value: 0.1 }]);
    expect(after.evP).toBeCloseTo(s.evP + 0.6 * 0.5 * 0.8, 12);
    expect(after.evB).toBeCloseTo(s.evB + 0.6 * 0.5 * (0.1 - 0.5), 12);
    expect(after.regret).toBeCloseTo(Math.max(after.evB, s.second) - after.evP, 12);
  });

  test('s7: a B row that falls below the second row stops the drop at the second row', () => {
    const s = screenStrands(input({
      values: [[0.5, 0.3], [0, 0.1], [0.3, 0.3]], oppMix: MIX,
      verified: cells([0, 0, [cls('b-miss', 0.9, 0.5, 'light')]]),
    }));
    expect(s.second).toBeCloseTo(0.3, 12);
    const b = s.candidates[0];
    const after = strandRegret(s, [{ strand: b, value: -1 }]);
    expect(after.evB).toBeLessThan(s.second);
    expect(after.regret).toBeCloseTo(0.3 - s.evP, 12);
  });

  test('s7: a strand that raises the regret reads r above r (a strand never sharpens in the grade, the caller keeps the lower)', () => {
    const s = screened();
    const p = s.candidates.find(c => c.role === 'P')!;
    expect(strandRegret(s, [{ strand: p, value: -0.9 }]).regret).toBeGreaterThan(s.r);
    expect(strandRegret(s, []).regret).toBeCloseTo(s.r, 12);
  });
});
