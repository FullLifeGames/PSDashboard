import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test, vi } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { getMainChoice } from '../src/branch/protocol-choices';
import { loadSimMods } from '../src/forward/sim-mods';
import { copyOf } from '../src/sim-ask/copy';
import { CHAMPIONS, mon, playClicks, RULES, sweepSelection, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules, type DexMove } from './dice-sweep-support';
import { battleOf } from './power-oracle';

/**
 * Round 88 (T325, #61), lane D, step D3: the stand-in for a slot whose action the log never shows. The log of such a turn says the
 * body fainted before it moved or flinched, so the foe's action came first; the click that rebuilds the turn must keep that order.
 * The rebuild fills the click in with the enabled move of the lowest priority at 0 or below, else the first enabled move. The oracle
 * is the simulator, on a copy, in every rule set the corpus plays (Gens 1 to 9, the Champions mod), singles everywhere, doubles from
 * Gen 3, VGC (a team of six) in Scarlet/Violet and Champions:
 * - the Dex's priority brackets: each bracket of the rule set's own Dex gets a move the simulator takes as a click; the simulator
 *   plays every pair (the body's move, the faster foe's move) and the table must follow the Dex priority (a lower bracket moves
 *   after a higher one, a higher before, a tie goes to the faster foe), the rule the stand-in reads;
 * - the bodies: every body of one move per bracket, in pairs of brackets with the highest and the lowest bracket behind them, and the
 *   bodies of positive brackets only, in both orders, get a stand-in; against every foe bracket the stand-in moves behind the foe
 *   whenever any move of the body would (a body with no move at 0 or below keeps its first move), and it is the lowest bracket at 0 or
 *   below, else the body's first move;
 * - the reported rows: Fake Out and Protect filled in for a body that never acted, the Assault Vest that disables the status moves.
 * A plain run plays the whole bracket sweep; the Dex census of every move reads a fixed sample, `DICE_SWEEPS=full` every move.
 */
await loadSimMods('gen9championsou');
vi.setConfig({ testTimeout: 600_000 });

const summaries: string[] = [];
afterAll(() => {
  if (process.env.DICE_SWEEP_LOG) writeFileSync(process.env.DICE_SWEEP_LOG, summaries.join('\n') + '\n', 'utf8');
});

/** The targets whose click needs no more than `move N` (or `move N 1` at a foe in doubles) and whose move the simulator announces. */
const AIMED = new Set(['normal']);
const CLICKABLE = new Set(['normal', 'self', 'all', 'allAdjacentFoes', 'allAdjacent', 'scripted']);

const CASES: { rules: Rules; mode: Mode; vgc: boolean; name: string }[] = RULES.flatMap(rules => [
  { rules, mode: 'singles' as const, vgc: false, name: `${rules.name} singles` },
  ...(rules.doubles ? [{ rules, mode: 'doubles' as const, vgc: false, name: `${rules.name} doubles` }] : []),
  ...(rules.doubles && rules.generation === 9 ? [{ rules, mode: 'doubles' as const, vgc: true, name: `${rules.name} VGC` }] : []),
]);

type Case = typeof CASES[number];

/** The board: the body (Snorlax) with `moves` against the faster foe (Pikachu) with `foeMoves`; doubles add two splashers, VGC a bench of four per side. */
function boardOf(c: Case, moves: string[], foeMoves: string[], item = ''): Battle {
  const splash = (species: string) => mon(c.rules, { species, moves: ['splash'] });
  const body = { ...mon(c.rules, { species: 'Snorlax', moves, gender: 'M' }), item };
  const foe = mon(c.rules, { species: 'Pikachu', moves: foeMoves });
  const bench = c.vgc ? ['Pikachu', 'Chansey', 'Snorlax', 'Blissey'].map(splash) : [];
  const p1 = c.mode === 'singles' ? [body] : [body, splash('Blissey'), ...bench];
  const p2 = c.mode === 'singles' ? [foe] : [foe, splash('Vaporeon'), ...bench];
  return battleOf(c.mode === 'doubles' ? c.rules.doubles! : c.rules.singles, p1, p2);
}

const clickOf = (c: Case, target: string, aim: number): string =>
  c.mode === 'singles' ? 'move 1' : `move 1${AIMED.has(target) ? ` ${aim}` : ''}, move 1`;

