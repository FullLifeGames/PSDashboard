import { writeFileSync } from 'node:fs';
import { PRNG, type Battle, type PRNGSeed } from '@pkmn/sim';
import { afterAll, describe, expect, test } from 'vitest';
import { flipTurn, recordTurn, type FlipDie, type FlippedTurn, type RecordedTurn } from '../src/dice/flip';
import { secondaryEffectId } from '../src/dice/recognize';
import { loadSimMods } from '../src/forward/sim-mods';
import { playClicks, seedOf, sweepSelection } from './dice-fixtures';
import { CHECK_MOVES, CHECKS } from './dice-status-support';
import {
  clicksAccepted, dexOfRules, effectShown, isCharge, missesOf, outfitBoard, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves, type DexMove, type SecondaryEntry,
} from './dice-sweep-support';
import { chancesCalled, liveState, turnOf, type Called } from './flip-turn-support';

/**
 * Round 89 (A6-1, ruling 24, #145): the dice-level part of the sweep behind the plain path's flip. On a copy of one turn the
 * recorder lists every chance die the simulator drew (the roll facts aside) and `flipTurn` plays one of them the other way with
 * the others held. In every rule set the corpus plays (Gens 1 to 9, the Champions mod), singles and doubles, for the dice of the
 * stalling moves, the status checks, the accuracies, the secondaries and a first-mover item, each row holds:
 * - the chance of the die equals what the simulator passes to `randomChance` (a spy over the stream of a plain turn; for a
 *   secondary's percent, the Dex entry);
 * - the flip reaches the other branch: the protocol of the flipped turn shows the other answer, the recorded turn shows its own;
 * - the live board is unchanged (`standing`, the log and the stream), because every question runs on a copy;
 * - a die that the simulator draws no chance for (a move that works on the first turn only, a thaw that a move overrules before
 *   the draw) is not listed.
 * A plain run plays a fixed sample of the moves and seeds; `DICE_SWEEPS=full` plays every entry.
 */
await loadSimMods('gen9championsou');

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20', '21,22,23,24', '25,26,27,28', '29,30,31,32'];
const FAST = 'Pikachu';

type Clicks = { p1: string; p2: string };
interface Played { recorded: RecordedTurn; flips: { die: FlipDie; flipped: FlippedTurn }[]; called: Called[] }

/** The turn recorded and every listed die flipped, on copies; the checks every row shares (the live board, the chance, the flip took). */
function play(board: Battle, clicks: Clicks): Played {
  const before = liveState(board);
  const turn = turnOf(board, clicks);
  const recorded = recordTurn(turn);
  const flips = recorded.dice.map(die => ({ die, flipped: flipTurn(turn, recorded, die) }));
  const called = chancesCalled(board, clicks);
  expect(liveState(board), 'the live board').toBe(before);
  // Round 89 (A6-3a): a die the turn drew more than once is listed apart and never flipped
  for (const die of recorded.repeated) expect(recorded.dice.some(entry => entry.key === die.key), `${die.key} is listed once`).toBe(false);
  for (const { die, flipped } of flips) {
    expect(flipped.took, `${die.key} took`).toBe(true);
    expect(die.held + die.other).toBeCloseTo(1, 12);
    // the dice that compare a `random(100)` with an entry's percent are no `randomChance`: their row reads the Dex
    if (die.name.kind !== 'secondary' && die.name.kind !== 'self-effect') {
      expect(called.some(entry => Math.abs(entry.chance - die.chance) < 1e-12), `${die.key}: ${die.chance} among ${called.map(entry => entry.chance)}`).toBe(true);
    }
  }
  return { recorded, flips, called };
}

const lines = (battle: Battle, start: number, pattern: RegExp): boolean => battle.log.slice(start).some(line => pattern.test(line));
const slotOf = (ident: string | undefined): string | undefined => ident?.split(':')[0].trim();
/** Whether the target's turn ends on a `|cant|` line of its own that is no flinch (frozen, asleep, fully paralyzed): a flinch behind it shows no line. */
const stoppedByOther = (battle: Battle, start: number, slot: string): boolean =>
  battle.log.slice(start).some(line => line.startsWith('|cant|') && slotOf(line.split('|')[2]) === slot && line.split('|')[3] !== 'flinch');
/** Whether the target fell in the turn: a secondary behind the knockout shows no line (the simulator still rolls it in some generations). */
const fainted = (battle: Battle, start: number, slot: string): boolean =>
  battle.log.slice(start).some(line => line.startsWith('|faint|') && slotOf(line.split('|')[2]) === slot);
