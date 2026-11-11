import { writeFileSync } from 'node:fs';
import { State, Teams, toID, type Battle, Battle as SimBattle } from '@pkmn/sim';
import { afterAll, describe, expect, test } from 'vitest';
import { endgameChildren } from '../src/endgame/children';
import { createRootPosition } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { CHAMPIONS, mon, playClicks, sweepSelection, type Mode, type Rules } from './dice-fixtures';
import { CHECK_MOVES, CHECKS } from './dice-status-support';
import { clicksAccepted, dexOfRules, isCharge, SWEEP_CASES, sweepMoves, type DexMove } from './dice-sweep-support';
import { chancesCalled, liveState } from './flip-turn-support';

/**
 * Round 89 (A6-2, ruling 24, #145): the prover rows of the plain-path sweep. The plain path of the endgame children (every doubles
 * cell, a singles cell the class plan refuses) records the median draw's turn and plays each chance die the other way
 * (`dice/flip.ts`); a die that moves the board facts is a child whose share is the simulator's own chance. In every rule set the
 * corpus plays (Gens 1 to 9, the Champions mod), singles and doubles, the cell of
 * - every stalling move used again (its stall counter on the user) splits by the chance the simulator passes to `randomChance`, and
 *   the first use has no split (no die);
 * - every status check of the attacker (paralysis, freeze, infatuation, confusion) splits by the check's chance;
 * - every accuracy below 100 against a foe at 1 HP splits by the accuracy (the hit takes the foe down; a miss that leaves its HP
 *   alone moves no fact, so the sweep takes the foe down on the hit);
 * holds: the shares are the simulator's chances (the spy over `randomChance`, exact), they add up to 1, the group is priced, and
 * the root battle stands (`liveState`). A plain run plays a fixed sample; `DICE_SWEEPS=full` plays every entry.
 */
await loadSimMods('gen9championsou');

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16'];
const FAST = 'Pikachu';