/** Whether the body's action line (its move, or the `|cant|` that stops it) stands before the foe's in the log of one turn, on a copy. */
function movedBefore(c: Case, bodyMove: string, foeMove: string): boolean {
  const board = boardOf(c, [bodyMove], [foeMove]);
  const copy = copyOf(board);
  copy.prng ??= board.prng.clone();
  const start = copy.log.length;
  const dex = board.dex;
  playClicks(copy, { p1: clickOf(c, dex.moves.get(bodyMove).target, 1), p2: clickOf(c, dex.moves.get(foeMove).target, 1) });
  const lines = copy.log.slice(start);
  const own = lines.findIndex(line => /^\|(move|cant)\|p1a/.test(line));
  const foe = lines.findIndex(line => /^\|(move|cant)\|p2a/.test(line));
  return own >= 0 && (foe < 0 || own < foe);
}

const clickable = (dex: ReturnType<typeof dexOfRules>): DexMove[] => dex.moves.all().filter((move: DexMove) => move.exists && !move.isZ && !move.isMax
  && move.gen <= dex.gen && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past')
  && CLICKABLE.has(move.target) && !move.flags.charge && !move.flags.futuremove);

/** Whether the simulator takes the move as the body's click (a move with a condition that is not met, Belch, is disabled). */
function accepted(c: Case, move: DexMove): boolean {
  const board = boardOf(c, [move.id], ['splash']);
  const probe = copyOf(board);
  probe.prng ??= board.prng.clone();
  return probe.choose('p1', clickOf(c, move.target, 1)) && probe.choose('p2', c.mode === 'singles' ? 'move 1' : 'move 1, move 1');
}

/** The first move of each Dex priority bracket of a rule set that the simulator takes as a click. */
function bracketsOf(c: Case): Map<number, string> {
  const out = new Map<number, string>();
  for (const move of clickable(dexOfRules(c.rules))) {
    if (!out.has(move.priority) && accepted(c, move)) out.set(move.priority, move.id);
  }
  return out;
}

/** The stand-in's move id for a body that never shows in the log: the first fragment of the side's choice. */
function standInOf(c: Case, body: string[], foeMove: string, item = ''): { id: string; choice: string } {
  const board = boardOf(c, body, [foeMove], item);
  const events = [`|move|p2a: Pikachu|${foeMove}|p1a: Snorlax`, ...(c.mode === 'doubles'
    ? ['|move|p1b: Blissey|Splash|p1b: Blissey', '|move|p2b: Vaporeon|Splash|p2b: Vaporeon'] : [])];
  const choice = getMainChoice(events, 'p1', board as never);
  const index = Number(/^move (\d+)/.exec(choice)![1]);
  return { id: board.sides[0].active[0].getMoveRequestData().moves[index - 1].id, choice };
}