const failedBy = (battle: Battle, start: number, slot: string): boolean => battle.log.slice(start).some(line => line.startsWith('|-fail|') && line.split('|')[2].startsWith(slot));

const hitsOf = (battle: Battle, start: number): number => Math.max(0, ...battle.log.slice(start).filter(line => line.startsWith('|-hitcount|')).map(line => Number(line.split('|')[3])));

const tallies = new Map<string, { cases: number; flips: number; yes: number; no: number }>();
function tally(name: string, drew?: boolean): void {
  const row = tallies.get(name) ?? { cases: 0, flips: 0, yes: 0, no: 0 };
  row.cases++;
  if (drew !== undefined) {
    row.flips++;
    row[drew ? 'yes' : 'no']++;
  }
  tallies.set(name, row);
}

describe.each(SWEEP_CASES)('the stalling moves: $name', ({ rules, mode, name }) => {
  const { moves } = sweepMoves(rules, move => !!(move as unknown as { stallingMove?: boolean }).stallingMove, false);
  // Gen 1 has no stalling move
  if (moves.length === 0) test('no stalling move in this rule set', () => expect(rules.generation).toBe(1));

  test.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    for (const seed of sweepSelection(SEEDS, 'seeds')) {
      const board = sweepBoard(rules, move.id, mode, seed, false, FAST);
      const clicks = sweepClicks(mode, move.target);
      if (!clicksAccepted(board, clicks)) return;
      // the first use draws no chance: nothing to flip
      const first = play(board, clicks);
      expect(first.recorded.dice.filter(die => die.name.kind === 'stalling'), `${move.id} first use`).toEqual([]);
      playClicks(board, clicks);
      if (!clicksAccepted(board, clicks)) return;
      const second = play(board, clicks);
      const oracle = second.called.filter(entry => entry.effect === 'stall' && entry.chance > 0 && entry.chance < 1).map(entry => entry.chance);
      const stalls = second.flips.filter(({ die }) => die.name.kind === 'stalling');
      expect(stalls.map(({ die }) => die.chance), `${name} ${move.id} the stall chance`).toEqual(oracle);
      for (const { die, flipped } of stalls) {
        // the draw's true is the success of the move: the recorded turn fails exactly when the draw came false
        expect(failedBy(second.recorded.battle, second.recorded.logStart, 'p1a'), `${move.id} recorded`).toBe(!die.drew);
        expect(failedBy(flipped.battle, flipped.logStart, 'p1a'), `${move.id} flipped`).toBe(die.drew);
        tally(`stall ${name}`, die.drew);
      }
      if (stalls.length === 0) tally(`stall ${name}`);
    }
  });
});

describe.each(SWEEP_CASES)('the status checks: $name', ({ rules, mode, name }) => {
  const checks = CHECKS.filter(check => rules.generation >= check.from);

  describe.each(checks.map(check => [check.id, check] as const))('%s', (_id, check) => {
    test.each(sweepSelection(CHECK_MOVES, 'moves'))('%s', moveId => {
      const dex = dexOfRules(rules);
      const move = dex.moves.get(moveId);
      if (!move.exists || move.gen > dex.gen) return;
      const clicks = sweepClicks(mode, move.target);
      for (const seed of sweepSelection(SEEDS, 'seeds')) {
        const board = sweepBoard(rules, moveId, mode, seed);
        check.start(board);
        const { recorded, flips, called } = play(board, clicks);
        const oracle = called.filter(entry => entry.event === 'BeforeMove' && entry.effect === check.id).map(entry => entry.chance);
        const dice = flips.filter(({ die }) => die.name.kind === 'status-check' && die.name.effectId === check.id);
        // a draw the simulator makes no chance of (a sure thaw, no draw for a move that thaws its user) is not listed
        expect(dice.map(({ die }) => die.chance), `${name} ${check.id} ${moveId} chance`).toEqual(oracle.filter(chance => chance > 0 && chance < 1));
        if (dice.length === 0) {
          tally(`check ${name}`);
          continue;
        }
        const defrosts = check.id === 'frz' && !!move.flags.defrost;
        for (const { die, flipped } of dice) {
          tally(`check ${name}`, die.drew);
          if (defrosts) continue; // Gens 3 and 4: the move overrules a thaw that fails, so the flipped turn may show no other branch
          // the answer to a check is the body's own: the raw draw's polarity is the handler's, read here from the two protocols
          const goesOn = lines(recorded.battle, recorded.logStart, check.yes);
          expect(goesOn !== lines(recorded.battle, recorded.logStart, check.no), `${check.id} ${moveId} recorded shows one branch`).toBe(true);
          expect(lines(flipped.battle, flipped.logStart, goesOn ? check.no : check.yes), `${name} ${check.id} ${moveId} ${seed} flipped shows the other branch`).toBe(true);
          expect(lines(flipped.battle, flipped.logStart, goesOn ? check.yes : check.no), `${check.id} ${moveId} flipped shows only the other`).toBe(false);
        }
      }
    });
  });
});

