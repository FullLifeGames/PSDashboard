import { test, expect, describe } from 'vitest';
import { PRNG } from '@pkmn/sim';
import { adoptSerializedRuntime } from '../src/branch-engine';
import { serializeLiveBattle } from '../src/serialize';
import { alignArrivalDice } from '../src/branch/arrival-dice';
import { deserializeBattleExact } from '../src/forward-model';
import { LoggedRollPRNG } from '../src/branch/logged-rolls';
import { getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';
import { toId } from '@fulllifegames/replay-core';
import { playTurn, prngOf, reconstruct } from './arrival-turn';

/**
 * A branch opens with the dice its own turn has in the log. GPL DzBQ5azlO5l turn 13 (Air Slash against Heavy Slam, no flinch in the
 * game): an arrival that carried the dice state the previous block left (1,2,3,4) flinches Cobalion, so rebuilding the turn with the
 * logged pair or with any other move for Cobalion showed a flinch the log does not have. The arrival plays its own turn under the
 * seed whose rolls reproduce the block, in singles and in doubles.
 */

/** The scenes: turns whose arrival must carry 1,2,3,4 (the rebuild forces the log's dice under seed index 0). */
const SINGLES = { label: 'singles (GPL DzBQ5azlO5l)', fixture: 'gpl-replay', turn: 13, seed: '1,2,3,4' };
const DOUBLES = { label: 'doubles (Doubles OU 912884)', fixture: 'smogtours-gen9doublesou-912884', turn: 10, seed: '1,2,3,4' };
const VGC = { label: 'VGC doubles (Regulation I 2630181744)', fixture: 'gen9vgc2026regi-2630181744', turn: 3, seed: '1,2,3,4' };
const QUIET = { fixture: 'gpl-replay', turn: 12 };

const PERFECT = { endedMismatch: false, faintMismatches: 0, softMismatches: 0 };

describe.each([SINGLES, DOUBLES, VGC])('a branch plays the logged turn as the log has it: $label', ({ fixture, turn, seed }) => {
  test('the arrival carries the seed the replay plays this turn under, with the logged dice forced on it', { timeout: 300000 }, async () => {
    const { runtime: arrival } = await reconstruct(fixture, turn);
    const { runtime: past } = await reconstruct(fixture, turn + 1);
    const aligned = past.haxAlignment.find(record => record.turn === turn)!;
    expect(aligned.seed).toBe(seed);
    expect(aligned).toMatchObject({ via: 'forced', trialPerfect: false, candidatesTried: 0, actual: PERFECT });
    expect(prngOf(arrival)).toBe(aligned.seed);
  });

  test('the logged pair, played from the single-turn arrival, shows the log\'s rolls', { timeout: 300000 }, async () => {
    const { replay, runtime } = await reconstruct(fixture, turn);
    expect((await playTurn(runtime, replay.log, turn)).score).toEqual(PERFECT);
  });

  test('the logged pair, played from the worker\'s serialized arrival, shows the log\'s rolls', { timeout: 300000 }, async () => {
    const { replay, runtime, snapshotAt } = await reconstruct(fixture, turn);
    const adopted = adoptSerializedRuntime({
      serialized: serializeLiveBattle(runtime.battleStream.battle!), replayLog: replay.log, targetTurn: turn, snapshot: snapshotAt(turn),
    });
    expect((await playTurn(adopted, replay.log, turn)).score).toEqual(PERFECT);
  });

  test('the logged pair, played from a sweep boundary the arrival never saw aligned, shows the log\'s rolls', { timeout: 300000 }, async () => {
    const { replay, captured, snapshotAt } = await reconstruct(fixture, turn + 1);
    const adopted = adoptSerializedRuntime({
      serialized: captured.get(turn)!, replayLog: replay.log, targetTurn: turn, snapshot: snapshotAt(turn),
    });
    expect(prngOf(adopted)).toBe(seed);
    expect((await playTurn(adopted, replay.log, turn)).score).toEqual(PERFECT);
  });
});

describe('the unchanged first mover keeps its logged roll when the other side clicks another move', () => {
  test('GPL turn 13: Air Slash neither flinches nor changes its damage when Cobalion clicks Swords Dance instead of Heavy Slam', { timeout: 300000 }, async () => {
    const logged = await reconstruct(SINGLES.fixture, SINGLES.turn);
    const asLogged = await playTurn(logged.runtime, logged.replay.log, SINGLES.turn);
    const other = await reconstruct(SINGLES.fixture, SINGLES.turn);
    const battle = other.runtime.battleStream.battle!;
    const swordsDance = battle.sides[1].active[0]!.getMoveRequestData().moves.findIndex(move => move.id === 'swordsdance');
    expect(swordsDance).toBeGreaterThanOrEqual(0);
    const changed = await playTurn(other.runtime, other.replay.log, SINGLES.turn, `move ${swordsDance + 1}`);

    for (const lines of [asLogged.lines, changed.lines]) {
      expect(lines.some(line => line.startsWith('|cant|p2a'))).toBe(false);
    }
    expect(changed.lines.some(line => /^\|move\|p2a: [^|]+\|Swords Dance/.test(line))).toBe(true);
    const airSlashHit = (lines: string[]) => lines.filter(line => /^\|-damage\|p2a/.test(line)).slice(0, 2);
    expect(airSlashHit(changed.lines)).toEqual(airSlashHit(asLogged.lines));
  });
});

describe.each([
  { ...SINGLES, side: 'p1' as const, slot: 0 },
  { ...DOUBLES, side: 'p1' as const, slot: 0 },
  { ...VGC, side: 'p1' as const, slot: 0 },
])('an arrival whose logged move the edited set lost plays with the rebuild\'s stand-in: $label', ({ fixture, turn, seed, side, slot }) => {
  // The click names the missing move and the simulator would refuse it; the stand-in of the body's request (`playableMove`) makes the click, the
  // turn plays as the rebuild plays it, and the arrival is that turn's own: the seed of the unedited rebuild, the logged dice forced on it.
  test('the stand-in click plays, the record is the forced turn\'s and the dice follow the logged draws', { timeout: 300000 }, async () => {
    const { replay, runtime, captured } = await reconstruct(fixture, turn + 1);
    const battle = deserializeBattleExact(captured.get(turn)!);
    const block = parseTurnBlocks(replay.log).turns.find(entry => entry.turn === turn)!;
    const loggedMove = block.preUpkeep.find(line => line.startsWith(`|move|${side}${'ab'[slot]}:`) && !line.includes('[from]'))!.split('|')[3];
    const active = battle.sides[side === 'p1' ? 0 : 1].active[slot]!;
    const keeps = (slot: { id: string }) => slot.id !== toId(loggedMove);
    active.moveSlots = active.moveSlots.filter(keeps);
    active.baseMoveSlots = active.baseMoveSlots.filter(keeps);
    expect(active.getMoveRequestData().moves.some(move => move.id === toId(loggedMove))).toBe(false);
    battle.prng = new PRNG('7,7,7,7');
    const choices = { p1: getMainChoice(block.preUpkeep, 'p1', battle), p2: getMainChoice(block.preUpkeep, 'p2', battle) };
    expect(choices[side].split(', ')[slot]).toMatch(/^move \d/);

    const aligned = runtime.haxAlignment.find(record => record.turn === turn)!;
    const result = alignArrivalDice(battle, replay.log, turn);
    // the meaning: a forced record (no trial ran) on the seed the rebuild plays this turn under; the other fields are that record's constants
    expect(result).toEqual({ seed: aligned.seed, trialScore: null, trialPerfect: false, candidatesTried: 0, trialsFailed: 0 });
    expect(result!.seed).toBe(seed);
    expect(aligned).toMatchObject({ via: 'forced', trialPerfect: false, candidatesTried: 0 });
    // the dice: the logged-draws stream on that seed, carrying the turn and the clicks the rebuild's function answers for this position
    expect(battle.prng).toBeInstanceOf(LoggedRollPRNG);
    expect(battle.prng.getSeed()).toBe(seed);
    const prng = battle.prng as LoggedRollPRNG;
    expect(prng.loggedTurn).toMatchObject({ turn, choices });
  });
});

describe.each([
  { ...SINGLES, turn: 12, side: 'p1' as const, label: 'singles (GPL DzBQ5azlO5l)' },
  { ...DOUBLES, turn: 9, side: 'p1' as const, label: 'doubles (Doubles OU 912884)' },
  { ...VGC, turn: 3, side: 'p2' as const, label: 'VGC doubles (Regulation I 2630181744)' },
])('an arrival whose turn no trial can play keeps its dice: $label', ({ fixture, turn, side }) => {
  // `playableMove` repairs moves only: the click stays `switch n`, the simulator refuses a switch to a fainted body, the forced turn throws,
  // and none of the sixteen trials plays either.
  test('the logged switch has no benched body: null, and the dice stay as they were', { timeout: 300000 }, async () => {
    const { replay, captured } = await reconstruct(fixture, turn + 1);
    const battle = deserializeBattleExact(captured.get(turn)!);
    const block = parseTurnBlocks(replay.log).turns.find(entry => entry.turn === turn)!;
    const unedited = getMainChoice(block.preUpkeep, side, battle);
    expect(unedited).toMatch(/\bswitch \d/);
    for (const body of battle.sides[side === 'p1' ? 0 : 1].pokemon) {
      if (body.isActive) continue;
      body.hp = 0;
      body.fainted = true;
    }
    battle.prng = new PRNG('7,7,7,7');
    const before = battle.prng;
    expect(alignArrivalDice(battle, replay.log, turn)).toBeNull();
    expect(battle.prng).toBe(before);
    expect(battle.prng.getSeed()).toBe('7,7,7,7');
  });
});

describe('a turn the replay plays under 1,2,3,4 arrives on 1,2,3,4', () => {
  test('GPL turn 12: the arrival and the adopted position start on 1,2,3,4', { timeout: 300000 }, async () => {
    const { replay, runtime, captured, snapshotAt } = await reconstruct(QUIET.fixture, QUIET.turn + 1);
    const arrival = await reconstruct(QUIET.fixture, QUIET.turn);
    expect(prngOf(arrival.runtime)).toBe('1,2,3,4');
    const adopted = adoptSerializedRuntime({
      serialized: captured.get(QUIET.turn)!, replayLog: replay.log, targetTurn: QUIET.turn, snapshot: snapshotAt(QUIET.turn),
    });
    expect(prngOf(adopted)).toBe('1,2,3,4');
    expect(runtime.haxAlignment.find(record => record.turn === QUIET.turn)!.seed).toBe('1,2,3,4');
  });
});