/** The board: the attacker leads p1 with the move, a Vaporeon leads p2 with `foeMoves`; in doubles the partners splash. */
function boardOf(rules: Rules, mode: Mode, moves: string[], foeMoves: string[], seed: string, species = FAST): Battle {
  const attacker = mon(rules, { species, moves, gender: 'M' });
  const foe = mon(rules, { species: 'Vaporeon', moves: foeMoves });
  const format = mode === 'singles' ? rules.singles : rules.doubles!;
  const p1 = mode === 'singles' ? [attacker] : [attacker, mon(rules, { species: 'Blissey', moves: ['splash'] })];
  const p2 = mode === 'singles' ? [foe] : [foe, mon(rules, { species: 'Chansey', moves: ['splash'] })];
  const battle = new SimBattle({ formatid: toID(format), seed: seed.split(',').map(Number) as never, p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

/** The clicks of a board that `boardOf` made: the attacker uses its first move at the first foe, the foe its first move (a splash splashes). */
const clicksFor = (mode: Mode, aimed: boolean, foeAims = false): { p1: string; p2: string } =>
  mode === 'singles' ? { p1: 'move 1', p2: 'move 1' } : { p1: `move 1${aimed ? ' 1' : ''}, move 1`, p2: `move 1${foeAims ? ' 1' : ''}, move 1` };

/** The cell's choice strings, as the prover names them (`move <id>`, the aim kept where the click has one). */
function choicesOf(board: Battle, clicks: { p1: string; p2: string }): [string, string] {
  const choice = (side: 0 | 1, click: string): string => click.split(',').map((part, position) => {
    const [, index, aim] = part.trim().split(' ');
    const mon = board.sides[side].active[position]!;
    return `move ${mon.moveSlots[Number(index) - 1].id}${aim ? ` ${aim}` : ''}`;
  }).join(', ');
  return [choice(0, clicks.p1), choice(1, clicks.p2)];
}

const ruleset = (rules: Rules): 'champions' | 'standard' => (rules === CHAMPIONS ? 'champions' : 'standard');
const positionOf = (board: Battle, rules: Rules) => createRootPosition(JSON.stringify(State.serializeBattle(board)), ruleset(rules));

const tallies = new Map<string, { cases: number; split: number }>();
function tally(name: string, split: boolean): void {
  const row = tallies.get(name) ?? { cases: 0, split: 0 };
  row.cases++;
  if (split) row.split++;
  tallies.set(name, row);
}

/** The shares of a cell, smallest first. */
const sharesOf = (cell: ReturnType<typeof endgameChildren>): number[] => cell.children.map(child => child.share).sort((a, b) => a - b);

/** The cell of a board's clicks, with the checks every row shares: the priced group, the shares add up to 1, the live board stands. */
function cellOf(board: Battle, rules: Rules, clicks: { p1: string; p2: string }) {
  const before = liveState(board);
  const [p1Choice, p2Choice] = choicesOf(board, clicks);
  const cell = endgameChildren(positionOf(board, rules), p1Choice, p2Choice, 6);
  expect(liveState(board), 'the live board').toBe(before);
  return { cell, shares: sharesOf(cell), p1Choice, p2Choice };
}

const expectSplit = (shares: number[], chance: number, label: string): void => {
  expect(shares, label).toHaveLength(2);
  const [low, high] = chance < 0.5 ? [chance, 1 - chance] : [1 - chance, chance];
  expect(shares[0], `${label} low share`).toBeCloseTo(low, 12);
  expect(shares[1], `${label} high share`).toBeCloseTo(high, 12);
};

describe.each(SWEEP_CASES)('the stalling moves: $name', ({ rules, mode, name }) => {
  const { moves } = sweepMoves(rules, move => !!(move as unknown as { stallingMove?: boolean }).stallingMove, false);
  if (moves.length === 0) test('no stalling move in this rule set', () => expect(rules.generation).toBe(1));

  test.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    for (const seed of sweepSelection(SEEDS, 'seeds')) {
      for (const foeMoves of [['splash'], ['tackle', 'splash']]) {
        const board = boardOf(rules, mode, [move.id, 'splash'], foeMoves, seed);
        const clicks = clicksFor(mode, false, foeMoves[0] === 'tackle');
        if (!clicksAccepted(board, clicks)) return;
        // a foe that attacks adds dice of its own (its accuracy moves the facts where a hit is written down), so the exact rows are the splashing foe's
        const exact = foeMoves[0] === 'splash';
        // the first use draws no stall die: no split
        const first = cellOf(board, rules, clicks);
        if (exact) {
          expect(first.shares, `${name} ${move.id} first use`).toEqual([1]);
          expect(first.cell.unpriced, `${name} ${move.id} first use priced`).toBe(false);
        }
        playClicks(board, clicks);
        if (board.ended || !clicksAccepted(board, clicks)) continue;
        const oracle = chancesCalled(board, clicks).filter(entry => entry.effect === 'stall' && entry.chance > 0 && entry.chance < 1).map(entry => entry.chance);
        const second = cellOf(board, rules, clicks);
        expect(second.cell.plain, `${name} ${move.id} plain`).toBe(true);
        expect(second.shares.reduce((sum, share) => sum + share, 0), `${name} ${move.id} total`).toBeLessThanOrEqual(1 + 1e-12);
        if (!exact) continue;
        expect(second.cell.unpriced, `${name} ${move.id} second use priced`).toBe(false);
        if (oracle.length === 0) {
          expect(second.shares, `${name} ${move.id} no stall die`).toEqual([1]);
          tally(`stall ${name}`, false);
          continue;
        }
        expectSplit(second.shares, oracle[0], `${name} ${move.id} ${seed} ${foeMoves[0]}`);
        tally(`stall ${name}`, true);
      }
    }
  });
});

describe.each(SWEEP_CASES)('the status checks: $name', ({ rules, mode, name }) => {
  const checks = CHECKS.filter(check => rules.generation >= check.from);

  describe.each(checks.map(check => [check.id, check] as const))('%s', (_id, check) => {
    test.each(sweepSelection(CHECK_MOVES, 'moves'))('%s', moveId => {
      const dex = dexOfRules(rules);
      const move = dex.moves.get(moveId);
      // a move with a secondary of its own draws a second die (and a cell with two dice leaves their joint share out of the mass): the rows read the plain moves
      const secondaries = (move as unknown as { secondaries?: unknown[] }).secondaries ?? [];
      // (Gens 1 to 4 give Tackle 95 accuracy: its own die)
      if (!move.exists || move.gen > dex.gen || secondaries.length > 0 || typeof move.accuracy === 'number') return;
      for (const seed of sweepSelection(SEEDS, 'seeds')) {
        const board = boardOf(rules, mode, [moveId, 'splash'], ['splash'], seed, 'Snorlax');
        check.start(board);
        const clicks = clicksFor(mode, ['normal', 'any', 'adjacentFoe'].includes(move.target));
        if (!clicksAccepted(board, clicks)) continue;
        const oracle = chancesCalled(board, clicks).filter(entry => entry.event === 'BeforeMove' && entry.effect === check.id && entry.chance > 0 && entry.chance < 1).map(entry => entry.chance);
        const { cell, shares } = cellOf(board, rules, clicks);
        // a singles cell that the class plan prices has its own rows (the class path); this sweep reads the plain path
        if (!cell.plain) continue;
        expect(cell.unpriced, `${name} ${check.id} ${moveId} priced`).toBe(false);
        // Gens 3 and 4: a move that thaws its user overrules a thaw that fails, so the other branch shows the same board
        const defrosts = check.id === 'frz' && !!move.flags.defrost;
        if (oracle.length === 0 || defrosts) {
          tally(`check ${name}`, false);
          continue;
        }
        // a status move behind a draw that leaves the board alone (nothing to fail) prices as one child; every other check splits
        if (shares.length === 1) {
          tally(`check ${name}`, false);
          continue;
        }
        expectSplit(shares, oracle[0], `${name} ${check.id} ${moveId} ${seed}`);
        tally(`check ${name}`, true);
      }
    });
  });
});

/**
 * A damaging move at one foe with an accuracy of its own and no secondary: a status move's hit lands an effect whose own dice (a
 * confusion's self-hit, a paralysis) join the cell's, a spread move draws one accuracy per foe, and a secondary is a second die (a
 * cell of two dice leaves their joint share out of the mass; the exact share of each die is this row's claim).
 */
const inaccurate = (move: DexMove): boolean => typeof move.accuracy === 'number' && move.accuracy < 100 && move.category !== 'Status'
  && ['normal', 'any', 'adjacentFoe'].includes(move.target) && ((move as unknown as { secondaries?: unknown[] }).secondaries ?? []).length === 0;

describe.each(SWEEP_CASES.filter(entry => entry.mode === 'doubles'))('the accuracy dice against a foe at 1 HP: $name', ({ rules, mode, name }) => {
  const { moves } = sweepMoves(rules, inaccurate);

  test.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    for (const seed of sweepSelection(SEEDS, 'seeds')) {
      const board = boardOf(rules, mode, [move.id, 'splash'], ['splash'], seed);
      let clicks = clicksFor(mode, ['normal', 'any', 'adjacentFoe'].includes(move.target));
      if (isCharge(move)) {
        playClicks(board, clicks);
        clicks = clicksFor(mode, false);
      }
      if (!clicksAccepted(board, clicks) || board.ended) return;
      // every foe at 1 HP: a hit takes the first foe down, a miss leaves it standing
      for (const foe of board.sides[1].pokemon) foe.hp = 1;
      const oracle = chancesCalled(board, clicks).filter(entry => entry.chance > 0 && entry.chance < 1).map(entry => entry.chance);
      const { cell, shares } = cellOf(board, rules, clicks);
      expect(cell.plain, `${name} ${move.id} plain`).toBe(true);
      if (shares.length === 1) {
        tally(`accuracy ${name}`, false);
        continue;
      }
      // every share is a chance of the turn or its complement: the simulator's own numbers
      for (const share of shares) {
        expect(oracle.some(chance => Math.abs(chance - share) < 1e-12 || Math.abs(1 - chance - share) < 1e-12), `${name} ${move.id} ${seed}: ${shares} among ${oracle}`).toBe(true);
      }
      expect(shares.reduce((sum, share) => sum + share, 0), `${name} ${move.id} total`).toBeLessThanOrEqual(1 + 1e-12);
      if (shares.length === 2 && rules.generation >= 3 && !move.ohko && typeof move.accuracy === 'number') expectSplit(shares, move.accuracy / 100, `${name} ${move.id} accuracy`);
      tally(`accuracy ${name}`, true);
    }
  });
});

describe('the sweep exercised its rows', () => {
  test.each(SWEEP_CASES.filter(entry => entry.rules.generation >= 3))('$name split cells of stalls, checks and accuracies', ({ name, mode }) => {
    summaries.push(...[...tallies].filter(([key]) => key.endsWith(name)).map(([key, row]) => `${key}: ${JSON.stringify(row)}`));
    for (const kind of mode === 'doubles' ? ['stall', 'check', 'accuracy'] : ['stall']) {
      expect(tallies.get(`${kind} ${name}`)?.split ?? 0, `${kind} ${name}`).toBeGreaterThan(0);
    }
  });
});