/** The dice of a damaging move's accuracy: every move with an accuracy below 100 that a foe can be the target of. */
const inaccurate = (move: DexMove): boolean => typeof move.accuracy === 'number' && move.accuracy < 100;

describe.each(SWEEP_CASES)('the accuracy dice: $name', ({ rules, mode, name }) => {
  const { moves } = sweepMoves(rules, inaccurate);

  test.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    let exercised = false;
    for (const seed of sweepSelection(SEEDS, 'seeds')) {
      const board = sweepBoard(rules, move.id, mode, seed, false, FAST);
      let clicks = sweepClicks(mode, move.target);
      if (isCharge(move)) {
        playClicks(board, clicks);
        clicks = sweepClicks(mode, move.target, true);
      }
      if (!clicksAccepted(board, clicks)) return;
      const { recorded, flips } = play(board, clicks);
      for (const { die, flipped } of flips.filter(entry => entry.die.name.kind === 'accuracy' && entry.die.name.slot === 'p1a' && !entry.die.name.hit)) {
        exercised = true;
        // Gens 3 and up draw the Dex accuracy as it stands (no weather, no item, no boosts on this board); a one-hit knockout moves with the levels
        if (rules.generation >= 3 && !move.ohko) expect(die.chance, `${name} ${move.id} accuracy`).toBeCloseTo((move.accuracy as number) / 100, 12);
        const slot = die.name.targetSlot ?? '';
        const before = missesOf(recorded.battle, recorded.logStart, slot);
        const after = missesOf(flipped.battle, flipped.logStart, slot);
        // the draw's true is the hit: a recorded hit has no miss line, the flip has one, and the other way round
        if (die.drew) expect([before, after > 0], `${name} ${move.id} ${seed} hit to miss`).toEqual([0, true]);
        else expect([before > 0, after], `${name} ${move.id} ${seed} miss to hit`).toEqual([true, 0]);
        tally(`accuracy ${name}`, die.drew);
      }
    }
    if (!exercised) tally(`accuracy ${name}`);
  });
});

const entriesOf = (move: DexMove): SecondaryEntry[] => ((move as unknown as { secondaries?: SecondaryEntry[] }).secondaries ?? []);

describe.each(SWEEP_CASES)('the secondaries: $name', ({ rules, mode, name }) => {
  const { moves } = sweepMoves(rules, move => entriesOf(move).some(entry => entry.chance !== undefined && entry.chance < 100) && !move.flags.futuremove);

  test.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    const entries = entriesOf(move).filter(entry => entry.chance !== undefined && entry.chance > 0 && entry.chance < 100);
    for (const seed of sweepSelection(SEEDS, 'seeds')) {
      const board = sweepBoard(rules, move.id, mode, seed, false, FAST);
      let clicks = sweepClicks(mode, move.target);
      if (isCharge(move)) {
        playClicks(board, clicks);
        clicks = sweepClicks(mode, move.target, true);
      }
      if (!clicksAccepted(board, clicks)) return;
      const { recorded, flips } = play(board, clicks);
      // a secondary rolled on every hit (Gens 3 and up, a move of two hits or more) is one name drawn twice: no price, no flip (the plain path calls the group unpriced)
      for (const die of recorded.repeated.filter(entry => entry.name.kind === 'secondary')) {
        expect(hitsOf(recorded.battle, recorded.logStart), `${name} ${move.id} ${seed} ${die.key} drawn once per hit`).toBeGreaterThanOrEqual(2);
        tally(`repeated secondary ${name}`);
      }
      for (const { die, flipped } of flips.filter(entry => entry.die.name.kind === 'secondary')) {
        const entry = entries.find(candidate => secondaryEffectId(candidate) === die.name.effectId);
        expect(entry, `${name} ${move.id} ${die.name.effectId} is an entry of the Dex`).toBeDefined();
        // Gens 3 and up compare the Dex percent as it stands; Gens 1 and 2 compare a threshold out of 256 that the simulator rounds its own way
        if (rules.generation >= 3) expect(die.chance, `${name} ${move.id} secondary chance`).toBeCloseTo(entry!.chance! / 100, 12);
        else expect(Math.abs(die.chance - entry!.chance! / 100), `${name} ${move.id} secondary chance`).toBeLessThan(1 / 128);
        // an entry the protocol shows by a standard line: the draw's true is the effect
        const opaque = secondaryEffectId(entry!) === 'effect' || (!!entry!.volatileStatus && secondaryEffectId(entry!) !== 'flinch') || !!entry!.self;
        const target = die.name.targetSlot ?? 'p2a';
        // the witness of a flinch is the target's `cant` line, which another status of the same move (Ice Fang's freeze) replaces; a knocked out target shows no effect at all
        const hidden = [recorded, flipped].some(turn => fainted(turn.battle, turn.logStart, target)
          || (secondaryEffectId(entry!) === 'flinch' && stoppedByOther(turn.battle, turn.logStart, target)));
        if (!opaque && !hidden && missesOf(recorded.battle, recorded.logStart, target) === 0 && missesOf(flipped.battle, flipped.logStart, target) === 0) {
          expect(effectShown(recorded.battle, recorded.logStart, entry!, target, 'p1a'), `${name} ${move.id} ${seed} recorded effect`).toBe(die.drew);
          expect(effectShown(flipped.battle, flipped.logStart, entry!, target, 'p1a'), `${name} ${move.id} ${seed} flipped effect`).toBe(!die.drew);
        }
        tally(`secondary ${name}`, die.drew);
      }
    }
  });
});

