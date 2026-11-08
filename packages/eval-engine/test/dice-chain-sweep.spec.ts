import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { RecordingPRNG } from '../src/dice/prng';
import { reportOf } from '../src/dice/report';
import type { ForcedDie } from '../src/dice/types';
import { watchBattle } from '../src/dice/watch';
import { copyOf } from '../src/sim-ask/copy';
import { playClicks, RULES, seedOf, sweepSelection, type Mode, type Rules } from './dice-fixtures';
import {
  clicksAccepted, dexOfRules, dieOf, forcedOn, missesOf, outfitBoard, sweepBoard, sweepClicks, sweepMoves, SWEEP_CASES, VGC_RULES,
  type DexMove,
} from './dice-sweep-support';

// Round 88 (T337, #73): a move whose every hit rolls its own accuracy (the Dex flag `multiaccuracy`: Triple Axel, Triple Kick,
// Population Bomb) draws one accuracy die per hit, and the log shows only the hits that landed (`|-hitcount|`), never a miss for a
// later hit. The accuracy die of a later hit carries `hit`, the simulator's own `move.hit` (2 and up); the first hit keeps its name.
// For every such move in every rule set the corpus plays (Gens 1 and 2 have none: the Gen 2 mod clears the flag), singles, doubles
// and VGC (a team of six): (a) the Dex rows, (b) the natural turn on a copy names each later hit the log shows and the hit that
// broke the chain, (c) a forced hit die overrides its hit and a forced plain die still covers every hit, (d) Skill Link and Loaded
// Dice delete the flag, so no hit die is named or drawn. Only accuracy carries a hit this round (crit and roll per hit are T332).
await loadSimMods('gen9championsou');

const FAST = 'Pikachu';
const multiAccuracy = (move: DexMove): boolean => !!(move as unknown as { multiaccuracy?: boolean }).multiaccuracy;
const multihitOf = (move: DexMove): number | number[] | undefined => (move as unknown as { multihit?: number | number[] }).multihit;
const hitsOf = (move: DexMove): number => {
  const hits = multihitOf(move);
  if (typeof hits !== 'number') throw new Error(`${move.id}: a multi-accuracy move with no fixed hit count (${JSON.stringify(hits)})`);
  return hits;
};

const CASES: { rules: Rules; mode: Mode; vgc: boolean; name: string }[] = [
  ...SWEEP_CASES.map(entry => ({ ...entry, vgc: false })),
  ...VGC_RULES.map(rules => ({ rules, mode: 'doubles' as const, vgc: true, name: `${rules.name} VGC` })),
];

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const hitOfKey = (key: string): number | null => {
  const found = /:hit(\d+)$/.exec(key);
  return found ? Number(found[1]) : null;
};
/** The turn's lines without the clock stamp (`|t:|`), which two plays of one turn never share. */
const untimed = (line: string): boolean => !line.startsWith('|t:|');
const kindOfKey = (key: string): string => key.split(':')[3];

/** The numbers of the `|-hitcount|` lines of a turn. */
const hitcounts = (lines: readonly string[]): number[] => lines.filter(line => line.startsWith('|-hitcount|')).map(line => Number(line.split('|')[3]));

/** The natural turn on a copy: the keys of the dice the user's move drew, and the turn's lines. */
function naturalTurn(board: ReturnType<typeof sweepBoard>, clicks: { p1: string; p2: string }, moveId: string): { keys: string[]; lines: string[] } {
  const copy = copyOf(board);
  copy.prng ??= board.prng.clone();
  const start = copy.log.length;
  const watch = watchBattle(copy);
  const recording = new RecordingPRNG(copy.prng, watch);
  copy.prng = recording;
  try {
    playClicks(copy, clicks);
  } finally {
    watch.uninstall();
  }
  return { keys: [...recording.record.keys()].filter(key => key.startsWith(`p1a:${moveId}:`)), lines: copy.log.slice(start) };
}

const yes = (move: string): ForcedDie => ({ name: dieOf(move, 'p2a', 'accuracy'), result: { happens: true } });
const hitDie = (move: string, hit: number, happens: boolean): ForcedDie => ({ name: { ...dieOf(move, 'p2a', 'accuracy'), hit }, result: { happens } });

const SEEDS = Array.from({ length: 60 }, (_, index) => seedOf(index + 1));
const census = { moves: 0, seeds: 0, broken: 0, full: 0, missedFirst: 0, controls: 0 };

describe('the Dex rows', () => {
  test.each(RULES.map(rules => [rules.name, rules] as const))('%s', (_name, rules) => {
    const { moves } = sweepMoves(rules, multiAccuracy);
    // Gens 1 and 2 have no such move (the Gen 2 mod clears Triple Kick's flag); every later rule set has one
    if (rules.generation <= 2) expect(moves.map(move => move.id)).toEqual([]);
    else expect(moves.length).toBeGreaterThan(0);
  });
});

