import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import { PRNG, type Battle } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { playLikeliestTurn, type LikeliestTurn } from '../src/dice/likeliest';
import { offeredDice } from '../src/dice/offer';
import { playForcedTurn } from '../src/dice/play';
import { dieKey, type ForcedDie } from '../src/dice/types';
import { copyOf } from '../src/sim-ask/copy';
import { EFFECT_SPORE, END_ROWS, endBoard, present, PROCS, procBoard } from './dice-ability-support';
import { moverBoard, moverClicks, moversOf, tieBoard, tieClicks } from './dice-order-support';
import { playClicks, stableLog, standing, sweepSelection, type Mode } from './dice-fixtures';
import { CHECK_MOVES, CHECKS } from './dice-status-support';
import { dexOfRules, isCharge, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves, type DexMove } from './dice-sweep-support';

// Round 89 (#104), step G2: the likeliest result of each die, and a turn played with every die at it (dice/likeliest.ts). The sweep
// plays every Dex entry of the kinds that draw a die, in every rule set the corpus plays (Gens 1 to 9, the Champions mod), singles and
// doubles:
//   - the live battle stays as it was (`standing`: the fingerprint of every body, the queue and the move in flight);
//   - two passes over the same turn name the same dice (determinism);
//   - the dice the pass lists, replayed through `playForcedTurn` under two other seeds, give the log the pass played: the line does not
//     depend on the seed. Where a log does differ, the pass says so (`unnamed` draws or an `unforced` die): a draw no die names, a
//     duration or a target picked at random, stays with the stream and the line marks itself;
//   - every result is the likeliest by the simulator's own data: an accuracy die takes the Dex's accuracy (a hit above 50), a
//     secondary the entry's chance, the damage roll its middle step, a hit count a count of the move's range; a status check, a proc,
//     an end-of-turn die, a first mover and a speed tie as their rows below read them.
// Plain runs play the fixed sample of every list; DICE_SWEEPS=full plays them whole (the CI job of the dice sweeps).
await loadSimMods('gen9championsou');

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const SEEDS = ['21,22,23,24', '905,17,333,4096'];
const NEEDS_AIM = new Set(['normal', 'any', 'adjacentFoe']);
const choiceOf = (move: DexMove, mode: Mode) => ({
  kind: 'move' as const, moveId: move.id, moveName: move.name, ...(mode === 'doubles' && NEEDS_AIM.has(move.target) ? { targetLoc: 1 } : {}),
});

interface Tally { cases: number; dice: number; unforced: number; unnamed: string[] }
const newTally = (): Tally => ({ cases: 0, dice: 0, unforced: 0, unnamed: [] });

/**
 * One likeliest pass with the checks every row shares: the live battle stays, the pass is deterministic, and a log that depends on
 * the seed belongs to a pass that says it leaves a draw to the stream.
 */
function pass(board: Battle, play: (battle: Battle) => void, row: string): LikeliestTurn {
  const before = standing(board);
  const turn = playLikeliestTurn(board, play);
  expect(standing(board), `${row}: the pass leaves the live battle as it was`).toBe(before);
  const again = playLikeliestTurn(board, play);
  expect(again.dice.map(entry => [dieKey(entry.die.name), entry.die.result]), `${row}: the pass is deterministic`).toEqual(turn.dice.map(entry => [dieKey(entry.die.name), entry.die.result]));
  const forced: ForcedDie[] = turn.dice.map(entry => entry.die);
  const played = stableLog(turn.battle);
  for (const seed of SEEDS) {
    const copy = copyOf(board);
    copy.prng = new PRNG(seed as ConstructorParameters<typeof PRNG>[0]);
    playForcedTurn({ live: copy, forced, play });
    if (stableLog(copy) !== played) {
      expect(turn.unnamed + turn.unforced.length, `${row}: the log depends on seed ${seed}, so the pass must say that a draw stays with the stream`).toBeGreaterThan(0);
    }
  }
  return turn;
}

const byKind = (turn: LikeliestTurn, kind: string) => turn.dice.filter(entry => entry.die.name.kind === kind);

