import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test, vi } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { getMainChoice } from '../src/branch/protocol-choices';
import { loadSimMods } from '../src/forward/sim-mods';
import { copyOf } from '../src/sim-ask/copy';
import { CHAMPIONS, mon, playClicks, RULES, sweepSelection, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules, type DexMove } from './dice-sweep-support';
import { battleOf } from './power-oracle';

// A plain run plays the whole bracket sweep; the Dex census of moves reads a fixed sample, `DICE_SWEEPS=full` all.
await loadSimMods('gen9championsou');
vi.setConfig({ testTimeout: 600_000 });

const summaries: string[] = [];
afterAll(() => {
  if (process.env.DICE_SWEEP_LOG) writeFileSync(process.env.DICE_SWEEP_LOG, summaries.join('\n') + '\n', 'utf8');
});

const AIMED = new Set(['normal']);
const CLICKABLE = new Set(['normal', 'self', 'all', 'allAdjacentFoes', 'allAdjacent', 'scripted']);

const CASES: { rules: Rules; mode: Mode; vgc: boolean; name: string }[] = RULES.flatMap(rules => [
  { rules, mode: 'singles' as const, vgc: false, name: `${rules.name} singles` },
  ...(rules.doubles ? [{ rules, mode: 'doubles' as const, vgc: false, name: `${rules.name} doubles` }] : []),
  ...(rules.doubles && rules.generation === 9 ? [{ rules, mode: 'doubles' as const, vgc: true, name: `${rules.name} VGC` }] : []),
]);

type Case = typeof CASES[number];

function boardOf(c: Case, moves: string[], foeMoves: string[], item = '', foeSpecies = 'Pikachu'): Battle {
  const splash = (species: string) => mon(c.rules, { species, moves: ['splash'] });
  const body = { ...mon(c.rules, { species: 'Snorlax', moves, gender: 'M' }), item };
  const foe = mon(c.rules, { species: foeSpecies, moves: foeMoves });
  const bench = c.vgc ? ['Pikachu', 'Chansey', 'Snorlax', 'Blissey'].map(splash) : [];
  const p1 = c.mode === 'singles' ? [body] : [body, splash('Blissey'), ...bench];
  const p2 = c.mode === 'singles' ? [foe] : [foe, splash('Vaporeon'), ...bench];
  return battleOf(c.mode === 'doubles' ? c.rules.doubles! : c.rules.singles, p1, p2);
}

const clickOf = (c: Case, target: string, aim: number): string =>
  c.mode === 'singles' ? 'move 1' : `move 1${AIMED.has(target) ? ` ${aim}` : ''}, move 1`;

