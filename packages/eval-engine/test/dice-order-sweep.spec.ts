import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import type { DieReport } from '../src/dice/types';
import { copyOf } from '../src/sim-ask/copy';
import { mon, playClicks, PIKACHU, RULES, sweepSelection, type Mode, type Rules } from './dice-fixtures';
import {
  moveOrder, moverBoard, moverClicks, moverDie, moversOf, PAIRS, SLOTS, tieBoard, tieClicks, tieDie, type FirstMover,
} from './dice-order-support';
import { forcedOn, SWEEP_CASES } from './dice-sweep-support';
import { battleOf } from './power-oracle';

// Gen 4 draws in `BeforeTurn`, Gens 5 to 9 and Champions in `FractionalPriority`; Gens 2 and 3 draw the roll once
// at the start of each turn (`battle.quickClawRoll` in the action speed).
await loadSimMods('gen9championsou');

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const why = (report: DieReport): string => `${report.took}: ${report.reason ?? 'no reason'}`;
const SEEDS = Array.from({ length: 6 }, (_, index) => [1, 2, 3, 4].map(offset => (index + 1) * 11 + offset).join(','));

function naturalOrder(board: Battle, clicks: { p1: string; p2: string }): string[] {
  const battle = copyOf(board);
  battle.prng ??= board.prng.clone();
  const start = battle.log.length;
  playClicks(battle, clicks);
  return moveOrder(battle, start);
}

const before = (order: string[], first: string, second: string): boolean => order.indexOf(first) < order.indexOf(second);

describe.each(SWEEP_CASES)('the speed tie: $name', ({ rules, mode, name }) => {
  let flipped = 0;
  let cases = 0;

  test.each(PAIRS(SLOTS[mode]))('%s and %s go in either order on every seed', (a, b) => {
    for (const seed of sweepSelection(SEEDS, 'seeds')) {
      const board = tieBoard(rules, mode, seed);
      const clicks = tieClicks(mode);
      const natural = naturalOrder(board, clicks);
      for (const first of [a, b]) {
        const second = first === a ? b : a;
        const { report, battle, start } = forcedOn(board, clicks, [tieDie(a, b, first)]);
        const order = moveOrder(battle, start);
        cases++;
        expect(report.forced[0].took, `${seed} ${first} first: ${why(report.forced[0])}`).toBe('applied');
        expect(before(order, first, second), `${seed}: ${first} before ${second} in ${order.join(' ')}`).toBe(true);
        expect(String(battle.prng.getSeed()), `${seed}: the stream after the turn is the natural one`).toBe(report.naturalEndSeed);
        if (!before(natural, first, second)) flipped++;
      }
    }
  });

  test('the forced order of the whole board holds in every shuffle of the turn', () => {
    const slots = SLOTS[mode];
    const wanted = [...slots].reverse();
    const dice = PAIRS(slots).map(([a, b]) => tieDie(a, b, wanted.indexOf(a) < wanted.indexOf(b) ? a : b));
    for (const seed of sweepSelection(SEEDS, 'seeds')) {
      const { report, battle, start } = forcedOn(tieBoard(rules, mode, seed), tieClicks(mode), dice);
      expect(moveOrder(battle, start), seed).toEqual(wanted);
      expect(report.forced.map(shown => shown.took), `${seed}: ${report.forced.map(why).join(' / ')}`).toEqual(dice.map(() => 'applied'));
      cases++;
    }
  });

  test('the other actions keep the damage the natural turn dealt', () => {
    const slots = SLOTS[mode];
    const loss = (battle: Battle, slot: string): number => {
      const body = battle.sides[slot[1] === '1' ? 0 : 1].active[slot[2] === 'a' ? 0 : 1];
      return body.maxhp - body.hp;
    };
    for (const seed of sweepSelection(SEEDS, 'seeds')) {
      const board = tieBoard(rules, mode, seed);
      const clicks = tieClicks(mode);
      const plain = copyOf(board);
      plain.prng ??= board.prng.clone();
      playClicks(plain, clicks);
      const wanted = [...slots].reverse();
      const dice = PAIRS(slots).map(([a, b]) => tieDie(a, b, wanted.indexOf(a) < wanted.indexOf(b) ? a : b));
      const { battle } = forcedOn(board, clicks, dice);
      for (const slot of slots) expect(loss(battle, slot), `${seed} ${slot}`).toBe(loss(plain, slot));
    }
  });

  test('a die the answer does not fit is not applied', () => {
    const { report } = forcedOn(tieBoard(rules, mode, SEEDS[0]), tieClicks(mode), [{ ...tieDie('p1a', 'p2a', 'p1a'), result: { first: 'p9z' } }]);
    expect(report.forced[0].took, why(report.forced[0])).not.toBe('applied');
  });

  test('two bodies that do not tie have no tie die: no-draw with the reason', () => {
    const slow = mon(rules, { species: 'Snorlax', moves: ['tackle'], gender: 'M' });
    const fast = mon(rules, PIKACHU(['tackle']));
    const board = mode === 'singles'
      ? battleOf(rules.singles, [slow], [fast], SEEDS[0])
      : battleOf(rules.doubles!, [slow, mon(rules, { species: 'Blissey', moves: ['splash'] })], [fast, mon(rules, { species: 'Chansey', moves: ['splash'] })], SEEDS[0]);
    const clicks = mode === 'singles' ? tieClicks(mode) : { p1: 'move 1 1, move 1', p2: 'move 1 1, move 1' };
    const { report } = forcedOn(board, clicks, [tieDie('p1a', 'p2a', 'p1a')]);
    expect(report.forced[0].took, why(report.forced[0])).toBe('no-draw');
    expect(report.forced[0].reason).toMatch(/tie/);
  });

  test('the sweep played the ties and the forced order differed from the natural one', () => {
    summaries.push(`${name}: ${cases} forced ties, ${flipped} against the natural order`);
    expect(cases).toBeGreaterThan(0);
    expect(flipped).toBeGreaterThan(0);
  });
});