/** The Dex accuracy of a move as the number the die is compared with: a sure move is 100. */
const accuracyOf = (move: DexMove): number => (move.accuracy === true ? 100 : move.accuracy);

/** One die of a move's pass against the simulator's own data: the Dex accuracy, the secondary's chance, the middle roll, the move's range of hits. */
function checkDie(entry: LikeliestTurn['dice'][number], move: DexMove, board: Battle, mode: Mode, generation: number): void {
  const die = entry.die.name;
  const { result } = entry.die;
  const ofMove = die.moveId === move.id && die.slot === 'p1a';
  if (die.kind === 'damage-roll') expect(result, `${move.id}: the roll`).toEqual({ step: Math.floor((generation <= 2 ? 39 : 16) / 2) });
  if (die.kind === 'accuracy' && ofMove && typeof move.accuracy === 'number' && accuracyOf(move) !== 50) {
    expect('happens' in result && result.happens, `${move.id}: accuracy ${accuracyOf(move)}`).toBe(accuracyOf(move) > 50);
  }
  if (die.kind === 'hit-count' && Array.isArray(move.multihit) && 'hits' in result) {
    expect(result.hits, `${move.id}: the count stays in the move's range`).toBeGreaterThanOrEqual(move.multihit[0]);
    expect(result.hits).toBeLessThanOrEqual(move.multihit[1]);
  }
  if (die.kind === 'secondary' && ofMove) checkSecondary(entry, move, board, mode);
  if (entry.chance !== undefined && 'happens' in result && die.kind !== 'status-check') {
    expect(entry.chance, `${die.kind} takes the result of at least one half`).toBeGreaterThanOrEqual(0.5);
  }
}

/** A secondary effect takes the entry's own chance from the offer: it happens above one half. */
function checkSecondary(entry: LikeliestTurn['dice'][number], move: DexMove, board: Battle, mode: Mode): void {
  const offered = offeredDice(board, 'p1a', choiceOf(move, mode)).find(offer => dieKey(offer.name) === dieKey(entry.die.name));
  if (offered?.chance === undefined || offered.chance === 0.5) return;
  expect('happens' in entry.die.result && entry.die.result.happens, `${move.id}: secondary ${entry.die.name.effectId} at ${offered.chance}`).toBe(offered.chance > 0.5);
}

describe.each(SWEEP_CASES)('the likeliest dice of every move: $name', ({ rules, mode, name }) => {
  const { moves } = sweepMoves(rules, () => true);
  const tally = newTally();

  test.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    const board = sweepBoard(rules, move.id, mode, '1,2,3,4', false, 'Pikachu');
    let clicks = sweepClicks(mode, move.target);
    if (isCharge(move)) {
      playClicks(board, clicks);
      clicks = sweepClicks(mode, move.target, true);
    }
    const probe = copyOf(board);
    probe.prng ??= board.prng.clone();
    if (!(probe.choose('p1', clicks.p1) && probe.choose('p2', clicks.p2))) return;
    const turn = pass(board, battle => playClicks(battle, clicks), `${rules.name} ${mode} ${move.id}`);
    tally.cases++;
    tally.dice += turn.dice.length;
    tally.unforced += turn.unforced.length;
    if (turn.unnamed > 0) tally.unnamed.push(move.id);
    for (const entry of turn.dice) checkDie(entry, move, board, mode, rules.generation);
  });

  test('the sweep played its moves', () => {
    summaries.push(`${name}: ${moves.length} moves ${JSON.stringify(tally)}`);
    expect(tally.cases).toBeGreaterThan(moves.length * 0.8);
    expect(tally.dice).toBeGreaterThan(0);
  });
});