describe.each(CASES.filter(entry => entry.rules.generation >= 3))('the accuracy die of each hit: $name', ({ rules, mode, vgc, name }) => {
  const { moves } = sweepMoves(rules, multiAccuracy);
  const clicksOf = (move: DexMove) => sweepClicks(mode, move.target);
  const boardOf = (move: DexMove, seed = '1,2,3,4') => sweepBoard(rules, move.id, mode, seed, vgc, FAST);

  test('the natural turn names each later hit the log shows and the hit that broke the chain', () => {
    for (const move of moves) {
      const hits = hitsOf(move);
      let broken = 0, full = 0, missedFirst = 0, played = 0;
      for (const seed of sweepSelection(SEEDS, 'pool')) {
        const board = boardOf(move, seed);
        if (!clicksAccepted(board, clicksOf(move))) break;
        const { keys, lines } = naturalTurn(board, clicksOf(move), move.id);
        const k = hitcounts(lines)[0] ?? 0;
        const accuracies = keys.filter(key => kindOfKey(key) === 'accuracy' && key.includes(':p2a:'));
        const named = accuracies.map(hitOfKey).filter((hit): hit is number => hit !== null).sort((a, b) => a - b);
        const fainted = lines.some(line => /^\|faint\|p2a/.test(line));
        // the first hit keeps its plain name; hits 2..k landed; the next hit drew its roll and missed unless the foe was gone
        const expected = k === 0 ? [] : [...Array.from({ length: k - 1 }, (_, index) => index + 2), ...(k < hits && !fainted ? [k + 1] : [])];
        expect(named, `${move.id} seed ${seed}: the log shows ${k} of ${hits} hits`).toEqual(expected);
        expect(keys.filter(key => hitOfKey(key) !== null && kindOfKey(key) !== 'accuracy'), `${move.id} seed ${seed}: only accuracy carries a hit`).toEqual([]);
        expect(Math.max(0, ...named), `${move.id} seed ${seed}`).toBeLessThanOrEqual(hits);
        if (k === 0) missedFirst++;
        else if (k < hits) broken++;
        else full++;
        played++;
      }
      census.moves++;
      census.seeds += played;
      census.broken += broken;
      census.full += full;
      census.missedFirst += missedFirst;
      summaries.push(`${name} ${move.id}: ${played} seeds, ${full} full, ${broken} broken, ${missedFirst} missed first`);
      expect(broken, `${move.id}: no seed broke the chain`).toBeGreaterThan(0);
    }
  });

  test('a multi-hit move without the flag never names a hit', () => {
    const { moves: controls } = sweepMoves(rules, move => multihitOf(move) !== undefined && !multiAccuracy(move) && move.category !== 'Status');
    for (const move of controls) {
      const board = boardOf(move);
      if (!clicksAccepted(board, clicksOf(move))) continue;
      for (const seed of sweepSelection(SEEDS, 'seeds')) {
        const { keys } = naturalTurn(boardOf(move, seed), clicksOf(move), move.id);
        expect(keys.filter(key => hitOfKey(key) !== null), `${move.id} seed ${seed}`).toEqual([]);
      }
      census.controls++;
    }
  });

  test('a forced hit die overrides its hit, a forced plain die covers every hit, a plain miss draws no hit', () => {
    for (const move of moves) {
      const hits = hitsOf(move);
      const board = boardOf(move);
      const clicks = clicksOf(move);
      if (!clicksAccepted(board, clicks)) continue;
      const alone = forcedOn(board, clicks, [yes(move.id)]);
      expect(hitcounts(alone.battle.log.slice(alone.start)), `${move.id}: a plain yes covers every hit`).toEqual([hits]);
      for (let hit = 2; hit <= hits; hit++) {
        const broken = forcedOn(board, clicks, [yes(move.id), hitDie(move.id, hit, false)]);
        const lines = broken.battle.log.slice(broken.start);
        expect(hitcounts(lines), `${move.id}: hit ${hit} forced to miss`).toEqual([hit - 1]);
        expect(missesOf(broken.battle, broken.start, 'p2a'), `${move.id}: a later miss writes no |-miss|`).toBe(0);
        expect(broken.report.forced[0].took, `${move.id} hit ${hit}: ${broken.report.forced[0].reason}`).toBe('applied');
        // the report reads the hit count: the die of the hit that missed is applied, a later hit of the chain was never rolled
        expect(broken.report.forced[1].took, `${move.id} hit ${hit}: ${broken.report.forced[1].reason}`).toBe('applied');
        if (hit < hits) {
          const later = forcedOn(board, clicks, [yes(move.id), hitDie(move.id, hit, false), hitDie(move.id, hit + 1, true)]);
          expect(later.report.forced[2].took, `${move.id} hit ${hit + 1}`).toBe('no-draw');
          expect(later.report.forced[2].reason, `${move.id} hit ${hit + 1}`).toMatch(new RegExp(`ended after ${hit - 1} hits?.*hit ${hit + 1}`));
        }
      }
      const every = forcedOn(board, clicks, [yes(move.id), ...Array.from({ length: hits - 1 }, (_, index) => hitDie(move.id, index + 2, true))]);
      expect(hitcounts(every.battle.log.slice(every.start)), `${move.id}: every hit forced to land`).toEqual([hits]);
      expect(every.report.forced.map(report => report.took), `${move.id}: every hit forced to land`).toEqual(Array(hits).fill('applied'));
      // a hit die alone leaves the first hit to the stream: it never moves a hit before it
      const first = forcedOn(board, clicks, [hitDie(move.id, 2, false)]);
      const counts = hitcounts(first.battle.log.slice(first.start));
      expect(first.report.forced[0].took === 'no-draw' ? counts.length === 0 : counts.length === 1 && counts[0] === 1, `${move.id}: a lone hit die`).toBe(true);
      // a plain miss draws no later hit: the hit die is never drawn
      const no = forcedOn(board, clicks, [{ ...yes(move.id), result: { happens: false } }, hitDie(move.id, 2, true)]);
      expect(missesOf(no.battle, no.start, 'p2a'), `${move.id}: a plain no`).toBeGreaterThan(0);
      expect(hitcounts(no.battle.log.slice(no.start)), `${move.id}: a plain no`).toEqual([]);
      expect(no.report.forced[1].took, `${move.id}: ${no.report.forced[1].reason}`).toBe('no-draw');
      expect(no.report.forced[1].reason, `${move.id}: the first hit missed`).toMatch(/-miss/);
    }
  });

  test.each([
    ['abilities', 'skilllink', 'Skill Link'],
    ['items', 'loadeddice', 'Loaded Dice'],
  ] as const)('%s: %s deletes the flag, so no hit die is named or drawn', (kind, id, label) => {
    const entry = dexOfRules(rules)[kind].get(id);
    if (!entry.exists || entry.gen > dexOfRules(rules).gen || entry.isNonstandard) return;
    for (const move of moves.slice(0, 2)) {
      const board = outfitBoard(rules, mode, { species: FAST, moves: [move.id], ...(kind === 'abilities' ? { ability: label } : { item: label }) }, { species: 'Vaporeon' });
      const clicks = clicksOf(move);
      if (!clicksAccepted(board, clicks)) continue;
      const natural = naturalTurn(board, clicks, move.id);
      expect(natural.keys.filter(key => hitOfKey(key) !== null), `${move.id} with ${label}`).toEqual([]);
      const forced = forcedOn(board, clicks, [hitDie(move.id, 2, false)]);
      expect(forced.report.forced[0].took, `${move.id} with ${label}: ${forced.report.forced[0].reason}`).toBe('no-draw');
      expect(forced.report.forced[0].reason, `${move.id} with ${label}`).toMatch(/rolls no accuracy for hit 2/);
      expect(forced.battle.log.slice(forced.start).filter(untimed), `${move.id} with ${label}: the log is the natural turn's`).toEqual(natural.lines.filter(untimed));
    }
  });
});