describe.each(SWEEP_CASES.filter(entry => entry.rules.generation >= 4))('the first-mover item: $name', ({ rules, mode, name }) => {
  test('the holder acts first when the draw comes true, and the other way after the flip', () => {
    const dex = dexOfRules(rules);
    const item = dex.items.get('quickclaw');
    if (!item.exists) return;
    // the draw is one in five or so: seeds play until the draw has come true once and false once
    const seen = new Set<boolean>();
    for (let index = 0; index < 80 && seen.size < 2; index++) {
      const seed = seedOf(index);
      const board = outfitBoard(rules, mode, { species: 'Snorlax', moves: ['tackle'], item: item.id }, { species: 'Vaporeon' });
      board.prng = new PRNG(seed.split(',').map(Number) as PRNGSeed);
      const clicks = sweepClicks(mode, 'normal');
      const { recorded, flips } = play(board, clicks);
      const dice = flips.filter(({ die }) => die.name.kind === 'move-first');
      expect(dice.length, `${name} ${seed} the first-mover die`).toBe(1);
      const mover = (battle: Battle, start: number): string => battle.log.slice(start).find(line => line.startsWith('|move|'))!.split('|')[2].slice(0, 3);
      for (const { die, flipped } of dice) {
        // the foe is the faster body, so the holder goes first exactly when the draw comes true
        expect(mover(recorded.battle, recorded.logStart), `${name} ${seed} recorded`).toBe(die.drew ? 'p1a' : 'p2a');
        expect(mover(flipped.battle, flipped.logStart), `${name} ${seed} flipped`).toBe(die.drew ? 'p2a' : 'p1a');
        tally(`first mover ${name}`, die.drew);
        seen.add(die.drew);
      }
    }
    expect(seen.size, `${name}: the draw came true and false`).toBe(2);
  });
});

describe('the sweep exercised its rows', () => {
  test.each(SWEEP_CASES.filter(entry => entry.rules.generation >= 3))('$name flips both answers of stalls, accuracies and secondaries', ({ name }) => {
    summaries.push(...[...tallies].filter(([key]) => key.endsWith(name)).map(([key, row]) => `${key}: ${JSON.stringify(row)}`));
    for (const kind of ['stall', 'accuracy', 'secondary']) {
      const row = tallies.get(`${kind} ${name}`);
      expect(row?.flips ?? 0, `${kind} ${name}`).toBeGreaterThan(0);
    }
  });

  test('both answers of a die were drawn and flipped somewhere in the rule sets of Gens 3 to 9', () => {
    for (const kind of ['stall', 'check', 'accuracy', 'secondary', 'first mover']) {
      const rows = [...tallies].filter(([key]) => key.startsWith(`${kind} `)).map(([, row]) => row);
      expect(rows.reduce((sum, row) => sum + row.yes, 0), `${kind} drew true`).toBeGreaterThan(0);
      expect(rows.reduce((sum, row) => sum + row.no, 0), `${kind} drew false`).toBeGreaterThan(0);
    }
  });
});