function movedBefore(c: Case, bodyMove: string, foeMove: string, foeSpecies = 'Pikachu'): boolean {
  const board = boardOf(c, [bodyMove], [foeMove], '', foeSpecies);
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

// A move with an unmet condition (Belch) is disabled: the simulator refuses it as a click.
function accepted(c: Case, move: DexMove): boolean {
  const board = boardOf(c, [move.id], ['splash']);
  const probe = copyOf(board);
  probe.prng ??= board.prng.clone();
  return probe.choose('p1', clickOf(c, move.target, 1)) && probe.choose('p2', c.mode === 'singles' ? 'move 1' : 'move 1, move 1');
}

function bracketsOf(c: Case): Map<number, string> {
  const out = new Map<number, string>();
  for (const move of clickable(dexOfRules(c.rules))) {
    if (!out.has(move.priority) && accepted(c, move)) out.set(move.priority, move.id);
  }
  return out;
}

function standInOf(c: Case, body: string[], foeMove: string, item = ''): { id: string; choice: string } {
  const board = boardOf(c, body, [foeMove], item);
  const events = [`|move|p2a: Pikachu|${foeMove}|p1a: Snorlax`, ...(c.mode === 'doubles'
    ? ['|move|p1b: Blissey|Splash|p1b: Blissey', '|move|p2b: Vaporeon|Splash|p2b: Vaporeon'] : [])];
  const choice = getMainChoice(events, 'p1', board as never);
  const index = Number(/^move (\d+)/.exec(choice)![1]);
  return { id: board.sides[0].active[0].getMoveRequestData().moves[index - 1].id, choice };
}

function standInForEvents(c: Case, body: string[], events: string[], foeSpecies = 'Pikachu'): { id: string; choice: string } {
  const board = boardOf(c, body, ['splash'], '', foeSpecies);
  const choice = getMainChoice(events, 'p1', board as never);
  const index = Number(/^move (\d+)/.exec(choice)![1]);
  return { id: board.sides[0].active[0].getMoveRequestData().moves[index - 1].id, choice };
}

const CANT = '|cant|p1a: Snorlax|flinch';
const foeLine = (species: string, move: string): string => `|move|p2a: ${species}|${move}|p1a: Snorlax`;
const FOES = ['Pikachu', 'Shuckle'];

describe.each(CASES)('the stand-in for a slot the log never shows acting: $name', c => {
  const dex = dexOfRules(c.rules);
  const brackets = bracketsOf(c);
  const priorities = [...brackets.keys()].sort((a, b) => b - a);
  const rep = (priority: number): string => brackets.get(priority)!;
  const table = new Map<string, boolean>();
  const before = (bodyMove: string, foeMove: string, foeSpecies = 'Pikachu'): boolean => {
    const key = `${bodyMove}>${foeMove}>${foeSpecies}`;
    if (!table.has(key)) table.set(key, movedBefore(c, bodyMove, foeMove, foeSpecies));
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
      const slow = body.map(id => dex.moves.get(id).priority);
      for (const q of priorities) {
        const foeMove = rep(q);
        const stand = standInOf(c, body, foeMove);
        rows++;
        const expected = body.find(id => dex.moves.get(id).priority === Math.min(...slow))!;
        if (stand.id !== expected) problems.push(`${body.join(',')} against ${foeMove}: stand-in ${stand.id}, expected ${expected} (${stand.choice})`);
        const someBehind = body.some(id => !before(id, foeMove));
        if (someBehind && before(stand.id, foeMove)) problems.push(`${body.join(',')} against ${foeMove}: ${stand.id} moves before the foe, a move of the body would not`);
      }
    }
    summaries.push(`${c.name}: ${rows} rows over ${all.length} bodies`);
    expect(problems.slice(0, 12)).toEqual([]);
  });

  test('a body whose cant line stands before the foe\'s action takes the slowest move that stays ahead of it', () => {
    const problems: string[] = [];
    let rows = 0;
    let moved = 0;
    for (const body of bodies()) {
      const slow = body.map(id => dex.moves.get(id).priority);
      const slowest = body.find(id => dex.moves.get(id).priority === Math.min(...slow))!;
      for (const q of priorities) {
        const foeMove = rep(q);
        for (const species of FOES) {
          const stand = standInForEvents(c, body, [CANT, foeLine(species, foeMove)], species);
          const ahead = body.filter(id => before(id, foeMove, species));
          const expected = ahead.length > 0
            ? ahead.reduce((best, id) => dex.moves.get(id).priority < dex.moves.get(best).priority ? id : best)
            : slowest;
          rows++;
          if (expected !== slowest) moved++;
          if (stand.id !== expected) problems.push(`${body.join(',')} against ${species} ${foeMove}: stand-in ${stand.id}, expected ${expected} (${stand.choice})`);
          if (ahead.length > 0 && !before(stand.id, foeMove, species)) problems.push(`${body.join(',')} against ${species} ${foeMove}: ${stand.id} moves behind the foe, the cant line stands before it`);
        }
      }
    }
    summaries.push(`${c.name}: cant rows ${rows}, ${moved} differ from the slowest move`);
    expect(moved, 'the sweep has rows where the cant line moves the stand-in').toBeGreaterThan(0);
    expect(problems.slice(0, 12)).toEqual([]);
  });

  test('a cant line after the foe\'s action keeps the slowest stand-in, and so does a cant line with no action after it', () => {
    const problems: string[] = [];
    for (const body of bodies()) {
      const slow = body.map(id => dex.moves.get(id).priority);
      const slowest = body.find(id => dex.moves.get(id).priority === Math.min(...slow))!;
      for (const q of priorities) {
        const foeMove = rep(q);
        for (const species of FOES) {
          for (const events of [[foeLine(species, foeMove), CANT], [CANT]]) {
            const stand = standInForEvents(c, body, events, species);
            if (stand.id !== slowest) problems.push(`${body.join(',')} against ${species} ${foeMove}, ${events.length} lines: stand-in ${stand.id}, expected ${slowest}`);
          }
        }
      }
    }
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

  test.each(REPORTED)('a body of priority moves only takes the slowest of them ($name)', ({ c }) => {
    expect(standInOf(c, ['fakeout', 'protect', 'quickattack'], 'quickattack').id).toBe('quickattack');
  });

  test.each(REPORTED)('the lowest bracket wins over a tie at 0 ($name)', ({ c }) => {
    expect(standInOf(c, ['earthquake', 'avalanche', 'counter', 'protect'], 'earthquake').id).toBe('counter');
  });

  test.each(REPORTED)('the flinch stands before a Shadow Ball of a slower body: Trick Room is not the click ($name)', ({ c }) => {
    expect(standInForEvents(c, ['trickroom', 'earthquake'], [CANT, foeLine('Shuckle', 'Shadow Ball')], 'Shuckle').id).toBe('earthquake');
  });

  test.each(REPORTED)('the flinch stands before a Shadow Ball of a faster body: the slowest move with a higher priority ($name)', ({ c }) => {
    expect(standInForEvents(c, ['trickroom', 'earthquake', 'quickattack', 'protect'], [CANT, foeLine('Pikachu', 'Shadow Ball')]).id).toBe('quickattack');
  });

  test.each(REPORTED)('no move stays ahead of the faster body: the slowest move stays the click ($name)', ({ c }) => {
    expect(standInForEvents(c, ['trickroom', 'earthquake'], [CANT, foeLine('Pikachu', 'Shadow Ball')]).id).toBe('trickroom');
  });

  test.each(REPORTED)('the flinch stands after the Shadow Ball: the slowest move stays the click ($name)', ({ c }) => {
    expect(standInForEvents(c, ['trickroom', 'earthquake'], [foeLine('Shuckle', 'Shadow Ball'), CANT], 'Shuckle').id).toBe('trickroom');
  });

  test.each(REPORTED.filter(({ c }) => c.mode === 'doubles'))('an action before and one after the cant line: ahead of the second, behind the first ($name)', ({ c }) => {
    const first = '|move|p2b: Vaporeon|Splash|p2b: Vaporeon';
    expect(standInForEvents(c, ['trickroom', 'earthquake'], [first, CANT, foeLine('Shuckle', 'Shadow Ball')], 'Shuckle').id).toBe('earthquake');
    // Quick Attack gets ahead of Pikachu and of the Splash the log shows first: no move does both, the slowest stays.
    expect(standInForEvents(c, ['trickroom', 'earthquake', 'quickattack'], [first, CANT, foeLine('Pikachu', 'Shadow Ball')]).id).toBe('trickroom');
  });

  test.each(REPORTED)('an Assault Vest disables the status move at 0: the attack stands in ($name)', ({ c }) => {
    expect(standInOf(c, ['dragondance', 'protect', 'fakeout', 'earthquake'], 'quickattack', 'Assault Vest').id).toBe('earthquake');
  });
});