describe('the report of a hit die reads the hit count of its target', () => {
  const board = sweepBoard(RULES[9], 'tripleaxel', 'singles', '1,2,3,4', false, FAST);
  const report = (hit: number, happens: boolean, lines: string[]) => reportOf({
    die: hitDie('tripleaxel', hit, happens), note: { draws: 1, noChance: false, shapes: [], logIndex: 1 },
    battle: { log: ['|move|p1a: Pikachu|Triple Axel|p2a: Vaporeon', ...lines], dex: board.dex } as unknown as typeof board, start: 0,
  });
  const damage = '|-damage|p2a: Vaporeon|80/100';

  test.each([
    ['a no at the hit the chain ended on is applied', 2, false, '|-hitcount|p2a: Vaporeon|1', 'applied'],
    ['a no at a hit that landed is no chance', 2, false, '|-hitcount|p2a: Vaporeon|2', 'no-chance'],
    ['a yes at a hit that landed is applied', 2, true, '|-hitcount|p2a: Vaporeon|3', 'applied'],
    ['a yes at a hit the chain never reached is blocked', 3, true, '|-hitcount|p2a: Vaporeon|1', 'blocked'],
  ] as const)('%s', (_name, hit, happens, count, took) => {
    const shown = report(hit, happens, [damage, count]);
    expect(shown.took, shown.reason).toBe(took);
    if (took === 'blocked' || took === 'no-chance') expect(shown.reason).toMatch(new RegExp(`hit ${hit}`));
  });
});

describe('the sweep exercised the moves', () => {
  test('every case played a chain, a broken chain and a control', () => {
    expect(census.moves).toBeGreaterThan(0);
    expect(census.broken).toBeGreaterThan(0);
    expect(census.full).toBeGreaterThan(0);
    expect(census.controls).toBeGreaterThan(0);
  });
});