function naturalActivates(board: Battle, mover: FirstMover, rules: Rules): boolean {
  const battle = copyOf(board);
  battle.prng ??= board.prng.clone();
  if (rules.generation <= 3) return !!(battle as unknown as { quickClawRoll: boolean }).quickClawRoll;
  const start = battle.log.length;
  playClicks(battle, moverClicks(battle.gameType === 'doubles' ? 'doubles' : 'singles'));
  return battle.log.slice(start).some(line => mover.activate.test(line));
}

const SEED_POOL = Array.from({ length: 160 }, (_, index) => [1, 2, 3, 4].map(offset => (index + 1) * 7 + offset).join(','));

function seedsWhere(rules: Rules, mode: Mode, mover: FirstMover, activates: boolean, want: number): string[] {
  const found: string[] = [];
  for (const seed of SEED_POOL) {
    if (found.length === want) break;
    if (naturalActivates(moverBoard(rules, mode, mover, seed), mover, rules) === activates) found.push(seed);
  }
  return found;
}

describe.each(SWEEP_CASES)('the first-mover die: $name', ({ rules, mode, name }) => {
  const movers = moversOf(rules);
  const played: string[] = [];

  describe.each(movers.map(mover => [mover.label, mover] as const))('%s', (_label, mover) => {
    for (const natural of [true, false]) {
      test(`on a seed where the natural draw ${natural ? 'lets the holder go first' : 'does not'}, forced to happen and not to`, () => {
        const seeds = seedsWhere(rules, mode, mover, natural, 3);
        expect(seeds.length, 'seeds found').toBeGreaterThan(0);
        for (const seed of seeds) {
          const board = moverBoard(rules, mode, mover, seed);
          const clicks = moverClicks(mode);
          for (const happens of [true, false]) {
            const { report, battle, start } = forcedOn(board, clicks, [moverDie(mover, happens)]);
            const order = moveOrder(battle, start);
            const shown = report.forced[0];
            expect(shown.took, `${seed} ${happens ? 'yes' : 'no'}: ${why(shown)}`).toBe('applied');
            expect(order[0] === 'p1a', `${seed} ${happens ? 'yes' : 'no'}: order ${order.join(' ')}`).toBe(happens);
            expect(String(battle.prng.getSeed()), `${seed}: the stream after the turn is the natural one`).toBe(report.naturalEndSeed);
            if (rules.generation >= 4) {
              expect(battle.log.slice(start).some(line => mover.activate.test(line)), `${seed}: the activation line`).toBe(happens);
            }
            played.push(`${seed}${happens}`);
          }
        }
      });
    }

    test('a body without the holder\'s outfit has no die: no-draw', () => {
      const { report } = forcedOn(moverBoard(rules, mode, null, SEED_POOL[0]), moverClicks(mode), [moverDie(mover, true)]);
      expect(report.forced[0].took, why(report.forced[0])).toBe('no-draw');
    });
  });

  test('the sweep played the die', () => {
    summaries.push(`${name}: ${movers.map(mover => mover.id).join(',') || 'no first-mover item or ability'}, ${played.length} forced turns`);
    if (movers.length > 0) expect(played.length).toBeGreaterThan(0);
  });
});

describe.each(RULES.filter(rules => rules.generation === 2 || rules.generation === 3))('the roll of Gens 2 and 3 is read from the battle: $name', rules => {
  test.each(['singles', 'doubles'] as const)('%s: a forced die that adds draws leaves the next turn\'s roll as the natural turn gave it', mode => {
    if (mode === 'doubles' && !rules.doubles) return;
    const attacker = mon(rules, { species: 'Snorlax', moves: ['megakick'], gender: 'M' });
    const foe = mon(rules, PIKACHU(['splash']));
    let compared = 0;
    for (const seed of sweepSelection(SEED_POOL, 'pool')) {
      const board = mode === 'singles'
        ? battleOf(rules.singles, [attacker], [foe], seed)
        : battleOf(rules.doubles!, [attacker, mon(rules, { species: 'Blissey', moves: ['splash'] })], [foe, mon(rules, { species: 'Chansey', moves: ['splash'] })], seed);
      const clicks = mode === 'singles' ? { p1: 'move 1', p2: 'move 1' } : { p1: 'move 1 1, move 1', p2: 'move 1, move 1' };
      const plain = copyOf(board);
      plain.prng ??= board.prng.clone();
      const start = plain.log.length;
      playClicks(plain, clicks);
      if (!plain.log.slice(start).some(line => line.startsWith('|-miss|'))) continue;
      const hit: ForcedDie = { name: { slot: 'p1a', moveId: 'megakick', targetSlot: 'p2a', kind: 'accuracy' }, result: { happens: true } };
      const { battle } = forcedOn(board, clicks, [hit]);
      const roll = (target: Battle): boolean => !!(target as unknown as { quickClawRoll: boolean }).quickClawRoll;
      expect(roll(battle), `${seed}: the roll of the next turn`).toBe(roll(plain));
      compared++;
    }
    expect(compared).toBeGreaterThan(5);
  });
});
