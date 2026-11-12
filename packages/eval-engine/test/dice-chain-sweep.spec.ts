import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { chainCount, chainDice, chainResults, hitsIn } from '../src/dice/chain';
import type { LoggedAction } from '../src/dice/logged-results';
import { offeredDice } from '../src/dice/offer';
import { RecordingPRNG } from '../src/dice/prng';
import { reportOf } from '../src/dice/report';
import { dieKey, type ForcedDie } from '../src/dice/types';
import { watchBattle } from '../src/dice/watch';
import { copyOf } from '../src/sim-ask/copy';
import { CHAMPIONS, playClicks, RULES, seedOf, standing, sweepSelection, type Mode, type Rules } from './dice-fixtures';
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

// Round 89 (#114): the offer names the accuracy die of each later hit, so the panel can offer a chip for it. Read from the move after
// `ModifyMove` (Skill Link and Loaded Dice have deleted the flag by then), from the Dex's own `multiaccuracy` and `multihit`.
describe.each(CASES.filter(entry => entry.rules.generation >= 3))('the offer names a die per hit: $name', ({ rules, mode, vgc }) => {
  const { moves } = sweepMoves(rules, multiAccuracy);
  const choiceOf = (move: DexMove) => ({ kind: 'move' as const, moveId: move.id, moveName: move.name, ...(mode === 'doubles' ? { targetLoc: 1 } : {}) });
  const hitKeysOf = (offers: ReturnType<typeof offeredDice>): string[] => offers.filter(offer => offer.name.hit !== undefined).map(offer => dieKey(offer.name));
  const wanted = (move: DexMove): string[] => Array.from({ length: hitsOf(move) - 1 }, (_, index) => dieKey({ ...dieOf(move.id, 'p2a', 'accuracy'), hit: index + 2 }));
  const has = (kind: 'items' | 'abilities', id: string): boolean => {
    const entry = dexOfRules(rules)[kind].get(id);
    return entry.exists && entry.gen <= dexOfRules(rules).gen && !entry.isNonstandard;
  };

  test('the hits 2 to N of the move are offered as the natural turn draws them, and every one, forced, is drawn', () => {
    for (const move of moves) {
      const board = sweepBoard(rules, move.id, mode, '1,2,3,4', vgc, FAST);
      const clicks = sweepClicks(mode, move.target);
      if (!clicksAccepted(board, clicks)) continue;
      const before = standing(board);
      const offers = offeredDice(board, 'p1a', choiceOf(move));
      expect(standing(board), `${move.id}: the offer leaves the battle as it was`).toBe(before);
      const offered = hitKeysOf(offers);
      expect(offered, `${move.id}: one die per later hit, on the aimed foe`).toEqual(wanted(move));
      expect(offers.filter(offer => offer.name.kind === 'accuracy' && offer.name.hit === undefined).map(offer => dieKey(offer.name)), move.id).toEqual([dieKey(dieOf(move.id, 'p2a', 'accuracy'))]);
      // forced to land, the natural turn draws exactly the hits the offer names
      const forced: ForcedDie[] = [yes(move.id), ...offers.filter(offer => offer.name.hit !== undefined).map(offer => ({ name: offer.name, result: { happens: true } }))];
      const { report, battle, start } = forcedOn(board, clicks, forced);
      expect(report.forced.map(shown => shown.took), `${move.id}: every offered hit is drawn`).toEqual(Array(hitsOf(move)).fill('applied'));
      expect(hitcounts(battle.log.slice(start)), move.id).toEqual([hitsOf(move)]);
    }
  });

  test.each([
    ['abilities', 'skilllink', 'Skill Link'],
    ['items', 'loadeddice', 'Loaded Dice'],
  ] as const)('%s: %s deletes the flag, so no hit die is offered', (kind, id, label) => {
    if (!has(kind, id)) return;
    for (const move of moves.slice(0, 2)) {
      const board = outfitBoard(rules, mode, { species: FAST, moves: [move.id], ...(kind === 'abilities' ? { ability: label } : { item: label }) }, { species: 'Vaporeon' });
      if (!clicksAccepted(board, sweepClicks(mode, move.target))) continue;
      const offers = offeredDice(board, 'p1a', choiceOf(move));
      expect(hitKeysOf(offers), `${move.id} with ${label}`).toEqual([]);
      expect(offers.some(offer => offer.name.kind === 'accuracy'), `${move.id} with ${label}: the plain die stays`).toBe(true);
    }
  });

  test('a Parental Bond holder with a one-hit move is offered no hit die', () => {
    if (!has('abilities', 'parentalbond')) return;
    const board = outfitBoard(rules, mode, { species: FAST, moves: ['tackle'], ability: 'Parental Bond' }, { species: 'Vaporeon' });
    expect(hitKeysOf(offeredDice(board, 'p1a', { kind: 'move', moveId: 'tackle', moveName: 'Tackle', ...(mode === 'doubles' ? { targetLoc: 1 } : {}) }))).toEqual([]);
  });

  test('a multi-hit move without the flag is offered no hit die', () => {
    const { moves: controls } = sweepMoves(rules, move => multihitOf(move) !== undefined && !multiAccuracy(move) && move.category !== 'Status');
    for (const move of controls) {
      const board = boardOf(move);
      if (!clicksAccepted(board, clicksOf(move))) continue;
      expect(hitKeysOf(offeredDice(board, 'p1a', choiceOf(move))), move.id).toEqual([]);
    }
  });

  function boardOf(move: DexMove) { return sweepBoard(rules, move.id, mode, '1,2,3,4', vgc, FAST); }
  function clicksOf(move: DexMove) { return sweepClicks(mode, move.target); }
});