describe.each(CASES)('the stand-in for a slot the log never shows acting: $name', c => {
  const dex = dexOfRules(c.rules);
  const brackets = bracketsOf(c);
  const priorities = [...brackets.keys()].sort((a, b) => b - a);
  const rep = (priority: number): string => brackets.get(priority)!;
  const table = new Map<string, boolean>();
  const before = (bodyMove: string, foeMove: string): boolean => {
    const key = `${bodyMove}>${foeMove}`;
    if (!table.has(key)) table.set(key, movedBefore(c, bodyMove, foeMove));
    return table.get(key)!;
  };
  const bodies = (): string[][] => {
    const hi = rep(priorities[0]);
    const lo = rep(priorities[priorities.length - 1]);
    const out: string[][] = priorities.map(p => [rep(p)]);
    for (const p of priorities) {
      for (const r of priorities) if (p !== r) out.push([...new Set([rep(p), rep(r), hi, lo])]);
    }
    const positives = priorities.filter(p => p > 0).map(rep).slice(0, 4);
    if (positives.length > 1) out.push(positives, [...positives].reverse());
    return out;
  };

  test('the Dex has the brackets the stand-in reads', () => {
    expect(priorities).toContain(0);
    expect(priorities.some(p => p < 0), 'a bracket below 0').toBe(true);
    expect(priorities.some(p => p > 0), 'a bracket above 0').toBe(true);
    summaries.push(`${c.name}: brackets ${priorities.map(p => `${p}:${rep(p)}`).join(' ')}`);
  });

  test('the simulator orders a pair of moves as the Dex priority says (the foe is faster)', () => {
    const wrong: string[] = [];
    for (const p of priorities) {
      for (const q of priorities) {
        const got = before(rep(p), rep(q));
        // the faster foe moves first at the same bracket, so the body moves first only at a higher bracket
        if (got !== p > q) wrong.push(`${rep(p)} (${p}) against ${rep(q)} (${q}): the body moves first = ${got}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test('every body gets a stand-in that moves behind the foe whenever any of its moves would', () => {
    const problems: string[] = [];
    let rows = 0;
    const all = bodies();
    for (const body of all) {
      const slow = body.map(id => dex.moves.get(id).priority).filter(p => p <= 0);
      for (const q of priorities) {
        const foeMove = rep(q);
        const stand = standInOf(c, body, foeMove);
        rows++;
        const expected = slow.length > 0 ? body.find(id => dex.moves.get(id).priority === Math.min(...slow))! : body[0];
        if (stand.id !== expected) problems.push(`${body.join(',')} against ${foeMove}: stand-in ${stand.id}, expected ${expected} (${stand.choice})`);
        // a body with no move at 0 or below keeps its first move (the plan's fallback), so only a body with one holds the order
        const someBehind = slow.length > 0 && body.some(id => !before(id, foeMove));
        if (someBehind && before(stand.id, foeMove)) problems.push(`${body.join(',')} against ${foeMove}: ${stand.id} moves before the foe, a move of the body would not`);
      }
    }
    summaries.push(`${c.name}: ${rows} rows over ${all.length} bodies`);
    expect(problems.slice(0, 12)).toEqual([]);
  });

  test('the Dex census: every move of the rule set follows its bracket against the brackets', () => {
    const wrong: string[] = [];
    for (const move of sweepSelection(clickable(dex), 'moves')) {
      if (!accepted(c, move)) continue;
      for (const q of priorities) {
        const got = before(move.id, rep(q));
        if (got !== move.priority > q) wrong.push(`${move.id} (${move.priority}) against ${rep(q)} (${q}): the body moves first = ${got}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('the reported rows', () => {
  const GEN9 = RULES.find(rules => rules.generation === 9 && rules !== CHAMPIONS)!;
  const REPORTED: { name: string; c: Case }[] = [
    { name: 'singles', c: { rules: GEN9, mode: 'singles', vgc: false, name: 'singles' } },
    { name: 'doubles', c: { rules: GEN9, mode: 'doubles', vgc: false, name: 'doubles' } },
    { name: 'VGC', c: { rules: GEN9, mode: 'doubles', vgc: true, name: 'VGC' } },
    { name: 'Champions VGC', c: { rules: CHAMPIONS, mode: 'doubles', vgc: true, name: 'Champions VGC' } },
  ];

  test.each(REPORTED)('Fake Out first: the priority move is not the click ($name)', ({ c }) => {
    expect(standInOf(c, ['fakeout', 'quickattack', 'protect', 'dragondance'], 'quickattack').id).toBe('dragondance');
  });

  test.each(REPORTED)('Protect and Shadow Sneak before a move of priority 0: the first of those ($name)', ({ c }) => {
    expect(standInOf(c, ['shadowsneak', 'protect', 'earthquake', 'uturn'], 'shadowsneak').id).toBe('earthquake');
  });

  test.each(REPORTED)('a body of priority moves only keeps its first move ($name)', ({ c }) => {
    expect(standInOf(c, ['fakeout', 'protect', 'quickattack'], 'quickattack').id).toBe('fakeout');
  });

  test.each(REPORTED)('the lowest bracket wins over a tie at 0 ($name)', ({ c }) => {
    expect(standInOf(c, ['earthquake', 'avalanche', 'counter', 'protect'], 'earthquake').id).toBe('counter');
  });

  test.each(REPORTED)('an Assault Vest disables the status move at 0: the attack stands in ($name)', ({ c }) => {
    expect(standInOf(c, ['dragondance', 'protect', 'fakeout', 'earthquake'], 'quickattack', 'Assault Vest').id).toBe('earthquake');
  });
});