describe.each(SWEEP_CASES)('the likeliest dice of the status checks: $name', ({ rules, mode }) => {
  const checks = CHECKS.filter(check => rules.generation >= check.from);
  test.each(checks.flatMap(check => sweepSelection(CHECK_MOVES, 'rows').map(move => [`${check.id} before ${move}`, check, move] as const)))('%s', (_label, check, moveId) => {
    const dex = dexOfRules(rules);
    if (!dex.moves.get(moveId).exists || dex.moves.get(moveId).gen > dex.gen) return;
    const board = sweepBoard(rules, moveId, mode, '1,2,3,4');
    check.start(board);
    const clicks = sweepClicks(mode, dex.moves.get(moveId).target);
    const turn = pass(board, battle => playClicks(battle, clicks), `${rules.name} ${mode} ${check.id} ${moveId}`);
    const dies = byKind(turn, 'status-check').filter(entry => entry.die.name.effectId === check.id);
    // the Gen 2 thaw falls at the end of the turn; a move that thaws its user (the Dex flag `defrost`) thaws the body whatever the check
    // says, so the protocol does not show the die's answer there (the pass above held the replay to the log all the same)
    if (dies.length === 0 || dex.moves.get(moveId).flags.defrost) return;
    const result = dies[0].die.result;
    // the result is what the body does: the protocol shows its move or its thaw, or the stop
    const lines = turn.battle.log;
    const goesOn = lines.some(line => check.yes.test(line)) && !lines.some(line => check.no.test(line));
    expect('happens' in result && result.happens, `${check.id}: the result agrees with the protocol`).toBe(goesOn);
    expect(dies[0].chance, 'the chance of the result').toBeGreaterThanOrEqual(0.5);
  });
});

describe.each(SWEEP_CASES)('the likeliest dice of procs, the end of the turn and the order: $name', ({ rules, mode }) => {
  const procs = [...PROCS, EFFECT_SPORE].filter(proc => present(rules, proc.kind, proc.id) && dexOfRules(rules).moves.get(proc.move).exists);
  test.each(procs.map(proc => [proc.id, proc] as const))('proc %s', (_id, proc) => {
    const board = procBoard(rules, mode, proc);
    const clicks = sweepClicks(mode, 'normal');
    const turn = pass(board, battle => playClicks(battle, clicks), `${rules.name} ${mode} proc ${proc.id}`);
    for (const entry of turn.dice.filter(item => item.die.name.kind === 'ability-proc' || item.die.name.kind === 'item-proc')) {
      if (entry.chance !== undefined) expect(entry.chance).toBeGreaterThanOrEqual(0.5);
      if (entry.die.name.effectId?.endsWith(':option')) expect('option' in entry.die.result).toBe(true);
    }
  });

  test.each(END_ROWS.filter(row => (row.kind === 'condition' || present(rules, 'abilities', row.id)) && (!row.only || row.only(rules)) && (!row.doubles || mode === 'doubles')).map(row => [row.id, row] as const))('end of turn %s', (_id, row) => {
    const board = endBoard(rules, mode, row);
    const clicks = sweepClicks(mode, 'self');
    pass(board, battle => playClicks(battle, clicks), `${rules.name} ${mode} end ${row.id}`);
  });

  test.each(moversOf(rules).map(mover => [mover.id, mover] as const))('first mover %s', (_id, mover) => {
    const board = moverBoard(rules, mode, mover, '1,2,3,4');
    const clicks = moverClicks(mode);
    const turn = pass(board, battle => playClicks(battle, clicks), `${rules.name} ${mode} first mover ${mover.id}`);
    // the holder does not move first: the die does not come true
    for (const entry of byKind(turn, 'move-first')) expect(entry.die.result).toEqual({ happens: false });
  });

  test('a speed tie goes to the slot that sorts first', () => {
    const board = tieBoard(rules, mode, '1,2,3,4');
    const clicks = tieClicks(mode);
    const turn = pass(board, battle => playClicks(battle, clicks), `${rules.name} ${mode} tie`);
    const ties = byKind(turn, 'speed-tie');
    expect(ties.length).toBeGreaterThan(0);
    for (const entry of ties) expect('first' in entry.die.result && entry.die.result.first).toBe(entry.die.name.slot);
    // the first body of the first pair moves before its partner, whatever the seed
    const order = turn.battle.log.filter(line => line.startsWith('|move|')).map(line => line.split('|')[2].slice(0, 3));
    expect(order[0]).toBe(ties[0].die.name.slot);
  });
});