// Round 89 (#114), Champions OU 2692379905 turn 2: Meowscarada's Triple Axel hit Garchomp twice and the third hit missed. The panel
// can set that hit: the offer names it, and forcing it plays the hit the game never rolled.
describe('the scene of Champions OU 2692379905 turn 2: the third hit of Triple Axel', () => {
  const board = () => outfitBoard(CHAMPIONS, 'singles', { species: 'Meowscarada', moves: ['tripleaxel'], ability: 'Protean' }, { species: 'Garchomp', ability: 'Rough Skin', item: 'Rocky Helmet' });
  const clicks = { p1: 'move 1', p2: 'move 1' };
  const axel = { kind: 'move' as const, moveId: 'tripleaxel', moveName: 'Triple Axel' };

  test('the offer holds the plain die and the dice of hits 2 and 3', () => {
    const keys = offeredDice(board(), 'p1a', axel).filter(offer => offer.name.kind === 'accuracy').map(offer => dieKey(offer.name));
    expect(keys).toEqual(['p1a:tripleaxel:p2a:accuracy', 'p1a:tripleaxel:p2a:accuracy:hit2', 'p1a:tripleaxel:p2a:accuracy:hit3']);
  });

  test.each([[true, 3], [false, 2]] as const)('hit 3 forced to %s plays %i hits', (happens, count) => {
    const turn = forcedOn(board(), clicks, [yes('tripleaxel'), hitDie('tripleaxel', 2, true), hitDie('tripleaxel', 3, happens)]);
    expect(hitcounts(turn.battle.log.slice(turn.start))).toEqual([count]);
    // the third hit takes the last of Garchomp's HP
    expect(turn.battle.log.slice(turn.start).some(line => line.startsWith('|faint|p2a')), 'Garchomp faints on hit 3 only').toBe(happens);
  });
});

// Round 89 (#114, F2): the chain rule lives in `chain.ts` once. A count of k landed hits stands for hits 2 to k landing and, when the
// move has a hit k + 1, that hit missing; `chainCount` reads the count back from the per-hit results (the panel's fold, F3).
describe.each(RULES.filter(rules => rules.generation >= 3).map(rules => [rules.name, rules] as const))('the chain rule: %s', (_name, rules) => {
  const { moves } = sweepMoves(rules, multiAccuracy);
  const action = (moveId: string, count: number): LoggedAction => ({ slot: 'p1a', moveId, hitCounts: { p2a: count } }) as unknown as LoggedAction;
  const hitsOfMove = hitsIn(dexOfRules(rules));

  test('chainDice builds on chainResults, for every count of every multi-accuracy move', () => {
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      const hits = hitsOf(move);
      expect(hitsOfMove(move.id), move.id).toBe(hits);
      for (let count = 1; count <= hits; count++) {
        const dice = chainDice(action(move.id, count), 'p2a', ['p2a'], hitsOfMove);
        expect(dice.map(die => ({ hit: die.name.hit, happens: 'happens' in die.result && die.result.happens })), `${move.id} count ${count}`).toEqual(chainResults(count, hits));
        expect(dice.every(die => die.name.moveId === move.id && die.name.kind === 'accuracy' && die.name.targetSlot === 'p2a'), move.id).toBe(true);
      }
    }
  });

  test('chainCount is the inverse of chainResults', () => {
    for (const move of moves) {
      const hits = hitsOf(move);
      for (let count = 1; count <= hits; count++) expect(chainCount(chainResults(count, hits)), `${move.id} count ${count}`).toBe(count);
    }
  });
});

describe('the chain rule on its own', () => {
  test('chainResults: hits 2 to the count land, the next hit misses, a full chain has no miss', () => {
    expect(chainResults(1, 3)).toEqual([{ hit: 2, happens: false }]);
    expect(chainResults(2, 3)).toEqual([{ hit: 2, happens: true }, { hit: 3, happens: false }]);
    expect(chainResults(3, 3)).toEqual([{ hit: 2, happens: true }, { hit: 3, happens: true }]);
    expect(chainResults(10, 10)).toHaveLength(9);
    expect(chainResults(1, 1)).toEqual([]);
  });

  test('chainResults caps a count above the hits and gives nothing for a count below one', () => {
    expect(chainResults(5, 3)).toEqual(chainResults(3, 3));
    expect(chainResults(0, 3)).toEqual([]);
    expect(chainResults(Number.NaN, 3)).toEqual([]);
  });

  test('chainCount reads a partial list: the hits that landed in a row from hit 2, the rest unset', () => {
    expect(chainCount([])).toBe(1);
    expect(chainCount([{ hit: 2, happens: true }])).toBe(2);
    expect(chainCount([{ hit: 2, happens: true }, { hit: 3, happens: false }])).toBe(2);
    expect(chainCount([{ hit: 3, happens: true }])).toBe(1);
    expect(chainCount([{ hit: 2, happens: false }, { hit: 3, happens: true }])).toBe(1);
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
